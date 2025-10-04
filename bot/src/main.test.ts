import { assert } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Collection, SlashCommandBuilder } from "discord.js";
import { handleInteractionCreate } from "./main.ts";
import { MockInteractionBuilder } from "./test_utils.ts";
import type { Command } from "./types.ts";
import { messageHandler, messageKeys } from "./messages.ts";

describe("Main Bot Logic", () => {
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

    test("未登録のコマンドが実行されると、エラーがログに出力され、コマンドは実行されない", async () => {
      // Arrange
      using consoleErrorStub = stub(console, "error");
      const commands = new Collection<string, Command>();
      const interaction = new MockInteractionBuilder("unregistered")
        .withClient({ commands })
        .build();

      // Act
      await handleInteractionCreate(interaction);

      // Assert
      assertSpyCall(consoleErrorStub, 0);
      assert(
        (consoleErrorStub.calls[0].args[0] as string).startsWith(
          "No command matching",
        ),
      );
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
