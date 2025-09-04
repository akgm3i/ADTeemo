import { assert, assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { stub } from "jsr:@std/testing/mock";
import { Events, type Interaction, SlashCommandBuilder } from "npm:discord.js";
import { client } from "./main.ts";
import { newMockChatInputCommandInteractionBuilder } from "./test_utils.ts";
import type { Command } from "./types.ts";

describe("Main Bot Logic", () => {
  describe("InteractionCreate Event", () => {
    // A small delay to allow the async event handler to run
    const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 10));

    it("登録済みのコマンドが実行されると、対応するexecute関数が呼び出される", async () => {
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("test"),
        execute: () => Promise.resolve(),
      };
      using executeSpy = stub(mockCommand, "execute");
      client.commands.set(mockCommand.data.name, mockCommand);

      const mockInteraction = newMockChatInputCommandInteractionBuilder("test")
        .withClient(client)
        .build();

      client.emit(Events.InteractionCreate, mockInteraction as Interaction);
      await yieldToEventLoop();

      assertEquals(executeSpy.calls.length, 1);
      assertEquals(executeSpy.calls[0].args[0], mockInteraction);
      client.commands.delete("test");
    });

    it("未登録のコマンドが実行されると、エラーがログに出力され、コマンドは実行されない", async () => {
      using consoleErrorStub = stub(console, "error");

      const mockInteraction = newMockChatInputCommandInteractionBuilder(
        "unregistered-command",
      )
        .withClient(client)
        .build();

      client.emit(Events.InteractionCreate, mockInteraction as Interaction);
      await yieldToEventLoop();

      assertEquals(consoleErrorStub.calls.length, 1);
      assert(
        (consoleErrorStub.calls[0].args[0] as string).startsWith(
          "No command matching",
        ),
      );
    });

    it("コマンドの実行中にエラーが発生すると、follow upメッセージでエラーを報告する", async () => {
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("error-command"),
        execute: () => Promise.resolve(), // This will be replaced by the stub
      };
      using executeSpy = stub(
        mockCommand,
        "execute",
        () => Promise.reject(new Error("Test error")),
      );
      client.commands.set(mockCommand.data.name, mockCommand);

      const mockInteraction = newMockChatInputCommandInteractionBuilder(
        "error-command",
      )
        .withClient(client)
        .setReplied(true)
        .build();

      client.emit(Events.InteractionCreate, mockInteraction as Interaction);
      await yieldToEventLoop();

      assertEquals(executeSpy.calls.length, 1);
      assertEquals(mockInteraction.followUp.calls.length, 1);
      assertEquals(mockInteraction.followUp.calls[0].args[0], {
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
      client.commands.delete("error-command");
    });

    it("ChatInputCommand以外のInteractionでは、コマンドを実行しない", async () => {
      const mockCommand: Command = {
        data: new SlashCommandBuilder().setName("test"),
        execute: () => Promise.resolve(),
      };
      using executeSpy = stub(mockCommand, "execute");
      client.commands.set(mockCommand.data.name, mockCommand);

      const mockInteraction = newMockChatInputCommandInteractionBuilder()
        .withIsChatInputCommand(false)
        .withClient(client)
        .build();

      client.emit(Events.InteractionCreate, mockInteraction as Interaction);
      await yieldToEventLoop();

      assertEquals(executeSpy.calls.length, 0);
      client.commands.delete("test");
    });
  });
});
