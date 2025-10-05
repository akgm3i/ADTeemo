import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { execute } from "./set-main-role.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { Lane } from "@adteemo/api/schema";
import { apiClient } from "../api_client.ts";

describe("Set Main Role Command", () => {
  describe("execute", () => {
    test("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
      // Arrange
      using setMainRoleStub = stub(
        apiClient,
        "setMainRole",
        () => Promise.resolve({ success: true }),
      );
      using formatMessageSpy = spy(messageHandler, "formatMessage");
      const interaction = new MockInteractionBuilder()
        .withStringOption("role", "Jungle")
        .build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(setMainRoleStub, 0, {
        args: [interaction.user.id, "Jungle" as Lane],
      });
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.userManagement.setMainRole.success, {
          role: "Jungle",
        }],
      });
      assertSpyCall(editSpy, 0);
    });

    test("API呼び出しが失敗した時にメインロールを設定すると、エラーメッセージで応答する", async () => {
      // Arrange
      using setMainRoleStub = stub(
        apiClient,
        "setMainRole",
        () => Promise.resolve({ success: false, error: "API error" }),
      );
      using formatMessageSpy = spy(messageHandler, "formatMessage");
      const interaction = new MockInteractionBuilder()
        .withStringOption("role", "Jungle")
        .build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(setMainRoleStub, 0, {
        args: [interaction.user.id, "Jungle" as Lane],
      });
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.userManagement.setMainRole.failure, {
          error: "API error",
        }],
      });
      assertSpyCall(editSpy, 0);
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
