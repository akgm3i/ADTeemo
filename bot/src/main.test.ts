import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Collection, type Interaction, SlashCommandBuilder } from "discord.js";
import { MockInteractionBuilder } from "./test_utils.ts";
import type { Command } from "./types.ts";
import { messageHandler, messageKeys } from "./messages.ts";
import {
  BotStartupError,
  handleInteractionCreate,
  runBotEntrypoint,
  startBot,
} from "./main.ts";
import { correlationIdForInteraction } from "./logger.ts";
import { apiClient } from "./api_client.ts";
import type { Event } from "@adteemo/api/contract";

describe("Main Bot Logic", () => {
  describe("startBot", () => {
    const validEnv = {
      get(key: string) {
        if (key === "DISCORD_TOKEN") return "test-discord-token";
        if (key === "API_URL") return "http://api:8000";
        if (key === "BOT_SERVICE_TOKEN") return "x".repeat(32);
        return undefined;
      },
    };

    test("Bot service credentialが不正なとき、秘密値を含まない型付きstartup errorを返す", async () => {
      const credential = "too-short";
      const startupClient = {
        commands: new Collection<string, Command>(),
        login: () => Promise.resolve("token"),
      };

      const error = await assertRejects(
        () =>
          startBot({
            env: {
              get(key) {
                if (key === "DISCORD_TOKEN") return "test-discord-token";
                if (key === "API_URL") return "http://api:8000";
                if (key === "BOT_SERVICE_TOKEN") return credential;
                return undefined;
              },
            },
            client: startupClient as never,
          }),
        BotStartupError,
        "BOT_SERVICE_TOKEN is invalid",
      );

      assertFalse(error.message.includes(credential));
      assertEquals(startupClient.commands.size, 0);
    });

    test("command loadに失敗したとき、既存commandを変更せずloginしない", async () => {
      const existing = new Collection<string, Command>();
      existing.set("existing", {
        data: new SlashCommandBuilder().setName("existing")
          .setDescription("existing command"),
        execute: () => Promise.resolve(),
      });
      let loginCalls = 0;
      const startupClient = {
        commands: existing,
        login() {
          loginCalls += 1;
          return Promise.resolve("token");
        },
      };

      await assertRejects(
        () =>
          startBot({
            env: validEnv,
            client: startupClient as never,
            loadCommands: () =>
              Promise.resolve({
                ok: false,
                errors: [{
                  code: "IMPORT_FAILED",
                  fileName: "broken.ts",
                  message: "failed",
                }],
              }),
          }),
        BotStartupError,
        "Failed to load slash commands: broken.ts (IMPORT_FAILED): failed",
      );

      assertEquals(loginCalls, 0);
      assertStrictEquals(startupClient.commands, existing);
    });

    test("command loaderがrejectしたとき、元の失敗をcauseに持つ型付きstartup errorを返す", async () => {
      // Arrange
      const loadFailure = new Error("raw command import failure");
      const startupClient = {
        commands: new Collection<string, Command>(),
        login: () => Promise.resolve("token"),
      };

      // Act
      const error = await assertRejects(
        () =>
          startBot({
            env: validEnv,
            client: startupClient as never,
            loadCommands: () => Promise.reject(loadFailure),
          }),
        BotStartupError,
        "Failed to load slash commands",
      );

      // Assert
      assertEquals(error.code, "COMMAND_LOAD_FAILED");
      assertStrictEquals(error.cause, loadFailure);
      assertEquals(startupClient.commands.size, 0);
    });

    test("Discord loginがrejectしたとき、元の失敗をcauseに持つ型付きstartup errorを返す", async () => {
      const loginError = new Error("Discord authentication failed");
      const startupClient = {
        commands: new Collection<string, Command>(),
        login: () => Promise.reject(loginError),
      };

      const error = await assertRejects(
        () =>
          startBot({
            env: validEnv,
            client: startupClient as never,
            loadCommands: () => Promise.resolve({ ok: true, commands: [] }),
          }),
        BotStartupError,
        "Discord login failed",
      );

      assertEquals(error.code, "DISCORD_LOGIN_FAILED");
      assertStrictEquals(error.cause, loginError);
    });

    test("loginが完了するまでstartup promiseを完了扱いにしない", async () => {
      let resolveLogin: ((token: string) => void) | undefined;
      const loginPromise = new Promise<string>((resolve) => {
        resolveLogin = resolve;
      });
      const loadedCommand: Command = {
        data: new SlashCommandBuilder().setName("loaded")
          .setDescription("loaded command"),
        execute: () => Promise.resolve(),
      };
      const startupClient = {
        commands: new Collection<string, Command>(),
        login: () => loginPromise,
      };
      let completed = false;

      const startup = startBot({
        env: validEnv,
        client: startupClient as never,
        loadCommands: () =>
          Promise.resolve({ ok: true, commands: [loadedCommand] }),
      }).then(() => {
        completed = true;
      });
      await Promise.resolve();
      await Promise.resolve();

      assertFalse(completed);
      assertEquals([...startupClient.commands.keys()], ["loaded"]);

      resolveLogin?.("token");
      await startup;
      assertEquals(completed, true);
    });

    test("通常startupはcommand配備moduleへ依存しない", async () => {
      const source = await Deno.readTextFile(
        new URL("main.ts", import.meta.url),
      );

      assertFalse(source.includes("deploy-commands"));
      assertFalse(source.includes("rest.put"));
    });
  });

  describe("runBotEntrypoint", () => {
    const knownFailures = [
      {
        label: "設定不足",
        code: "MISSING_CONFIGURATION",
        reason: "configuration_invalid",
        errorCategory: "validation",
      },
      {
        label: "service credential不正",
        code: "INVALID_SERVICE_CREDENTIAL",
        reason: "service_credential_invalid",
        errorCategory: "validation",
      },
      {
        label: "command load失敗",
        code: "COMMAND_LOAD_FAILED",
        reason: "command_load_failed",
        errorCategory: "unexpected",
      },
      {
        label: "Discord login失敗",
        code: "DISCORD_LOGIN_FAILED",
        reason: "discord_login_failed",
        errorCategory: "remote_api",
      },
    ] as const;

    for (const knownFailure of knownFailures) {
      test(`${knownFailure.label}のとき、固定reasonでfatalを記録してexitCodeを1にする`, async () => {
        // Arrange
        const failure = new BotStartupError(
          knownFailure.code,
          "raw credential and provider response body",
        );
        const errors: Array<{
          event: string;
          context?: Record<string, unknown>;
          error?: unknown;
        }> = [];
        const exitCodes: number[] = [];

        // Act
        await runBotEntrypoint({
          startBot: () => Promise.reject(failure),
          logger: {
            error(event, context, error) {
              errors.push({ event, context, error });
            },
          },
          correlationId: () => "startup-correlation-id",
          setExitCode: (code) => exitCodes.push(code),
        });

        // Assert
        assertEquals(errors, [{
          event: "bot.start.failed",
          context: {
            correlationId: "startup-correlation-id",
            errorCategory: knownFailure.errorCategory,
            reason: knownFailure.reason,
          },
          error: failure,
        }]);
        assertFalse(
          JSON.stringify(errors[0].context).includes("provider response body"),
        );
        assertEquals(exitCodes, [1]);
      });
    }

    test("未知のstartup例外のとき、unexpectedへfallbackしてログ記録後にexitCodeを1にする", async () => {
      // Arrange
      const failure = new Error("unknown failure with raw credential");
      const errors: Array<{
        event: string;
        context?: Record<string, unknown>;
        error?: unknown;
      }> = [];
      const exitCodes: number[] = [];

      // Act
      await runBotEntrypoint({
        startBot: () => Promise.reject(failure),
        logger: {
          error(event, context, error) {
            errors.push({ event, context, error });
          },
        },
        correlationId: () => "startup-correlation-id",
        setExitCode: (code) => exitCodes.push(code),
      });

      // Assert
      assertEquals(errors, [{
        event: "bot.start.failed",
        context: {
          correlationId: "startup-correlation-id",
          errorCategory: "unexpected",
          reason: "unexpected",
        },
        error: failure,
      }]);
      assertEquals(exitCodes, [1]);
    });
  });

  describe("handleInteractionCreate", () => {
    function eventFixture(overrides: Partial<Event> = {}): Event {
      const createdAt = new Date("2026-08-01T00:00:00.000Z");
      return {
        id: 113,
        operationKey: "interaction-113",
        name: "週末カスタム",
        guildId: "guild-1",
        creatorId: "creator-1",
        recruitmentChannelId: "channel-1",
        voiceChannelId: "voice-1",
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        phase: "RECRUITING",
        syncState: "CONSISTENT",
        revision: 0,
        discordEventDeleted: false,
        recruitmentMessageDeleted: false,
        lastFailureCode: null,
        scheduledStartAt: new Date("2026-08-08T12:00:00.000Z"),
        createdAt,
        updatedAt: null,
        ...overrides,
      };
    }

    function cancelSelectInteraction(
      value: string,
      order: string[],
    ) {
      const deferUpdate = spy(() => Promise.resolve());
      const editReply = spy((_input: unknown) => Promise.resolve({}));
      const deleteScheduledEvent = spy((_id: string) => {
        order.push("Discordイベント削除");
        return Promise.resolve();
      });
      const deleteRecruitmentMessage = spy((_id: string) => {
        order.push("募集メッセージ削除");
        return Promise.resolve();
      });
      const interaction = {
        isChatInputCommand: () => false,
        isStringSelectMenu: () => true,
        inGuild: () => true,
        customId: "cancel-event-select",
        values: [value],
        user: { id: "creator-1" },
        guild: {
          id: "guild-1",
          scheduledEvents: {
            delete: deleteScheduledEvent,
          },
        },
        channel: {
          id: "channel-1",
          messages: {
            delete: deleteRecruitmentMessage,
          },
        },
        deferUpdate,
        editReply,
      } as unknown as Interaction;
      return {
        interaction,
        deferUpdate,
        editReply,
        deleteScheduledEvent,
        deleteRecruitmentMessage,
      };
    }

    test("登録済みのコマンドが実行されると、対応するexecute関数が呼び出される", async () => {
      // Arrange
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("test"),
        execute: () => Promise.resolve(),
      };
      using executeSpy = stub(mockCommand, "execute");
      const commands = new Collection<string, Command>();
      commands.set(mockCommand.data.name, mockCommand);
      const interaction = new MockInteractionBuilder("test")
        .withClient({ commands })
        .build();

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCall(executeSpy, 0, { args: [interaction] });
    });

    test("未登録のコマンドが実行されると、コマンド名とギルドIDを含む構造化警告ログを出力する", async () => {
      // Arrange
      using consoleLogStub = stub(console, "log");
      const commands = new Collection<string, Command>();
      const interaction = new MockInteractionBuilder("unregistered")
        .withClient({ commands })
        .build();
      const correlationId = correlationIdForInteraction(interaction);

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCalls(consoleLogStub, 1);
      const [firstCall] = consoleLogStub.calls;
      const payload = firstCall.args[0] as string;
      const parsed = JSON.parse(payload);
      assertEquals(parsed.component, "bot");
      assertEquals(parsed.level, "WARN");
      assertEquals(parsed.event, "command.not_found");
      assertEquals(parsed.correlationId, correlationId);
      assertEquals(parsed.commandName, "unregistered");
      assertEquals(parsed.guildId, "mock-guild-id");
    });

    test("コマンドの実行中にエラーが発生すると、follow upメッセージでエラーを報告する", async () => {
      // Arrange
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("error-command"),
        execute: () => Promise.reject(new Error("Test error")),
      };
      const commands = new Collection<string, Command>();
      commands.set(mockCommand.data.name, mockCommand);
      const interaction = new MockInteractionBuilder("error-command")
        .withClient({ commands })
        .build();
      (interaction as { replied: boolean }).replied = true;
      using followUpSpy = spy(interaction, "followUp");
      using formatSpy = spy(messageHandler, "formatMessage");

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCall(followUpSpy, 0);
      assertSpyCall(formatSpy, 0, {
        args: [messageKeys.common.error.command],
      });
    });

    test("ChatInputCommand以外のInteractionでは、コマンドを実行しない", async () => {
      // Arrange
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("test"),
        execute: () => Promise.resolve(),
      };
      using executeSpy = stub(mockCommand, "execute");
      const commands = new Collection<string, Command>();
      commands.set(mockCommand.data.name, mockCommand);
      const interaction = new MockInteractionBuilder("test")
        .setIsChatInputCommand(false)
        .withClient({ commands })
        .build();

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCalls(executeSpy, 0);
    });

    test("自分の未中止event IDを選択すると、guildとchannelでscopeしてDiscord削除の進捗確定後に成功を表示する", async () => {
      const order: string[] = [];
      let current = eventFixture();
      using getEventsStub = stub(
        apiClient,
        "getCustomGameEventsByCreator",
        () => Promise.resolve({ success: true, events: [current] }),
      );
      using beginStub = stub(
        apiClient,
        "beginCustomGameEventCancellation",
        (_eventId, _scope) => {
          order.push("中止開始を保存");
          current = { ...current, syncState: "CANCEL_PENDING" };
          return Promise.resolve({ success: true, event: current });
        },
      );
      using progressStub = stub(
        apiClient,
        "updateCustomGameEventCancellationProgress",
        (_eventId, input) => {
          if (input.discordEventDeleted) {
            order.push("イベント削除を保存");
            current = { ...current, discordEventDeleted: true };
          }
          if (input.recruitmentMessageDeleted) {
            order.push("メッセージ削除を保存");
            current = {
              ...current,
              recruitmentMessageDeleted: true,
              phase: "CANCELLED",
              syncState: "CONSISTENT",
            };
          }
          return Promise.resolve({ success: true, event: current });
        },
      );
      const select = cancelSelectInteraction("113", order);

      await handleInteractionCreate(select.interaction);

      assertSpyCall(getEventsStub, 0, {
        args: ["guild-1", "channel-1", "creator-1"],
      });
      assertSpyCall(beginStub, 0, {
        args: [113, {
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
        }],
      });
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント削除",
        "イベント削除を保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
      assertSpyCall(select.editReply, 0, {
        args: [{
          content: messageHandler.formatMessage(
            messageKeys.customGame.cancel.success,
          ),
          components: [],
        }],
      });
      assertSpyCalls(progressStub, 2);
    });

    test("選択したevent IDが同じguildとchannelでも自分の候補にない場合、中止を開始しない", async () => {
      const order: string[] = [];
      using _getEventsStub = stub(
        apiClient,
        "getCustomGameEventsByCreator",
        () =>
          Promise.resolve({
            success: true,
            events: [eventFixture({ id: 114, creatorId: "creator-1" })],
          }),
      );
      using beginStub = stub(
        apiClient,
        "beginCustomGameEventCancellation",
        () => Promise.reject(new Error("must not be called")),
      );
      const select = cancelSelectInteraction("113", order);

      await handleInteractionCreate(select.interaction);

      assertSpyCalls(beginStub, 0);
      assertSpyCalls(select.deleteScheduledEvent, 0);
      assertSpyCalls(select.deleteRecruitmentMessage, 0);
      assertSpyCall(select.editReply, 0, {
        args: [{
          content: messageHandler.formatMessage(
            messageKeys.customGame.cancel.error.interaction,
          ),
          components: [],
        }],
      });
    });
  });
});
