import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { stub } from "jsr:@std/testing/mock";
import { execute } from "./health.ts";
import { newMockInteractionBuilder } from "../test_utils.ts";

describe("Health Command", () => {
  describe("execute", () => {
    it("APIが正常な時にコマンドを実行すると、APIからの成功メッセージで応答する", async () => {
      const response = new Response(
        JSON.stringify({
          ok: true,
          message: "All systems operational.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
      using _fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(response));
      const interaction = newMockInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        "All systems operational.",
      );
    });

    it("APIがメッセージを返さない時にコマンドを実行すると、デフォルトの成功メッセージで応答する", async () => {
      const response = new Response(
        JSON.stringify({ ok: true, message: null }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
      using _fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(response));
      const interaction = newMockInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        "The bot is healthy!",
      );
    });

    it("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      const response = new Response("Internal Server Error", { status: 500 });
      using _fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(response));
      const interaction = newMockInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        "Failed to check the bot's health. API returned status 500",
      );
    });

    it("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      using _fetchStub = stub(globalThis, "fetch", () =>
        Promise.reject(new Error("Network disconnect")));
      const interaction = newMockInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        "Failed to check the bot's health. Failed to communicate with API",
      );
    });

    it("チャットインプットコマンドでないインタラクションで実行すると、何もせずに処理を中断する", async () => {
      const interaction = newMockInteractionBuilder()
        .withIsChatInputCommand(false)
        .build();

      await execute(interaction);
      assertEquals(interaction.deferReply.calls.length, 0);
    });
  });
});
