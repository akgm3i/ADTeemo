import { assert, assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import { match } from "../../bot/src/features/testing/match_tracking_fixtures.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";

for (const platform of ["ph2", "th2"] as const) {
  test(`${platform}の旧結果をSG2移行済みaccountで検査すると、元match IDとpending rankを使って保存する`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "target-1",
      puuid: "puuid-1",
      gameName: "Teemo",
      tagLine: "SEA",
      platform: "sg2",
      region: "sea",
    });
    const matchId = `${platform.toUpperCase()}_12345`;
    await database.actions.upsertPendingRankSnapshots({
      platform,
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "GOLD",
        rank: "I",
        leaguePoints: 42,
        wins: 10,
        losses: 8,
      }],
    });
    const resultMatch = match();
    resultMatch.metadata.matchId = matchId;
    const requested: unknown[] = [];
    const deps = createTestDependencies({
      dbActions: database.actions,
      riotApi: {
        getActiveGameByPuuid: (route, puuid) => {
          requested.push(["active", route, puuid]);
          return Promise.resolve(null);
        },
        getMatchById: (region, id) => {
          requested.push(["match", region, id]);
          return Promise.resolve(resultMatch);
        },
        getLeagueEntriesByPuuid: (route, puuid) => {
          requested.push(["league", route, puuid]);
          return Promise.resolve([{
            queueType: "RANKED_SOLO_5x5",
            tier: "GOLD",
            rank: "I",
            leaguePoints: 66,
            wins: 11,
            losses: 8,
          }]);
        },
      },
      opggMatchDetailService: { resolveAndSave: () => Promise.resolve(null) },
    });
    const client = createInProcessBotApiClient(createApp(deps));

    // Act
    const active = await client.inspectMatchWatcherActiveGame(
      "guild-1",
      "target-1",
      {
        riotAccountPuuid: "puuid-1",
      },
    );
    const result = await client.inspectMatchWatcherResult(
      "guild-1",
      "target-1",
      {
        riotAccountPuuid: "puuid-1",
        matchId,
      },
    );

    // Assert
    assert(active.success);
    assertEquals(active.activeGame, null);
    assert(result.success);
    assertEquals(result.match?.metadata.matchId, matchId);
    assertEquals(result.rankSummary?.before?.leaguePoints, 42);
    assertEquals(result.rankSummary?.before?.platform, platform);
    assertEquals(result.rankSummary?.after?.leaguePoints, 66);
    assertEquals(requested, [["active", "sg2", "puuid-1"], [
      "match",
      "sea",
      matchId,
    ], ["league", "sg2", "puuid-1"]]);
    assertEquals(
      (await database.db.query.matches.findMany()).map((entry) => entry.id),
      [matchId],
    );
    assertEquals(
      await database.db.query.pendingMatchRankSnapshots.findMany(),
      [],
    );
  });
}
