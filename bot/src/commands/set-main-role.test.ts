import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { execute } from "./set-main-role.ts";
import { newMockChatInputCommandInteractionBuilder } from "../test_utils.ts";
import { m, t } from "@adteemo/messages";

describe("Set Main Role Command", () => {
  describe("execute", () => {
    it("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ success: true }), { status: 200 }),
          ),
      );
      const interaction = newMockChatInputCommandInteractionBuilder()
        .withStringOption(() => "Top")
        .build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.options.getString.calls[0].args[0], "role");
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        t(m.userManagement.setMainRole.success, { role: "Top" }),
      );
    });

    it("API呼び出しが失敗した時にメインロールを設定すると、エラーメッセージで応答する", async () => {
      const fetchResponse = new Response(
        JSON.stringify({ success: false, error: "DB error" }),
        { status: 500 },
      );
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(fetchResponse),
      );
      const interaction = newMockChatInputCommandInteractionBuilder()
        .withStringOption(() => "Jungle")
        .build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        t(m.userManagement.setMainRole.failure, {
          error: "API returned status 500",
        }),
      );
    });

    it("ChatInputCommandでないInteractionで実行すると、何もせずに処理を中断する", async () => {
      const interaction = newMockChatInputCommandInteractionBuilder()
        .withIsChatInputCommand(false)
        .build();
      await execute(interaction);
      assertEquals(interaction.deferReply.calls.length, 0);
    });
  });
});
