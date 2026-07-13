import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";

describe("routes/riot.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { riotApi } = deps;

  test("platformとPUUIDを指定したとき、APIサーバーから進行中の試合を返す", async () => {
    // Arrange
    const activeGame = {
      gameId: 12345,
      gameType: "MATCHED_GAME",
      gameStartTime: 1_700_000_000_000,
      mapId: 11,
      gameMode: "CLASSIC",
      gameQueueConfigId: 420,
      participants: [{
        puuid: "puuid-1",
        championId: 17,
        teamId: 100,
      }],
    };
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGame),
    );

    // Act
    const res = await app.request(
      "/riot/active-games/jp1/puuid-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { activeGame });
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-1"] });
  });

  test("進行中の試合がないとき、APIサーバーからnullを返す", async () => {
    // Arrange
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(null),
    );

    // Act
    const res = await app.request(
      "/riot/active-games/jp1/puuid-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { activeGame: null });
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-1"] });
  });

  test("regionとMatch IDを指定したとき、APIサーバーから試合結果を返す", async () => {
    // Arrange
    const match = {
      metadata: {
        matchId: "JP1_12345",
        participants: ["puuid-1"],
      },
      info: {
        gameId: 12345,
        gameCreation: 1_700_000_000_000,
        gameDuration: 1800,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        mapId: 11,
        queueId: 420,
        participants: [{
          puuid: "puuid-1",
          championName: "Teemo",
          teamId: 100,
          win: true,
          kills: 10,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          goldEarned: 12_345,
        }],
      },
    };
    using matchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(match),
    );

    // Act
    const res = await app.request(
      "/riot/matches/asia/JP1_12345",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { match });
    assertSpyCall(matchStub, 0, { args: ["asia", "JP1_12345"] });
  });

  test("platformとPUUIDを指定したとき、APIサーバーからランク情報を返す", async () => {
    // Arrange
    const entries = [{
      queueType: "RANKED_SOLO_5x5",
      tier: "EMERALD",
      rank: "IV",
      leaguePoints: 19,
      wins: 11,
      losses: 8,
    }];
    using entriesStub = stub(
      riotApi,
      "getLeagueEntriesByPuuid",
      () => Promise.resolve(entries),
    );

    // Act
    const res = await app.request(
      "/riot/league-entries/jp1/puuid-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { entries });
    assertSpyCall(entriesStub, 0, { args: ["jp1", "puuid-1"] });
  });

  test("未対応platformを指定したとき、Riot APIを呼ばず400を返す", async () => {
    // Arrange
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(null),
    );

    // Act
    const res = await app.request(
      "/riot/active-games/invalid/puuid-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 400);
    assertEquals(activeGameStub.calls.length, 0);
  });

  test("Riot APIが403を返すとき、502と認証確認用エラーを返す", async () => {
    // Arrange
    const errorMessage = "Riot API request failed: 403 " +
      "(jp1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/:puuid); " +
      "authorization rejected; verify RIOT_API_KEY and endpoint access";
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.reject(new Error(errorMessage)),
    );

    // Act
    const res = await app.request(
      "/riot/active-games/jp1/puuid-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(res.status, 502);
    assertEquals(await res.json(), { error: errorMessage });
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-1"] });
  });
});
