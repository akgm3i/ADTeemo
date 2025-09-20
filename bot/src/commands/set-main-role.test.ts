import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { execute, testable } from "./set-main-role.ts";
import { messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { Lane } from "@adteemo/api/schema";

describe("Set Main Role Command", () => {
  describe("execute", () => {
    it("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
      using setMainRoleStub = stub(
        testable.apiClient,
        "setMainRole",
        () => Promise.resolve({ success: true, error: null }),
      );
      using formatMessageSpy = spy(testable, "formatMessage");

      const interaction = new MockInteractionBuilder()
        .withUser({ id: "user-123" })
        .withStringOption("role", "Top")
        .build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(setMainRoleStub, 0, { args: ["user-123", "Top" as Lane] });
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [
          messageKeys.userManagement.setMainRole.success,
          { role: "Top" },
        ],
      });
    });

    it("API呼び出しが失敗した時にメインロールを設定すると、エラーメッセージで応答する", async () => {
      using setMainRoleStub = stub(
        testable.apiClient,
        "setMainRole",
        () => Promise.resolve({ success: false, error: "API Error" }),
      );
      using formatMessageSpy = spy(testable, "formatMessage");

      const interaction = new MockInteractionBuilder()
        .withUser({ id: "user-123" })
        .withStringOption("role", "Jungle")
        .build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(setMainRoleStub, 0, {
        args: ["user-123", "Jungle" as Lane],
      });
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [
          messageKeys.userManagement.setMainRole.failure,
          { error: "API Error" },
        ],
      });
    });

    it("ChatInputCommandでないInteractionで実行すると、何もせずに処理を中断する", async () => {
      const interaction = new MockInteractionBuilder()
        .setIsChatInputCommand(false)
        .build();
      using deferSpy = spy(interaction, "deferReply");

      await execute(interaction);

      assertSpyCalls(deferSpy, 0);
    });
  });
});
