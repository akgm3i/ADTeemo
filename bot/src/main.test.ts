import { assertEquals, assert } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { spy, stub } from "jsr:@std/testing/mock";
import {
  Collection,
  Events,
  type Interaction,
} from "npm:discord.js";
import { client } from "./main.ts";

// Define a minimal Command type for our tests
interface Command {
  data: { name: string };
  execute: (interaction: Interaction) => Promise<void>;
}

describe("Main Bot Logic", () => {
  describe("InteractionCreate Event", () => {
    it("登録済みのコマンドが実行されると、対応するexecute関数が呼び出される", async () => {
      const mockExecute = spy((_) => Promise.resolve());
      const mockCommand: Command = {
        data: { name: "test" },
        execute: mockExecute,
      };

      client.commands.set("test", mockCommand as any);

      const mockInteraction = {
        isChatInputCommand: () => true,
        commandName: "test",
        client: client,
      } as unknown as Interaction;

      await client.emit(Events.InteractionCreate, mockInteraction);

      assertEquals(mockExecute.calls.length, 1);
      assertEquals(mockExecute.calls[0].args[0], mockInteraction);

      client.commands.delete("test");
    });

    it("未登録のコマンドが実行されると、エラーがログに出力され、コマンドは実行されない", async () => {
      const consoleErrorStub = stub(console, "error");
      const mockExecute = spy(() => Promise.resolve());

      const mockInteraction = {
        isChatInputCommand: () => true,
        commandName: "unregistered-command",
        client: client,
      } as unknown as Interaction;

      try {
        await client.emit(Events.InteractionCreate, mockInteraction);
        assertEquals(mockExecute.calls.length, 0);
        assertEquals(consoleErrorStub.calls.length, 1);
        assert(
          (consoleErrorStub.calls[0].args[0] as string).startsWith(
            "No command matching",
          ),
        );
      } finally {
        consoleErrorStub.restore();
      }
    });

    it("コマンドの実行中にエラーが発生すると、フォロアップメッセージでエラーを報告する", async () => {
      const followUpSpy = spy((_) => Promise.resolve());
      const mockExecute = spy(() => Promise.reject(new Error("Test error")));
      const mockCommand: Command = {
        data: { name: "error-command" },
        execute: mockExecute,
      };

      client.commands.set("error-command", mockCommand as any);

      const mockInteraction = {
        isChatInputCommand: () => true,
        commandName: "error-command",
        client: client,
        replied: true,
        deferred: false,
        followUp: followUpSpy,
      } as unknown as Interaction;

      try {
        await client.emit(Events.InteractionCreate, mockInteraction);

        assertEquals(mockExecute.calls.length, 1);
        assertEquals(followUpSpy.calls.length, 1);
        assertEquals(followUpSpy.calls[0].args[0], {
          content: "There was an error while executing this command!",
          ephemeral: true,
        });
      } finally {
        client.commands.delete("error-command");
      }
    });

    it("チャットコマンド以外のインタラクションでは、コマンドを実行しない", async () => {
      const mockExecute = spy(() => Promise.resolve());
      const mockCommand: Command = {
        data: { name: "test" },
        execute: mockExecute,
      };
      client.commands.set("test", mockCommand as any);

      const mockInteraction = {
        isChatInputCommand: () => false,
      } as unknown as Interaction;

      await client.emit(Events.InteractionCreate, mockInteraction);

      assertEquals(mockExecute.calls.length, 0);
      client.commands.delete("test");
    });
  });
});
