import { assertEquals, assertIsError } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { eq } from "drizzle-orm";
import { createDbActions } from "./actions.ts";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";
import { guilds, userGuildProfiles, users } from "./schema.ts";

const account = {
  discordId: "account-owner",
  puuid: "account-puuid",
  gameName: "Teemo",
  tagLine: "JP1",
  platform: "jp1" as const,
  region: "asia" as const,
};

describe("同じDBを使うrepository間の並行操作", () => {
  test("アカウント登録と別ユーザーのロール更新を同時に実行すると、両方の完全な結果を保存する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();

    // Act
    const results = await Promise.allSettled([
      database.actions.upsertRiotAccount(account),
      database.actions.setMainRole("role-owner", "guild-1", "Top"),
    ]);

    // Assert
    assertEquals(results.map((result) => result.status), [
      "fulfilled",
      "fulfilled",
    ]);
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId(account.discordId))
        ?.puuid,
      account.puuid,
    );
    const [profile] = await database.db.select().from(userGuildProfiles);
    assertEquals([profile.userId, profile.guildId, profile.mainRole], [
      "role-owner",
      "guild-1",
      "Top",
    ]);
  });

  test("監視pollと通常更新・transaction外の書き込みが重なると、同じDBの複数actionsでも全操作を完了する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account);
    await database.actions.setGuildMatchWatchSettings({
      guildId: "guild-1",
      enabled: true,
      notificationChannelId: "channel-1",
    });
    await database.actions.syncGuildMatchWatchMembers("guild-1", [
      account.discordId,
    ]);
    const otherActions = createDbActions(database.db);

    // Act
    const results = await Promise.allSettled([
      database.actions.getEnabledMatchWatchers(),
      otherActions.setMainRole("role-owner", "guild-1", "Support"),
      otherActions.upsertUser("standalone-user"),
      database.actions.ensureGuild("standalone-guild"),
      database.actions.createAuthState("new-state", {
        discordId: account.discordId,
        guildId: "guild-1",
        platform: "jp1",
        region: "asia",
      }),
    ]);

    // Assert
    assertEquals(
      results.map((result) => result.status),
      Array(5).fill("fulfilled"),
    );
    assertEquals(
      (await database.actions.getEnabledMatchWatchers()).map((watcher) =>
        watcher.riotAccountPuuid
      ),
      [account.puuid],
    );
    const [profile] = await database.db.select().from(userGuildProfiles);
    assertEquals(profile.mainRole, "Support");
    assertEquals(
      (await database.db.select().from(users).where(
        eq(users.discordId, "standalone-user"),
      )).length,
      1,
    );
    assertEquals(
      (await database.db.select().from(guilds).where(
        eq(guilds.id, "standalone-guild"),
      )).length,
      1,
    );
    assertEquals(
      (await otherActions.consumeAuthState("new-state"))?.discordId,
      account.discordId,
    );
  });

  test("transaction途中の制約エラーでrollbackしても、待機中と後続の書き込みを継続する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.client.execute(`
      CREATE TRIGGER reject_profile BEFORE INSERT ON user_guild_profiles
      WHEN NEW.user_id = 'rejected-user'
      BEGIN SELECT RAISE(ABORT, 'test profile constraint'); END
    `);

    // Act
    const results = await Promise.allSettled([
      database.actions.setMainRole("rejected-user", "rejected-guild", "Top"),
      database.actions.upsertRiotAccount(account),
      database.actions.ensureGuild("surviving-guild"),
    ]);
    await database.actions.setMainRole("next-user", "next-guild", "Bottom");

    // Assert
    assertEquals(results.map((result) => result.status), [
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    const failed = results[0];
    if (failed.status === "rejected") {
      assertIsError(failed.reason);
      assertIsError(failed.reason.cause, Error, "test profile constraint");
    }
    assertEquals(
      (await database.db.select().from(users).where(
        eq(users.discordId, "rejected-user"),
      )).length,
      0,
    );
    assertEquals(
      (await database.db.select().from(guilds).where(
        eq(guilds.id, "rejected-guild"),
      )).length,
      0,
    );
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId(account.discordId))
        ?.puuid,
      account.puuid,
    );
    const [profile] = await database.db.select().from(userGuildProfiles);
    assertEquals([profile.userId, profile.mainRole], ["next-user", "Bottom"]);
  });
});
