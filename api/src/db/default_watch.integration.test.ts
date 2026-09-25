import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";

const account = (puuid: string, discordId = "owner") => ({
  discordId,
  puuid,
  gameName: puuid,
  tagLine: "JP1",
  platform: "jp1" as const,
  region: "asia" as const,
});

describe("guild membershipと全accountの既定監視", () => {
  test("通知先とguild membershipを設定すると、所属ユーザーの全accountだけが監視対象になる", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.upsertRiotAccount(account("sub"));
    await database.actions.upsertRiotAccount(account("outsider", "other"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    assertEquals(await database.actions.getEnabledMatchWatchers(), []);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    const watchers = await database.actions.getEnabledMatchWatchers();
    assertEquals(watchers.map((w) => w.riotAccountPuuid).sort(), [
      "main",
      "sub",
    ]);
    assertEquals(
      watchers.every((w) =>
        w.targetDiscordId === "owner" && w.channelId === "channel"
      ),
      true,
    );
  });

  test("本人がopt-outするとguild内の全accountとpending通知を停止し、他guildには影響しない", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.upsertRiotAccount(account("sub"));
    for (const guildId of ["guild", "other-guild"]) {
      await database.actions.syncGuildMatchWatchMembers(guildId, ["owner"]);
      await database.actions.setGuildMatchWatchSettings({
        guildId,
        enabled: true,
        notificationChannelId: "channel",
      });
    }
    await database.actions.prepareNotificationDelivery({
      key: "notification",
      guildId: "guild",
      targetDiscordId: "owner",
      riotAccountPuuid: "sub",
      channelId: "channel",
      messageId: null,
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: {},
    });
    await database.actions.setMatchWatchOptOut("guild", "owner", true);
    assertEquals(
      (await database.actions.getEnabledMatchWatchers()).map((w) => w.guildId),
      ["other-guild", "other-guild"],
    );
    assertEquals(await database.actions.getPendingNotificationDeliveries(), []);
    assertEquals(
      await database.actions.claimNotificationDelivery("notification"),
      null,
    );
    await database.actions.setMatchWatchOptOut("guild", "owner", false);
    assertEquals(
      (await database.actions.getEnabledMatchWatchersByGuild("guild")).length,
      2,
    );
  });

  test("opt-out後に古いworkerが配送をprepareしても、新規通知をclaimできない", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.upsertMatchWatcher({
      guildId: "guild",
      targetDiscordId: "owner",
      requesterId: "owner",
      channelId: "channel",
    });
    await database.actions.setMatchWatchOptOut("guild", "owner", true);
    const delivery = await database.actions.prepareNotificationDelivery({
      key: "stale-worker",
      guildId: "guild",
      targetDiscordId: "owner",
      riotAccountPuuid: "main",
      channelId: "channel",
      messageId: null,
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: {},
    });
    assertEquals(delivery.status, "failed");
    assertEquals(delivery.reason, "watch_disabled");
    assertEquals(
      await database.actions.claimNotificationDelivery(delivery.key),
      null,
    );
  });

  test("停止中に拒否された同じ配送を本人がopt-in後に再要求すると、同じkeyで監視を再開できる", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    await database.actions.setMatchWatchOptOut("guild", "owner", true);
    const intent = {
      key: "resume-intent",
      guildId: "guild",
      targetDiscordId: "owner",
      riotAccountPuuid: "main",
      channelId: "channel",
      messageId: null,
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: {},
    };
    assertEquals(
      (await database.actions.prepareNotificationDelivery(intent)).status,
      "failed",
    );
    await database.actions.setMatchWatchOptOut("guild", "owner", false);
    assertEquals(
      (await database.actions.prepareNotificationDelivery(intent)).status,
      "pending",
    );
    assertEquals(
      (await database.actions.claimNotificationDelivery(intent.key))?.attempts,
      1,
    );
  });

  test("送信結果不明で停止した配送をopt-in後に再要求すると、attemptとreconciliationを保持する", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    const intent = {
      key: "uncertain-intent",
      guildId: "guild",
      targetDiscordId: "owner",
      riotAccountPuuid: "main",
      channelId: "channel",
      messageId: null,
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: {},
    };
    await database.actions.prepareNotificationDelivery(intent);
    const original = await database.actions.claimNotificationDelivery(
      intent.key,
    );
    await database.actions.setMatchWatchOptOut("guild", "owner", true);
    await database.actions.setMatchWatchOptOut("guild", "owner", false);
    const resumed = await database.actions.prepareNotificationDelivery(intent);
    assertEquals(resumed.attempts, 1);
    assertEquals(resumed.reason, "reconciliation");
    assertEquals(resumed.leaseId, null);
    const next = await database.actions.claimNotificationDelivery(intent.key);
    assertEquals(next?.attempts, 2);
    assertEquals(next?.leaseId === original?.leaseId, false);
  });

  test("再同期でguildを退出したユーザーは、監視と配送候補から除外される", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    await database.actions.syncGuildMatchWatchMembers("guild", []);
    assertEquals(await database.actions.getEnabledMatchWatchers(), []);
  });

  test("account数がguild上限を超えると、決定的な上限内だけ監視し不足件数を返す", async () => {
    await using database = await createMigratedTestDatabase({
      matchWatcherMaxEnabledPerGuild: 1,
    });
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.upsertRiotAccount(account("sub"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    const result = await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    assertEquals(result.limitedAccountCount, 1);
    assertEquals(
      (await database.actions.getEnabledMatchWatchers()).map((w) =>
        w.riotAccountPuuid
      ),
      ["main"],
    );
  });

  test("別accountの状態を更新すると、同じDiscordユーザーのmain状態を上書きしない", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("main"));
    await database.actions.upsertRiotAccount(account("sub"));
    await database.actions.syncGuildMatchWatchMembers("guild", ["owner"]);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild",
      enabled: true,
      notificationChannelId: "channel",
    });
    await database.actions.updateMatchWatcherState("guild", "owner", {
      riotAccountPuuid: "sub",
      lastState: "IN_GAME",
      currentGameId: "123",
    });
    const watchers = await database.actions.getEnabledMatchWatchers();
    assertEquals(
      watchers.find((w) => w.riotAccountPuuid === "main")?.lastState,
      "IDLE",
    );
    assertEquals(
      watchers.find((w) => w.riotAccountPuuid === "sub")?.currentGameId,
      "123",
    );
  });
});
