import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { spy, stub } from "jsr:@std/testing/mock";
import {
  type CommandInteraction,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type MessagePayload,
} from "npm:discord.js";
import { execute } from "./health.ts";

describe("Health Command", () => {
  describe("execute", () => {
    // Helper function to create spies and a mock interaction
    const setupMocks = () => {
      const deferReplySpy = spy(
        (_options?: InteractionDeferReplyOptions) => Promise.resolve(),
      );
      const editReplySpy = spy(
        (_options: string | MessagePayload | InteractionEditReplyOptions) =>
          Promise.resolve(),
      );
      const interaction = {
        isChatInputCommand: () => true,
        deferReply: deferReplySpy,
        editReply: editReplySpy,
      } as unknown as CommandInteraction;
      return { deferReplySpy, editReplySpy, interaction };
    };

    it("APIが正常な時にコマンドを実行すると、APIからの成功メッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                message: "All systems operational.",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          ),
      );
      const { deferReplySpy, editReplySpy, interaction } = setupMocks();

      try {
        await execute(interaction);
        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "All systems operational.",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("APIがメッセージを返さない時にコマンドを実行すると、デフォルトの成功メッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, message: null }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          ),
      );
      const { deferReplySpy, editReplySpy, interaction } = setupMocks();

      try {
        await execute(interaction);
        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "The bot is healthy!",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response("Internal Server Error", { status: 500 }),
          ),
      );
      const { deferReplySpy, editReplySpy, interaction } = setupMocks();

      try {
        await execute(interaction);
        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "Failed to check the bot's health. API returned status 500",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network disconnect")),
      );
      const { deferReplySpy, editReplySpy, interaction } = setupMocks();

      try {
        await execute(interaction);
        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "Failed to check the bot's health. Failed to communicate with API",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("チャットインプットコマンドでないインタラクションで実行すると、何もせずに処理を中断する", async () => {
      const deferReplySpy = spy(
        (_options?: InteractionDeferReplyOptions) => Promise.resolve(),
      );
      const interaction = {
        isChatInputCommand: () => false,
        deferReply: deferReplySpy,
      } as unknown as CommandInteraction;

      await execute(interaction);
      assertEquals(deferReplySpy.calls.length, 0);
    });
  });
});
