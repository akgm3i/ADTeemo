import { describe, test } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { data, execute } from "./health.ts";
import { apiClient } from "../api_client.ts";
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
      using checkHealthStub = stub(
        apiClient,
        "checkHealth",
        () =>
          Promise.resolve({
            success: true,
            message: "All systems operational.",
          }),
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
      assertSpyCalls(checkHealthStub, 1);
    });

    test("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      // Arrange
      using checkHealthStub = stub(
        apiClient,
        "checkHealth",
        () =>
          Promise.resolve({
            success: false,
            error: "Failed to communicate with API",
          }),
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
      assertSpyCalls(checkHealthStub, 1);
    });

    test("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      // Arrange
      using checkHealthStub = stub(
        apiClient,
        "checkHealth",
        () =>
          Promise.resolve({
            success: false,
            error: "Failed to communicate with API",
          }),
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
      assertSpyCalls(checkHealthStub, 1);
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
