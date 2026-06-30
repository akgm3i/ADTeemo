import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import {
  CommandInteraction,
  InteractionEditReplyOptions,
  Message,
} from "discord.js";
import { type MatchWatcher } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { data, execute } from "./watch-list.ts";

function watcher(
  overrides: Partial<MatchWatcher> = {},
): MatchWatcher {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    guildId: "mock-guild-id",
    targetDiscordId: "target-1",
    requesterId: "requester-1",
    channelId: "channel-1",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Command: watch-list", () => {
  test("コマンド名とオプションが期待通りに設定されている", () => {
    const json = data.toJSON();
    assertEquals(json.name, "watch-list");
    assertEquals(json.options, []);
  });

  test("ギルド内で実行すると、そのギルドの監視一覧APIを呼び出す", async () => {
    const interaction = new MockInteractionBuilder("watch-list").build();
    using listStub = stub(
      apiClient,
      "getEnabledMatchWatchersByGuild",
      () => Promise.resolve({ success: true as const, watchers: [] }),
    );

    await execute(interaction as unknown as CommandInteraction);

    assertSpyCall(listStub, 0, { args: ["mock-guild-id"] });
  });

  test("監視対象が0件の場合、分かりやすい空一覧メッセージを返す", async () => {
    const interaction = new MockInteractionBuilder("watch-list").build();
    using _listStub = stub(
      apiClient,
      "getEnabledMatchWatchersByGuild",
      () => Promise.resolve({ success: true as const, watchers: [] }),
    );
    using editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve({} as Message),
    );

    await execute(interaction as unknown as CommandInteraction);

    const content =
      (editStub.calls[0].args[0] as InteractionEditReplyOptions).content;
    assertEquals(
      content,
      messageHandler.formatMessage(messageKeys.matchTracking.watchList.empty),
    );
  });

  test("監視対象が多い場合でも、Discordのcontent制限内に収める", async () => {
    const interaction = new MockInteractionBuilder("watch-list").build();
    const watchers = Array.from({ length: 120 }, (_, index) =>
      watcher({
        targetDiscordId: `target-${index + 1}`,
        requesterId: `requester-${index + 1}`,
        channelId: `channel-${index + 1}`,
      }));
    using _listStub = stub(
      apiClient,
      "getEnabledMatchWatchersByGuild",
      () => Promise.resolve({ success: true as const, watchers }),
    );
    using editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve({} as Message),
    );

    await execute(interaction as unknown as CommandInteraction);

    const content =
      (editStub.calls[0].args[0] as InteractionEditReplyOptions).content;
    assert(typeof content === "string");
    assert(content.length <= 2000);
    assertStringIncludes(
      content,
      messageHandler.formatMessage(
        messageKeys.matchTracking.watchList.item,
        {
          position: 1,
          targetId: "target-1",
          channelId: "channel-1",
        },
      ),
    );
    assert(!content.includes("<@target-120>"));
  });
});
