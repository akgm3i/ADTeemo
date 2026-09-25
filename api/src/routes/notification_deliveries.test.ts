import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createApp } from "../app.ts";
import { createMigratedTestDatabase } from "../db/integration_test_harness.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";

const input = {
  guildId: "guild-1",
  targetDiscordId: "user-1",
  riotAccountPuuid: "puuid-1",
  channelId: "channel-1",
  messageId: null,
  matchId: "JP1_123",
  stage: 3,
  revision: 0,
  embed: { title: "試合終了" },
};
const key = "guild-1:user-1:JP1_123:result";
const base = `/notification-deliveries/${key}`;
const headers = {
  ...TEST_BOT_SERVICE_AUTH_HEADERS,
  "Content-Type": "application/json",
};

describe("通知配送API", () => {
  test("prepare・claim・completeを順に実行すると、永続receiptを返してpending一覧から除外する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    const app = createApp(
      createTestDependencies({ dbActions: database.actions }),
    );

    // Act
    const prepared = await app.request(base, {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    const pending = await app.request("/notification-deliveries/pending", {
      headers,
    });
    const claimed = await app.request(`${base}/claim`, {
      method: "POST",
      headers,
    });
    const { delivery } = await claimed.json();
    const completed = await app.request(`${base}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        leaseId: delivery.leaseId,
        messageId: "message-1",
      }),
    });
    const replay = await app.request(base, {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    const after = await app.request("/notification-deliveries/pending", {
      headers,
    });

    // Assert
    assertEquals(prepared.status, 200);
    assertEquals((await pending.json()).deliveries.length, 1);
    assertEquals(claimed.status, 200);
    assertEquals(completed.status, 200);
    assertEquals((await completed.json()).delivery.status, "delivered");
    assertEquals((await replay.json()).delivery.messageId, "message-1");
    assertEquals(await after.json(), { deliveries: [] });
  });

  test("未認証・未登録key・scope違い・不正failureを指定すると、対応するHTTPエラーを返す", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    const app = createApp(
      createTestDependencies({ dbActions: database.actions }),
    );

    // Act & Assert
    assertEquals(
      (await app.request(base, { method: "PUT", body: JSON.stringify(input) }))
        .status,
      401,
    );
    const missing = await app.request(`${base}/claim`, {
      method: "POST",
      headers,
    });
    assertEquals(missing.status, 404);
    assertEquals((await missing.json()).code, "RESOURCE_NOT_FOUND");
    await app.request(base, {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    const conflict = await app.request(base, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...input, guildId: "other-guild" }),
    });
    assertEquals(conflict.status, 409);
    const invalid = await app.request(`${base}/fail`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        leaseId: "lease",
        reason: "raw error with secrets",
        permanent: false,
      }),
    });
    assertEquals(invalid.status, 422);
  });
});
