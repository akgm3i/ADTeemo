import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { execute, testable } from "./health.ts";
import { messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";

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
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0, {
        args: ["All systems operational."],
      });
    });

    it("APIがエラーを返す時にコマンドを実行すると、APIのエラーを含んだメッセージで応答する", async () => {
      const response = new Response("Internal Server Error", { status: 500 });
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(response),
      );
      using formatMessageSpy = spy(testable, "formatMessage");
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.health.error.failure, {
          error: "API returned status 500",
        }],
      });
    });

    it("APIとの通信に失敗した時にコマンドを実行すると、通信失敗を示すメッセージで応答する", async () => {
      using _fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network disconnect")),
      );
      using formatMessageSpy = spy(testable, "formatMessage");
      const interaction = new MockInteractionBuilder().build();
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(editSpy, 0);
      assertSpyCall(formatMessageSpy, 0, {
        args: [messageKeys.health.error.failure, {
          error: "Failed to communicate with API",
        }],
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
