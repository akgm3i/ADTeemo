import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { execute } from "./watch-settings.ts";

describe("サーバーの監視設定", () => {
  test("管理者以外が設定しても、保存APIを呼ばない", async () => {
    const interaction = new MockInteractionBuilder("watch-settings")
      .withStringOption("mode", "disabled").build();
    using save = stub(apiClient, "setGuildMatchWatchSettings", () => {
      throw new Error("unexpected save");
    });
    await execute(interaction);
    assertSpyCalls(save, 0);
  });
  test("管理者が有効化と通知先を指定すると、現在guildへ設定し上限超過数を案内する", async () => {
    const interaction = new MockInteractionBuilder("watch-settings")
      .withStringOption("mode", "enabled").withChannelOption("channel", {
        id: "notify",
      }).build();
    Object.defineProperty(interaction, "memberPermissions", {
      value: { has: () => true },
    });
    using save = stub(
      apiClient,
      "setGuildMatchWatchSettings",
      (settings) =>
        Promise.resolve({ success: true, settings, limitedAccountCount: 3 }),
    );
    using reply = stub(
      interaction,
      "editReply",
      () => Promise.resolve(undefined as never),
    );
    await execute(interaction);
    assertSpyCall(save, 0, {
      args: [{
        guildId: "mock-guild-id",
        enabled: true,
        notificationChannelId: "notify",
      }],
    });
    assertEquals(JSON.stringify(reply.calls[0].args).includes("3"), true);
  });
});
