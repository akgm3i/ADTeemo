import { describe, test } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { data, execute } from "./health.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";

describe("Health Command", () => {
  describe("定義", () => {
    test("コマンド名と説明が期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "health");
      assertEquals(
        json.description,
        "Botとバックエンドの稼働状況を確認します。",
      );
    });
  });

  describe("execute", () => {
    test("APIが正常な時にコマンドを実行すると、APIからの成功メッセージで応答する", async () => {
      // Arrange
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
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0, {
        args: ["All systems operational."],
      });
    });

    test("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      // Arrange
      const response = new Response("Internal Server Error", { status: 500 });
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(response),
      );
      using formatMessageSpy = spy(messageHandler, "formatMessage");
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.health.error.failure, {
          error: "Failed to communicate with API",
        }],
      });
    });

    test("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      // Arrange
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network disconnect")),
      );
      using formatMessageSpy = spy(messageHandler, "formatMessage");
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.health.error.failure, {
          error: "Failed to communicate with API",
        }],
      });
    });

    test("ChatInputCommandでないInteractionで実行すると、何もせずに処理を中断する", async () => {
      // Arrange
      const interaction = new MockInteractionBuilder()
        .setIsChatInputCommand(false)
        .build();
      using deferSpy = spy(interaction, "deferReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCalls(deferSpy, 0);
    });
  });
});
