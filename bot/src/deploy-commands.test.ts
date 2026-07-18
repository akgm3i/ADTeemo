import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { Command } from "./types.ts";
import {
  CommandDeploymentError,
  type CommandRestClient,
  runCommandDeployment,
  runCommandDeploymentEntrypoint,
  syncApplicationCommands,
} from "./deploy-commands.ts";
import {
  type CommandLoadResult,
  loadCommands,
} from "./common/command_loader.ts";
import type { CommandRegistration } from "./common/command_registry.ts";

function command(name: string, description = `${name} command`): Command {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(description),
    execute: () => Promise.resolve(),
  };
}

function loaded(...commands: Command[]): CommandLoadResult {
  return { ok: true, commands };
}

class FakeRest implements CommandRestClient {
  getCalls: string[] = [];
  putCalls: Array<{ route: string; body: unknown }> = [];

  constructor(
    private readonly current: unknown = [],
    private readonly published: unknown = undefined,
  ) {}

  get(route: string): Promise<unknown> {
    this.getCalls.push(route);
    return Promise.resolve(this.current);
  }

  put(route: string, options: { body: unknown }): Promise<unknown> {
    this.putCalls.push({ route, body: options.body });
    return Promise.resolve(
      this.published === undefined ? options.body : this.published,
    );
  }
}

