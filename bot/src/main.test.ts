import {
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Collection, SlashCommandBuilder } from "discord.js";
import { MockInteractionBuilder } from "./test_utils.ts";
import type { Command } from "./types.ts";
import { messageHandler, messageKeys } from "./messages.ts";
import { handleInteractionCreate, startBot } from "./main.ts";
import { botLogger } from "./logger.ts";

describe("Main Bot Logic", () => {
  describe("startBot", () => {
    test("Bot service credentialが不正な場合、構造化エラーを記録してcode 1で終了する", async () => {
      // Arrange
      const credential = "too-short";
      const exitError = new Error("Deno.exit(1)");
      using _envStub = stub(
        Deno.env,
        "get",
        (key: string) => {
          if (key === "DISCORD_TOKEN") return "test-discord-token";
          if (key === "API_URL") return "http://api:8000";
          if (key === "BOT_SERVICE_TOKEN") return credential;
          return undefined;
        },
      );
      using errorStub = stub(botLogger, "error", () => {});
      using exitStub = stub(Deno, "exit", (_code?: number): never => {
        throw exitError;
      });

      // Act
      await assertRejects(() => startBot(), Error, exitError.message);

      // Assert
      assertSpyCalls(errorStub, 1);
      const [message, context, error] = errorStub.calls[0].args;
      assertEquals(message, "bot.start.invalid_service_credential");
      assertEquals(context, {});
      assertInstanceOf(error, Error);
      assertFalse(error.message.includes(credential));
      assertSpyCall(exitStub, 0, { args: [1] });
    });
  });

  describe("handleInteractionCreate", () => {
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

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCalls(consoleLogStub, 1);
      const [firstCall] = consoleLogStub.calls;
      const payload = firstCall.args[0] as string;
      const parsed = JSON.parse(payload);
      assertEquals(parsed.component, "bot");
      assertEquals(parsed.level, "WARN");
      assertEquals(parsed.message, "command.not_found");
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
  });
});
