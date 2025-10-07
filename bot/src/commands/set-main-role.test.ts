import { describe, test } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { data, execute } from "./set-main-role.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { apiClient } from "../api_client.ts";

describe("Set Main Role Command", () => {
  describe("定義", () => {
    test("コマンド名と説明が期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "set-main-role");
      assertEquals(
        json.description,
        "カスタムゲームでのメインロールを登録します。",
      );

      const options = json.options ?? [];
      assertEquals(options.map((option) => option.name), ["role"]);
      const roleOption = options[0];
      assertEquals(roleOption?.description, "メインロールとして登録するロール");
      assertEquals(roleOption?.required, true);
    });
  });

  describe("execute", () => {
    test("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
      // Arrange
      using setMainRoleStub = stub(
        apiClient,
        "setMainRole",
        () => Promise.resolve({ success: true }),
      );
      using formatMessageSpy = spy(messageHandler, "formatMessage");
      const interaction = new MockInteractionBuilder("set-main-role")
        .withStringOption("role", "Jungle")
        .build();
      const guildId = interaction.guild?.id ?? "";
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      const call = setMainRoleStub.calls[0];
      const args = call.args as unknown[];
      assertEquals(args[0], interaction.user.id);
      assertEquals(args[1], guildId);
      assertEquals(args[2], "Jungle");
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
      const interaction = new MockInteractionBuilder("set-main-role")
        .withStringOption("role", "Jungle")
        .build();
      const guildId = interaction.guild?.id ?? "";
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      const call = setMainRoleStub.calls[0];
      const args = call.args as unknown[];
      assertEquals(args[0], interaction.user.id);
      assertEquals(args[1], guildId);
      assertEquals(args[2], "Jungle");
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.userManagement.setMainRole.failure, {
          error: "API error",
        }],
      });
      assertSpyCall(editSpy, 0);
    });

    test("ChatInputCommandでないInteractionで実行すると、何もせずに処理を中断する", async () => {
      // Arrange
      const interaction = new MockInteractionBuilder("set-main-role")
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
