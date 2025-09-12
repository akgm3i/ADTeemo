import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { execute } from "./health.ts";
import { newMockChatInputCommandInteractionBuilder } from "../test_utils.ts";
import { formatMessage, messageKeys } from "../messages.ts";

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
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(response),
      );
      const interaction = newMockChatInputCommandInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        "All systems operational.",
      );
    });

    it("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      const response = new Response("Internal Server Error", { status: 500 });
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(response),
      );
      const interaction = newMockChatInputCommandInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        formatMessage(messageKeys.health.error.failure, {
          error: "API returned status 500",
        }),
      );
    });

    it("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network disconnect")),
      );
      const interaction = newMockChatInputCommandInteractionBuilder().build();

      await execute(interaction);

      assertEquals(interaction.deferReply.calls.length, 1);
      assertEquals(interaction.editReply.calls.length, 1);
      assertEquals(
        interaction.editReply.calls[0].args[0],
        formatMessage(messageKeys.health.error.failure, {
          error: "Failed to communicate with API",
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
