import { eq } from "drizzle-orm";
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";
import {
  customGameEvents,
  guilds,
  matches,
  matchParticipants,
  matchRankSnapshots,
  matchWatchers,
  pendingMatchRankSnapshots,
  riotAccounts,
  users,
} from "./schema.ts";

function riotAccount(discordId: string, puuid = `puuid-${discordId}`) {
  return {
    discordId,
    puuid,
    gameName: `Teemo-${discordId}`,
    tagLine: "JP1",
    platform: "jp1" as const,
    region: "asia" as const,
  };
}

function participant(
  userId: string,
  lane: "Top" | "Jungle" = "Top",
) {
  return {
    userId,
    team: lane === "Top" ? "BLUE" : "RED",
    win: lane === "Top",
    lane,
    kills: 1,
    deaths: 2,
    assists: 3,
    cs: 100,
    gold: 10_000,
  };
}

describe("migration適用済みSQLiteでのrepository integration", () => {
  test("2つのharnessを並列に作成して更新すると、DB状態を共有しない", async () => {
    // Arrange
    await using databaseA = await createMigratedTestDatabase();
    await using databaseB = await createMigratedTestDatabase();

    // Act
    await Promise.all([
      databaseA.actions.upsertUser("user-a"),
      databaseB.actions.upsertUser("user-b"),
    ]);
    const [usersA, usersB] = await Promise.all([
      databaseA.db.select().from(users),
      databaseB.db.select().from(users),
    ]);

    // Assert
    assertEquals(usersA.map((user) => user.discordId), ["user-a"]);
    assertEquals(usersB.map((user) => user.discordId), ["user-b"]);
  });

  test("同じcanonical Riot accountを再upsertすると、unique identityを増やさず表示情報を更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(riotAccount("user-1"));

    // Act
    await database.actions.upsertRiotAccount({
      ...riotAccount("user-1"),
      gameName: "RenamedTeemo",
      tagLine: "NEW",
    });
    const accounts = await database.db.select().from(riotAccounts);
    const [user] = await database.db.select().from(users);

    // Assert
    assertEquals(accounts.length, 1);
    assertEquals(accounts[0].discordId, "user-1");
    assertEquals(accounts[0].puuid, "puuid-user-1");
    assertEquals(accounts[0].gameName, "RenamedTeemo");
    assertEquals(accounts[0].tagLine, "NEW");
    assertEquals(user.riotId, "puuid-user-1");
    assert(user.updatedAt instanceof Date);
  });

  test("legacy Riot IDを既存ユーザーへ再リンクすると、値とupdatedAtを実DBで更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.linkUserWithRiotId("user-1", "puuid-before");

    // Act
    await database.actions.linkUserWithRiotId("user-1", "puuid-after");
    const saved = await database.db.query.users.findFirst({
      where: eq(users.discordId, "user-1"),
    });

    // Assert
    assertEquals(saved?.riotId, "puuid-after");
    assert(saved?.updatedAt instanceof Date);
  });

  test("同じcreatorとtargetを別guild・channelへ保存すると、取得とcascadeがguild境界を越えない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(riotAccount("target-1"));
    await database.actions.createCustomGameEvent({
      name: "Guild A event",
      guildId: "guild-a",
      creatorId: "target-1",
      discordScheduledEventId: "event-a",
      recruitmentMessageId: "message-a",
      scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
    });
    await database.actions.createCustomGameEvent({
      name: "Guild B event",
      guildId: "guild-b",
      creatorId: "target-1",
      discordScheduledEventId: "event-b",
      recruitmentMessageId: "message-b",
      scheduledStartAt: new Date("2026-08-02T10:00:00.000Z"),
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-a",
      targetDiscordId: "target-1",
      requesterId: "requester-a",
      channelId: "channel-a",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-b",
      targetDiscordId: "target-1",
      requesterId: "requester-b",
      channelId: "channel-b",
    });

    // Act
    const guildAWatchers = await database.actions
      .getEnabledMatchWatchersByGuild("guild-a");
    await database.db.delete(guilds).where(eq(guilds.id, "guild-a"));
    const remainingEvents = await database.db.select().from(customGameEvents);
    const remainingWatchers = await database.db.select().from(matchWatchers);

    // Assert
    assertEquals(guildAWatchers.map((watcher) => watcher.channelId), [
      "channel-a",
    ]);
    assertEquals(remainingEvents.map((event) => event.guildId), ["guild-b"]);
    assertEquals(
      remainingWatchers.map((watcher) => ({
        guildId: watcher.guildId,
        channelId: watcher.channelId,
      })),
      [{ guildId: "guild-b", channelId: "channel-b" }],
    );
  });

  test("親recordがないeventを直接保存すると、foreign key違反になり次のrepository操作は成功する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();

    // Act & Assert
    await assertRejects(() =>
      database.db.insert(customGameEvents).values({
        name: "orphan event",
        guildId: "missing-guild",
        creatorId: "missing-user",
        discordScheduledEventId: "orphan-event",
        recruitmentMessageId: "orphan-message",
        scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
      }).execute()
    );
    await database.actions.upsertUser("user-after-fk-error");
    const saved = await database.db.query.users.findFirst({
      where: eq(users.discordId, "user-after-fk-error"),
    });
    assertEquals(saved?.discordId, "user-after-fk-error");
  });

  test("pending rank snapshotを保存すると、TTLをDB状態へ反映し次回操作で期限切れだけを削除する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase({
      pendingRankSnapshotTtlMs: 1_000,
    });
    const expiredFetchedAt = new Date("2026-01-01T00:00:00.000Z");
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "expired-game",
      puuid: "expired-puuid",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 2,
        wins: 10,
        losses: 8,
        fetchedAt: expiredFetchedAt,
      }],
    });
    const expired = await database.db.query.pendingMatchRankSnapshots
      .findFirst();

    // Act
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "active-game",
      puuid: "active-puuid",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "IV",
        leaguePoints: 10,
        wins: 20,
        losses: 10,
        fetchedAt: new Date("2099-01-01T00:00:00.000Z"),
      }],
    });
    const remaining = await database.db.select().from(
      pendingMatchRankSnapshots,
    );

    // Assert
    assertEquals(
      expired?.expiresAt,
      new Date("2026-01-01T00:00:01.000Z"),
    );
    assertEquals(remaining.map((snapshot) => snapshot.gameId), [
      "active-game",
    ]);
  });

  test("pending snapshotを試合へ確定して再実行すると、保存済みbeforeを再利用しafterだけを更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 2,
        wins: 10,
        losses: 8,
        fetchedAt: new Date("2099-01-01T00:00:00.000Z"),
      }],
    });
    const input = {
      matchId: "JP1_12345",
      platform: "jp1" as const,
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5" as const,
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
        fetchedAt: new Date("2099-01-01T00:10:00.000Z"),
      }],
    };
    const first = await database.actions.finalizeMatchRankSnapshots(input);

    // Act
    const second = await database.actions.finalizeMatchRankSnapshots({
      ...input,
      snapshots: [{ ...input.snapshots[0], leaguePoints: 21 }],
    });
    const saved = await database.db.select().from(matchRankSnapshots);

    // Assert
    assertEquals(first.before.length, 1);
    assertEquals(second.before, first.before);
    assertEquals(second.after[0].leaguePoints, 21);
    assertEquals(saved.length, 2);
  });

  test("監視上限を超えてwatcherを追加すると、errorを返してtransaction内の途中recordも残さない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase({
      matchWatcherMaxEnabledPerGuild: 1,
    });
    await database.actions.upsertRiotAccount(riotAccount("target-1"));
    await database.actions.upsertRiotAccount(riotAccount("target-2"));
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      requesterId: "requester-1",
      channelId: "channel-1",
    });

    // Act & Assert
    await assertRejects(
      () =>
        database.actions.upsertMatchWatcher({
          guildId: "guild-1",
          targetDiscordId: "target-2",
          requesterId: "requester-rolled-back",
          channelId: "channel-2",
        }),
      MatchWatcherLimitError,
    );
    const watchers = await database.actions.getEnabledMatchWatchersByGuild(
      "guild-1",
    );
    const rolledBackRequester = await database.db.query.users.findFirst({
      where: eq(users.discordId, "requester-rolled-back"),
    });
    assertEquals(watchers.map((watcher) => watcher.targetDiscordId), [
      "target-1",
    ]);
    assertEquals(rolledBackRequester, undefined);
  });

  test("matchと全participantを保存して同じmatchを再送すると、1回分だけcommitする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    await database.actions.upsertUser("user-2");
    const input = {
      matchId: "match-1",
      participants: [
        participant("user-1", "Top"),
        participant("user-2", "Jungle"),
      ],
    };

    // Act
    const first = await database.actions.createMatchWithParticipants(input);
    const second = await database.actions.createMatchWithParticipants(input);
    const savedMatches = await database.db.select().from(matches);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(second.created, false);
    assertEquals(savedMatches.map((match) => match.id), ["match-1"]);
    assertEquals(
      savedParticipants.map((savedParticipant) => savedParticipant.userId)
        .toSorted(),
      ["user-1", "user-2"],
    );
  });

  test("別処理でmatch行だけが作成済みでも、全participantを保存して再送時は重複しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    await database.actions.upsertUser("user-2");
    await database.actions.upsertExternalMatchDetail({
      matchId: "match-existing",
      provider: "opgg",
      providerRegion: "jp",
      providerMatchId: "existing",
      detailUrl: "https://example.com/matches/existing",
      providerCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
      averageTier: null,
    });
    const input = {
      matchId: "match-existing",
      participants: [
        participant("user-1", "Top"),
        participant("user-2", "Jungle"),
      ],
    };

    // Act
    const first = await database.actions.createMatchWithParticipants(input);
    const second = await database.actions.createMatchWithParticipants(input);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(first.participants.length, 2);
    assertEquals(second.created, false);
    assertEquals(savedParticipants.length, 2);
  });

  test("participant一括保存でforeign key違反になると、matchを含めてrollbackし次のtransactionを実行できる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    const input = {
      matchId: "match-rollback",
      participants: [
        participant("user-1", "Top"),
        participant("missing-user", "Jungle"),
      ],
    };

    // Act & Assert
    await assertRejects(() =>
      database.actions.createMatchWithParticipants(input)
    );
    assertEquals(
      await database.db.select().from(matches).where(
        eq(matches.id, input.matchId),
      ),
      [],
    );
    assertEquals(
      await database.db.select().from(matchParticipants),
      [],
    );

    await database.actions.upsertUser("missing-user");
    const retried = await database.actions.createMatchWithParticipants(input);
    assertEquals(retried.created, true);
    assertEquals(retried.participants.length, 2);
  });

  test("単体participant保存時、not foundは専用errorにしDB failureとは区別する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.db.insert(matches).values({ id: "match-1" });

    // Act & Assert
    await assertRejects(
      () =>
        database.actions.createMatchParticipant({
          matchId: "match-1",
          ...participant("missing-user"),
        }),
      RecordNotFoundError,
    );

    await database.actions.upsertUser("user-1");
    await database.client.execute("DROP TABLE match_participants");
    const databaseError = await assertRejects(() =>
      database.actions.createMatchParticipant({
        matchId: "match-1",
        ...participant("user-1"),
      })
    );
    assertFalse(databaseError instanceof RecordNotFoundError);
  });
});