describe("slash command deployment", () => {
  test("command loadに失敗したとき、Discord RESTを呼ばない", async () => {
    const rest = new FakeRest();
    const loadResult: CommandLoadResult = {
      ok: false,
      errors: [{
        code: "IMPORT_FAILED",
        fileName: "broken.ts",
        message: "failed",
      }],
    };

    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult,
        }),
      CommandDeploymentError,
      "Command loading failed: broken.ts (IMPORT_FAILED): failed",
    );

    assertEquals(error.code, "COMMAND_LOAD_FAILED");
    assertEquals(rest.getCalls, []);
    assertEquals(rest.putCalls, []);
  });

  test("有効commandが0件のとき、全削除を防いでDiscord RESTを呼ばない", async () => {
    const rest = new FakeRest();

    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult: loaded(),
        }),
      CommandDeploymentError,
      "No enabled commands",
    );

    assertEquals(error.code, "NO_ENABLED_COMMANDS");
    assertEquals(rest.getCalls, []);
    assertEquals(rest.putCalls, []);
  });

  test("現在値と期待値が同じとき、unchangedを返してPUTしない", async () => {
    const expected = command("health");
    const rest = new FakeRest([{
      id: "discord-command-id",
      application_id: "application-id",
      version: "version-id",
      ...expected.data.toJSON(),
    }]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult: loaded(expected),
    });

    assertEquals(result.status, "unchanged");
    assertEquals(result.diff, { added: [], removed: [], updated: [] });
    assertEquals(rest.getCalls, [Routes.applicationCommands("client-id")]);
    assertEquals(rest.putCalls, []);
  });

  test("Discordが未指定fieldを既定値で返すとき、同一定義としてPUTしない", async () => {
    const expected = command("health");
    const rest = new FakeRest([{
      id: "discord-command-id",
      application_id: "application-id",
      version: "version-id",
      ...expected.data.toJSON(),
      name_localizations: null,
      description_localizations: null,
      contexts: [0, 1, 2],
      default_permission: true,
      default_member_permissions: null,
      dm_permission: true,
      integration_types: [0],
      nsfw: false,
    }]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult: loaded(expected),
    });

    assertEquals(result.status, "unchanged");
    assertEquals(result.diff, { added: [], removed: [], updated: [] });
    assertEquals(rest.putCalls, []);
  });

  test("global commandに古い公開範囲が残るとき、registryの明示範囲へ更新する", async () => {
    const registration = {
      fileName: "health.ts",
      expectedName: "health",
      status: "enabled",
      contexts: [
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
      ],
      integrationTypes: [ApplicationIntegrationType.GuildInstall],
    } satisfies CommandRegistration;
    const loadResult = await loadCommands({
      registry: [registration],
      listCommandFiles: () => Promise.resolve(["health.ts"]),
      importCommand: () =>
        Promise.resolve({
          data: new SlashCommandBuilder()
            .setName("health")
            .setDescription("health command"),
          execute: () => Promise.resolve(),
        }),
    });
    const rest = new FakeRest([{
      name: "health",
      description: "health command",
      type: 1,
      contexts: [InteractionContextType.Guild],
      integration_types: [ApplicationIntegrationType.UserInstall],
    }]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult,
    });

    assertEquals(result.status, "updated");
    assertEquals(result.diff.updated, ["health"]);
    assertEquals(rest.putCalls.length, 1);
    const published = rest.putCalls[0].body as Array<Record<string, unknown>>;
    assertEquals(published[0].contexts, [
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
    ]);
    assertEquals(published[0].integration_types, [
      ApplicationIntegrationType.GuildInstall,
    ]);
  });

  test("既存commandがDiscord既定値から外れるとき、期待する既定値へ戻す", async () => {
    const expected = command("health");
    const rest = new FakeRest([{
      ...expected.data.toJSON(),
      default_member_permissions: "0",
      dm_permission: false,
      nsfw: true,
    }]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult: loaded(expected),
    });

    assertEquals(result.status, "updated");
    assertEquals(result.diff.updated, ["health"]);
    assertEquals(rest.putCalls.length, 1);
  });

  test("現在値に期待しないoptionが残るとき、updatedとしてPUTする", async () => {
    const expected = command("health");
    const stale = new SlashCommandBuilder()
      .setName("health")
      .setDescription("health command")
      .addStringOption((option) =>
        option.setName("stale").setDescription("stale option")
      );
    const rest = new FakeRest([stale.toJSON()]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult: loaded(expected),
    });

    assertEquals(result.status, "updated");
    assertEquals(result.diff.updated, ["health"]);
    assertEquals(rest.putCalls.length, 1);
  });

  test("差分があるとき、期待payloadでguild commandを1回だけPUTする", async () => {
    const rest = new FakeRest([
      command("health", "old description").data.toJSON(),
      command("removed").data.toJSON(),
    ]);
    const expected = [command("new-command"), command("health")];

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      guildId: "guild-id",
      loadResult: loaded(...expected),
    });

    const route = Routes.applicationGuildCommands("client-id", "guild-id");
    assertEquals(result.status, "updated");
    assertEquals(result.diff, {
      added: ["new-command"],
      removed: ["removed"],
      updated: ["health"],
    });
    assertEquals(rest.getCalls, [route]);
    assertEquals(rest.putCalls.length, 1);
    assertEquals(rest.putCalls[0].route, route);
    assertEquals(
      (rest.putCalls[0].body as Array<{ name: string }>).map(({ name }) =>
        name
      ),
      ["health", "new-command"],
    );
  });

  test("registryで公開範囲を指定したcommandをguildへ配備するとき、global専用fieldをPUTしない", async () => {
    const registration = {
      fileName: "health.ts",
      expectedName: "health",
      status: "enabled",
      contexts: [
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
      ],
      integrationTypes: [ApplicationIntegrationType.GuildInstall],
    } satisfies CommandRegistration;
    const loadResult = await loadCommands({
      registry: [registration],
      listCommandFiles: () => Promise.resolve(["health.ts"]),
      importCommand: () =>
        Promise.resolve({
          data: new SlashCommandBuilder()
            .setName("health")
            .setDescription("health command")
            .setDMPermission(false),
          execute: () => Promise.resolve(),
        }),
    });
    const rest = new FakeRest([]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      guildId: "guild-id",
      loadResult,
    });

    assertEquals(result.status, "updated");
    assertEquals(rest.putCalls.length, 1);
    const published = rest.putCalls[0].body as Array<Record<string, unknown>>;
    assertFalse("contexts" in published[0]);
    assertFalse("integration_types" in published[0]);
    assertFalse("dm_permission" in published[0]);
  });

  test("別typeの同名commandが存在するとき、余分なcommandとして同期する", async () => {
    const expected = command("health");
    const rest = new FakeRest([
      expected.data.toJSON(),
      { name: "health", type: 2 },
    ]);

    const result = await syncApplicationCommands({
      rest,
      clientId: "client-id",
      loadResult: loaded(expected),
    });

    assertEquals(result.status, "updated");
    assertEquals(result.diff, {
      added: [],
      removed: ["health (type 2)"],
      updated: [],
    });
    assertEquals(rest.putCalls.length, 1);
  });

  test("Discord GETが失敗したとき、元の失敗をcauseに持つcurrent取得errorを返す", async () => {
    // Arrange
    const getFailure = new Error("raw provider response body from GET");
    const rest: CommandRestClient = {
      get: () => Promise.reject(getFailure),
      put: () => Promise.resolve([]),
    };

    // Act
    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult: loaded(command("health")),
        }),
      CommandDeploymentError,
      "Failed to fetch current Discord commands",
    );

    // Assert
    assertEquals(error.code, "DISCORD_CURRENT_FETCH_FAILED");
    assertStrictEquals(error.cause, getFailure);
  });

  test("Discord PUTが失敗したとき、元の失敗をcauseに持つpublish errorを返す", async () => {
    // Arrange
    const putFailure = new Error("raw provider response body from PUT");
    const rest: CommandRestClient = {
      get: () => Promise.resolve([]),
      put: () => Promise.reject(putFailure),
    };

    // Act
    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult: loaded(command("health")),
        }),
      CommandDeploymentError,
      "Failed to publish Discord commands",
    );

    // Assert
    assertEquals(error.code, "DISCORD_PUBLISH_FAILED");
    assertStrictEquals(error.cause, putFailure);
  });

  test("DiscordのPUT応答が期待件数とnameに一致しないとき、配備成功にしない", async () => {
    const expected = command("health");
    const rest = new FakeRest([], [command("unexpected").data.toJSON()]);

    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult: loaded(expected),
        }),
      CommandDeploymentError,
      "Discord publish result validation failed",
    );

    assertEquals(error.code, "PUBLISH_RESULT_VALIDATION_FAILED");
    assertEquals(error.cause instanceof Error, true);
    assertEquals(rest.putCalls.length, 1);
  });

  test("DiscordのPUT応答が同名でも期待payloadと異なるとき、配備成功にしない", async () => {
    const expected = command("health");
    const rest = new FakeRest(
      [],
      [command("health", "stale description").data.toJSON()],
    );

    const error = await assertRejects(
      () =>
        syncApplicationCommands({
          rest,
          clientId: "client-id",
          loadResult: loaded(expected),
        }),
      CommandDeploymentError,
      "Discord publish result validation failed",
    );

    assertEquals(error.code, "PUBLISH_RESULT_VALIDATION_FAILED");
    assertEquals(rest.putCalls.length, 1);
  });

  test("deploy設定が不足しているとき、configuration errorとして同期前に失敗する", async () => {
    // Arrange
    const rest = new FakeRest([]);

    // Act
    const error = await assertRejects(
      () =>
        runCommandDeployment({
          env: { get: () => undefined },
          loadCommands: () => Promise.resolve(loaded(command("health"))),
          createRest: () => rest,
          logger: { info() {}, warn() {}, error() {} },
          correlationId: () => "deployment-correlation-id",
        }),
      CommandDeploymentError,
      "DISCORD_TOKEN and DISCORD_CLIENT_ID are required",
    );

    // Assert
    assertEquals(error.code, "MISSING_CONFIGURATION");
    assertEquals(rest.getCalls, []);
  });

  test("command loaderがrejectしたとき、元の失敗をcauseに持つload errorを返す", async () => {
    // Arrange
    const loadFailure = new Error("raw command import failure");
    const rest = new FakeRest([]);

    // Act
    const error = await assertRejects(
      () =>
        runCommandDeployment({
          env: {
            get(name) {
              if (name === "DISCORD_TOKEN") return "secret-token";
              if (name === "DISCORD_CLIENT_ID") return "client-id";
              return undefined;
            },
          },
          loadCommands: () => Promise.reject(loadFailure),
          createRest: () => rest,
          logger: { info() {}, warn() {}, error() {} },
          correlationId: () => "deployment-correlation-id",
        }),
      CommandDeploymentError,
      "Failed to load slash commands",
    );

    // Assert
    assertEquals(error.code, "COMMAND_LOAD_FAILED");
    assertStrictEquals(error.cause, loadFailure);
    assertEquals(rest.getCalls, []);
  });

  test("通常のdeploy entrypointは全件load成功後だけ同期処理を実行する", async () => {
    const rest = new FakeRest([]);
    const infoEvents: string[] = [];
    const result = await runCommandDeployment({
      env: {
        get(name) {
          if (name === "DISCORD_TOKEN") return "secret-token";
          if (name === "DISCORD_CLIENT_ID") return "client-id";
          return undefined;
        },
      },
      loadCommands: () => Promise.resolve(loaded(command("health"))),
      createRest: (token) => {
        assertEquals(token, "secret-token");
        return rest;
      },
      logger: {
        info(event) {
          infoEvents.push(event);
        },
        warn() {},
        error() {},
      },
      correlationId: () => "deployment-correlation-id",
    });

    assertEquals(result.status, "updated");
    assertEquals(infoEvents, [
      "command.deploy.started",
      "command.deploy.updated",
    ]);
    assertFalse(JSON.stringify(infoEvents).includes("secret-token"));
  });

  describe("runCommandDeploymentEntrypoint", () => {
    const knownFailures = [
      {
        label: "設定不足",
        code: "MISSING_CONFIGURATION",
        reason: "configuration_invalid",
        errorCategory: "validation",
      },
      {
        label: "command load失敗",
        code: "COMMAND_LOAD_FAILED",
        reason: "command_load_failed",
        errorCategory: "unexpected",
      },
      {
        label: "有効command空集合",
        code: "NO_ENABLED_COMMANDS",
        reason: "no_enabled_commands",
        errorCategory: "validation",
      },
      {
        label: "Discord current取得失敗",
        code: "DISCORD_CURRENT_FETCH_FAILED",
        reason: "discord_current_fetch_failed",
        errorCategory: "remote_api",
      },
      {
        label: "Discord publish失敗",
        code: "DISCORD_PUBLISH_FAILED",
        reason: "discord_publish_failed",
        errorCategory: "remote_api",
      },
      {
        label: "publish結果検証失敗",
        code: "PUBLISH_RESULT_VALIDATION_FAILED",
        reason: "publish_result_validation_failed",
        errorCategory: "remote_api",
      },
    ] as const;

    for (const knownFailure of knownFailures) {
      test(`${knownFailure.label}のとき、固定reasonでfatalを記録してexitCodeを1にする`, async () => {
        // Arrange
        const failure = new CommandDeploymentError(
          knownFailure.code,
          "raw credential and provider response body",
        );
        const errors: Array<{
          event: string;
          context?: Record<string, unknown>;
          error?: unknown;
        }> = [];
        const exitCodes: number[] = [];
        const receivedCorrelationIds: string[] = [];

        // Act
        await runCommandDeploymentEntrypoint({
          runCommandDeployment: (correlationId) => {
            receivedCorrelationIds.push(correlationId);
            return Promise.reject(failure);
          },
          logger: {
            info() {},
            warn() {},
            error(event, context, error) {
              errors.push({ event, context, error });
            },
          },
          correlationId: () => "fatal-correlation-id",
          setExitCode: (code) => exitCodes.push(code),
        });

        // Assert
        assertEquals(errors, [{
          event: "command.deploy.failed",
          context: {
            correlationId: "fatal-correlation-id",
            errorCategory: knownFailure.errorCategory,
            reason: knownFailure.reason,
          },
          error: failure,
        }]);
        assertFalse(
          JSON.stringify(errors[0].context).includes("provider response body"),
        );
        assertEquals(exitCodes, [1]);
        assertEquals(receivedCorrelationIds, ["fatal-correlation-id"]);
      });
    }

    test("未知の配備例外のとき、unexpectedへfallbackしてログ記録後にexitCodeを1にする", async () => {
      // Arrange
      const failure = new Error("unknown deployment failure");
      const errors: Array<{
        event: string;
        context?: Record<string, unknown>;
        error?: unknown;
      }> = [];
      const exitCodes: number[] = [];

      // Act
      await runCommandDeploymentEntrypoint({
        runCommandDeployment: () => Promise.reject(failure),
        logger: {
          info() {},
          warn() {},
          error(event, context, error) {
            errors.push({ event, context, error });
          },
        },
        correlationId: () => "fatal-correlation-id",
        setExitCode: (code) => exitCodes.push(code),
      });

      // Assert
      assertEquals(errors, [{
        event: "command.deploy.failed",
        context: {
          correlationId: "fatal-correlation-id",
          errorCategory: "unexpected",
          reason: "unexpected",
        },
        error: failure,
      }]);
      assertEquals(exitCodes, [1]);
    });
  });
});
