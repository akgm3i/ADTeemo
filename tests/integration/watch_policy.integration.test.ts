import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { createMatchWatchMembershipSync } from "../../bot/src/features/match_watch_membership.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";
describe("Bot client→監視policy API→migrated SQLite", () => {
  test("所属同期と通知先を保存すると全accountを監視し、本人opt-outで全て停止する", async () => {
    await using db = await createMigratedTestDatabase();
    for (const puuid of ["main", "sub"]) {
      await db.actions.upsertRiotAccount({
        discordId: "owner",
        puuid,
        gameName: puuid,
        tagLine: "JP1",
        platform: "jp1",
        region: "asia",
      });
    }
    const client = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: db.actions })),
    );
    assertEquals(
      (await client.syncGuildMatchWatchMembers("guild", ["owner"])).success,
      true,
    );
    assertEquals(
      await client.setGuildMatchWatchSettings({
        guildId: "guild",
        enabled: true,
        notificationChannelId: "channel",
      }),
      {
        success: true,
        settings: {
          guildId: "guild",
          enabled: true,
          notificationChannelId: "channel",
        },
        limitedAccountCount: 0,
      },
    );
    const watchers = await client.getEnabledMatchWatchersByGuild("guild");
    assertEquals(
      watchers.success &&
        watchers.watchers.map((w) => w.riotAccountPuuid).sort(),
      ["main", "sub"],
    );
    assertEquals(
      (await client.setMatchWatchOptOut("guild", "owner", true)).success,
      true,
    );
    assertEquals(await client.getEnabledMatchWatchersByGuild("guild"), {
      success: true,
      watchers: [],
    });
    const selected = await client.getRiotAccount("owner", "sub");
    assertEquals(selected.success && selected.account.puuid, "sub");
    assertEquals(selected.success && selected.account.isMain, false);
    assertEquals((await client.getRiotAccount("other", "sub")).success, false);
    assertEquals(
      (await client.setMainRiotAccount("owner", "sub")).success,
      true,
    );
    const main = await client.getRiotAccount("owner");
    assertEquals(main.success && main.account.puuid, "sub");
    const accounts = await client.getRiotAccounts("owner");
    assertEquals(accounts.success && accounts.accounts.length, 2);
    assertEquals(
      (await client.deleteRiotAccount("other", "sub")).success,
      false,
    );
    assertEquals(
      (await client.deleteRiotAccount("owner", "sub")).success,
      true,
    );
    const final = await client.getRiotAccounts("owner");
    assertEquals(final.success && final.accounts.map((a) => a.puuid), ["main"]);
  });
  test("Gateway差分を実APIへ同期すると、参加者を監視し退出者とpending配送を対象guildだけ停止する", async () => {
    // Arrange
    await using db = await createMigratedTestDatabase();
    for (const discordId of ["departing", "joining"]) {
      await db.actions.upsertRiotAccount({
        discordId,
        puuid: `${discordId}-account`,
        gameName: discordId,
        tagLine: "JP1",
        platform: "jp1",
        region: "asia",
      });
    }
    const client = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: db.actions })),
    );
    const membership = createMatchWatchMembershipSync(client);
    let fullReads = 0;
    await membership.initialize(
      ["guild", "other-guild"].map((id) => ({
        id,
        readMemberIds: () => {
          fullReads++;
          return Promise.resolve(["departing"]);
        },
      })),
      () => {},
    );
    for (const guildId of ["guild", "other-guild"]) {
      assertEquals(
        (await client.setGuildMatchWatchSettings({
          guildId,
          enabled: true,
          notificationChannelId: "channel",
        })).success,
        true,
      );
      const prepared = await client.prepareNotificationDelivery({
        key: `${guildId}-pending`,
        guildId,
        targetDiscordId: "departing",
        riotAccountPuuid: "departing-account",
        channelId: "channel",
        messageId: null,
        matchId: "JP1_123",
        stage: 3,
        revision: 0,
        embed: {},
      });
      assertEquals(prepared.success && prepared.delivery.status, "pending");
    }

    // Act
    await membership.addMember("guild", "joining");
    await membership.removeMember("guild", "departing");

    // Assert
    assertEquals(fullReads, 2);
    const watchers = await client.getEnabledMatchWatchers();
    assertEquals(
      watchers.success && watchers.watchers.map((watcher) => ({
        guildId: watcher.guildId,
        discordId: watcher.targetDiscordId,
      })).sort((a, b) => a.guildId.localeCompare(b.guildId)),
      [
        { guildId: "guild", discordId: "joining" },
        { guildId: "other-guild", discordId: "departing" },
      ],
    );
    const deliveries = await client.getPendingNotificationDeliveries();
    assertEquals(
      deliveries.success &&
        deliveries.deliveries.map((delivery) => delivery.key),
      ["other-guild-pending"],
    );
    assertEquals(await client.claimNotificationDelivery("guild-pending"), {
      success: true,
      delivery: null,
    });
    const stale = await client.prepareNotificationDelivery({
      key: "stale-worker",
      guildId: "guild",
      targetDiscordId: "departing",
      riotAccountPuuid: "departing-account",
      channelId: "channel",
      messageId: null,
      matchId: "JP1_124",
      stage: 3,
      revision: 0,
      embed: {},
    });
    assertEquals(stale.success && stale.delivery.reason, "watch_disabled");
  });
});
