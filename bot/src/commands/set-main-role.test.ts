import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { spy, stub } from "jsr:@std/testing/mock";
import {
  type CommandInteraction,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type MessagePayload,
} from "npm:discord.js";
import { type Lane } from "@adteemo/api/schema";
import { execute } from "./set-main-role.ts";

describe("Set Main Role Command", () => {
  describe("execute", () => {
    // Helper function to create mocks
    const setupMocks = (role: Lane | null) => {
      const deferReplySpy = spy(
        (_options?: InteractionDeferReplyOptions) => Promise.resolve(),
      );
      const editReplySpy = spy(
        (_options: string | MessagePayload | InteractionEditReplyOptions) =>
          Promise.resolve(),
      );
      const getStringSpy = spy((_name: string, _required?: boolean) => role);

      const interaction = {
        isChatInputCommand: () => true,
        deferReply: deferReplySpy,
        editReply: editReplySpy,
        options: {
          getString: getStringSpy,
        },
        user: {
          id: "test-user-id",
        },
      } as unknown as CommandInteraction;

      return { deferReplySpy, editReplySpy, getStringSpy, interaction };
    };

    it("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ success: true }), { status: 200 }),
          ),
      );
      const { deferReplySpy, editReplySpy, getStringSpy, interaction } =
        setupMocks("Top");

      try {
        await execute(interaction);

        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(getStringSpy.calls[0].args[0], "role");
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "Your main role has been set to **Top**.",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("API呼び出しが失敗した時にメインロールを設定すると、エラーメッセージで応答する", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ success: false, error: "DB error" }),
              {
                status: 500,
              },
            ),
          ),
      );
      const { deferReplySpy, editReplySpy, interaction } = setupMocks(
        "Jungle",
      );

      try {
        await execute(interaction);

        assertEquals(deferReplySpy.calls.length, 1);
        assertEquals(editReplySpy.calls.length, 1);
        assertEquals(
          editReplySpy.calls[0].args[0],
          "Failed to set your main role. API returned status 500",
        );
      } finally {
        fetchStub.restore();
      }
    });

    it("チャットインプットコマンドでないインタラクションで実行すると、何もせずに処理を中断する", async () => {
      const { deferReplySpy, interaction } = setupMocks("Top");
      // deno-lint-ignore no-explicit-any
      (interaction as any).isChatInputCommand = () => false;

      await execute(interaction);

      assertEquals(deferReplySpy.calls.length, 0);
    });
  });
});
