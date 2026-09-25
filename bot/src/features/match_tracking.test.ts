import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import type { Client } from "discord.js";
import type { NotificationDelivery } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { matchTracker } from "./match_tracking.ts";
import {
  account,
  trackingNow,
  watcher,
} from "./testing/match_tracking_fixtures.ts";

function unusedDiscordClient(): Client {
  return {
    channels: {
      fetch() {
        throw new Error("Discord should not be used");
      },
    },
  } as unknown as Client;
}

describe("match tracking composition smoke", () => {
  test("pending配送がなくIDLEの対象が試合外のとき、既定compositionからBackend検査へ接続しDiscordへ投稿しない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    // Arrange
    using pending = stub(
      apiClient,
      "getPendingNotificationDeliveries",
      () => Promise.resolve({ success: true, deliveries: [] }),
    );
    using watchers = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () => Promise.resolve({ success: true, watchers: [watcher()] }),
    );
    using active = stub(
      apiClient,
      "inspectMatchWatcherActiveGame",
      () =>
        Promise.resolve({
          success: true,
          account: account(),
          activeGame: null,
          notificationIntent: null,
          stateTransition: null,
        }),
    );

    // Act
    await matchTracker.processMatchWatchers(unusedDiscordClient());

    // Assert
    assertSpyCalls(pending, 1);
    assertSpyCalls(watchers, 1);
    assertSpyCall(active, 0, {
      args: ["guild-1", "target-1", {
        inspectionBatchId: "00000000-0000-4000-8000-000000000001",
        riotAccountPuuid: "puuid-1",
        lastState: "IDLE",
        currentGameId: null,
        currentNotificationMessageId: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
      }],
    });
  });

  test("pending intentが保存済みのとき、既定compositionでDiscord既存投稿を編集してreceiptを保存する", async () => {
    // Arrange
    const delivery: NotificationDelivery = {
      key: "smoke-key",
      riotAccountPuuid: "puuid-1",
      guildId: "guild-1",
      targetDiscordId: "target-1",
      channelId: "channel-1",
      messageId: "existing-message",
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: { title: "試合終了" },
      status: "pending",
      attempts: 0,
      nextAttemptAt: trackingNow.getTime(),
      leaseId: null,
      leaseUntil: null,
      reason: null,
      createdAt: trackingNow.getTime(),
    };
    const message = {
      id: "existing-message",
      edit: () => Promise.resolve({ id: "existing-message" }),
    };
    const channel = {
      send: () => {
        throw new Error("Existing message must be edited");
      },
      messages: { fetch: () => Promise.resolve(message) },
      isTextBased: () => true,
    };
    const client = {
      channels: { fetch: () => Promise.resolve(channel) },
    } as unknown as Client;
    using edit = stub(
      message,
      "edit",
      () => Promise.resolve({ id: "existing-message" }),
    );
    using pending = stub(
      apiClient,
      "getPendingNotificationDeliveries",
      () => Promise.resolve({ success: true, deliveries: [delivery] }),
    );
    using claim = stub(
      apiClient,
      "claimNotificationDelivery",
      () =>
        Promise.resolve({
          success: true,
          delivery: { ...delivery, leaseId: "smoke-lease", attempts: 1 },
        }),
    );
    using complete = stub(
      apiClient,
      "completeNotificationDelivery",
      () =>
        Promise.resolve({
          success: true,
          delivery: { ...delivery, status: "delivered" },
        }),
    );
    using _watchers = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () => Promise.resolve({ success: true, watchers: [] }),
    );

    // Act
    await matchTracker.processMatchWatchers(client);

    // Assert
    assertSpyCalls(pending, 1);
    assertSpyCall(claim, 0, { args: ["smoke-key"] });
    assertSpyCalls(edit, 1);
    assertSpyCall(complete, 0, {
      args: ["smoke-key", {
        leaseId: "smoke-lease",
        messageId: "existing-message",
      }],
    });
  });

  test("pending intentの読取に失敗すると、既定compositionは成功終了せずworkerへ失敗を伝播する", async () => {
    // Arrange
    using pending = stub(
      apiClient,
      "getPendingNotificationDeliveries",
      () => Promise.resolve({ success: false, error: "database unavailable" }),
    );

    // Act & Assert
    await assertRejects(
      () => matchTracker.processMatchWatchers(unusedDiscordClient()),
      Error,
      "Notification pending read failed",
    );
    assertEquals(pending.calls.length, 1);
  });
});
