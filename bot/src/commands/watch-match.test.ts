import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { CommandInteraction } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { data, execute } from "./watch-match.ts";

describe("Command: watch-match", () => {
  test("コマンド名とオプションが期待通りに設定されている", () => {
    const json = data.toJSON();
    assertEquals(json.name, "watch-match");
    assertEquals(json.options?.map((option) => option.name), ["member"]);
  });

  test("連携済みメンバーを指定すると、監視登録APIを呼び出す", async () => {
    const interaction = new MockInteractionBuilder("watch-match")
      .withUser({ id: "requester-1" })
      .withUserOption("member", {
        id: "target-1",
        toString: () => "<@target-1>",
      })
      .build();
    using watchStub = stub(
      apiClient,
      "watchMatch",
      () => Promise.resolve({ success: true as const }),
    );

    await execute(interaction as unknown as CommandInteraction);

    assertSpyCall(watchStub, 0, {
      args: [{
        guildId: "mock-guild-id",
        targetDiscordId: "target-1",
        requesterId: "requester-1",
        channelId: "mock-channel-id",
      }],
    });
  });

  test("未連携メンバーを指定すると、Riot ID登録が必要な専用メッセージを返す", async () => {
    const interaction = new MockInteractionBuilder("watch-match")
      .withUser({ id: "requester-1" })
      .withUserOption("member", {
        id: "target-1",
        toString: () => "<@target-1>",
      })
      .build();
    using editReplySpy = stub(
      interaction,
      "editReply",
      () => Promise.resolve({} as never),
    );
    using watchStub = stub(
      apiClient,
      "watchMatch",
      () =>
        Promise.resolve({
          success: false as const,
          error: "Riot account not found",
          status: 404 as const,
        }),
    );

    await execute(interaction as unknown as CommandInteraction);

    assertSpyCall(watchStub, 0);
    assertSpyCall(editReplySpy, 0);
    const replyOptions = editReplySpy.calls[0].args[0] as { content: string };
    assertStringIncludes(String(replyOptions.content), "<@target-1>");
    assertStringIncludes(String(replyOptions.content), "Riot ID");
    assertStringIncludes(String(replyOptions.content), "登録");
  });
});
