import { assertEquals, assertFalse, assertRejects } from "@std/assert";
import { beforeEach, describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { riotApi } from "./riot_api.ts";

describe("riot_api.ts", () => {
  beforeEach(() => {
    riotApi.__testing.resetRateLimiter();
  });

  test("Spectator-v5がactive gameを返すとき、試合概要をparseする", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
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
            }),
            { status: 200 },
          ),
        ),
    );

    const activeGame = await riotApi.getActiveGameByPuuid("jp1", "puuid-1");

    assertEquals(activeGame?.gameId, 12345);
    assertEquals(activeGame?.gameQueueConfigId, 420);
    assertSpyCalls(fetchStub, 1);
  });

  test("Spectator-v5が404を返すとき、nullを返す", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response(null, { status: 404 })),
    );

    const activeGame = await riotApi.getActiveGameByPuuid("jp1", "puuid-1");

    assertEquals(activeGame, null);
    assertSpyCalls(fetchStub, 1);
  });

  test("Match-v5が404を返すとき、未反映としてnullを返す", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response(null, { status: 404 })),
    );

    const match = await riotApi.getMatchById("asia", "JP1_12345");

    assertEquals(match, null);
    assertSpyCalls(fetchStub, 1);
  });

  test("Match-v5が試合詳細を返すとき、participantの表示用metricとpositionをparseする", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                matchId: "JP1_12345",
                participants: ["puuid-1"],
              },
              info: {
                gameId: 12345,
                gameCreation: 1_700_000_000_000,
                gameDuration: 1800,
                gameEndTimestamp: 1_700_001_800_000,
                gameMode: "CLASSIC",
                gameType: "MATCHED_GAME",
                mapId: 11,
                queueId: 420,
                participants: [{
                  puuid: "puuid-1",
                  championId: 17,
                  championName: "Teemo",
                  teamId: 100,
                  win: true,
                  kills: 10,
                  deaths: 2,
                  assists: 8,
                  totalMinionsKilled: 180,
                  neutralMinionsKilled: 12,
                  goldEarned: 12345,
                  totalDamageDealtToChampions: 23456,
                  visionScore: 20,
                  totalEnemyJungleMinionsKilled: 7,
                  teamPosition: "TOP",
                  individualPosition: "TOP",
                }],
              },
            }),
            { status: 200 },
          ),
        ),
    );

    const match = await riotApi.getMatchById("asia", "JP1_12345");

    assertEquals(match?.info.participants[0].championId, 17);
    assertEquals(
      match?.info.participants[0].totalDamageDealtToChampions,
      23456,
    );
    assertEquals(match?.info.participants[0].visionScore, 20);
    assertEquals(
      match?.info.participants[0].totalEnemyJungleMinionsKilled,
      7,
    );
    assertEquals(match?.info.participants[0].teamPosition, "TOP");
    assertEquals(match?.info.participants[0].individualPosition, "TOP");
    assertSpyCalls(fetchStub, 1);
  });

  test("League-v4がランクentryを返すとき、queueとLPをparseする", async () => {
    // Arrange
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      (input) => {
        const url = new URL(String(input));
        assertEquals(
          url.pathname,
          "/lol/league/v4/entries/by-puuid/puuid-1",
        );
        return Promise.resolve(
          new Response(
            JSON.stringify([{
              queueType: "RANKED_SOLO_5x5",
              tier: "EMERALD",
              rank: "IV",
              leaguePoints: 19,
              wins: 11,
              losses: 8,
            }]),
            { status: 200 },
          ),
        );
      },
    );

    // Act
    const entries = await riotApi.getLeagueEntriesByPuuid("jp1", "puuid-1");

    // Assert
    assertEquals(entries[0].queueType, "RANKED_SOLO_5x5");
    assertEquals(entries[0].leaguePoints, 19);
    assertSpyCalls(fetchStub, 1);
  });

  test("Riot APIが429を返したあと成功するとき、再試行して結果を返す", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    let calls = 0;
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            new Response(null, {
              status: 429,
              headers: { "Retry-After": "0" },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "JP1",
            }),
            { status: 200 },
          ),
        );
      },
    );

    const account = await riotApi.getAccountByRiotId("asia", "Teemo", "JP1");

    assertEquals(account?.puuid, "puuid-1");
    assertSpyCalls(fetchStub, 2);
  });

  test("rate limit設定がないとき、Personal API Keyの上限を既定値として使う", async () => {
    // Arrange
    const envNames = [
      "RIOT_RATE_LIMIT_SHORT_WINDOW_LIMIT",
      "RIOT_RATE_LIMIT_SHORT_WINDOW_MS",
      "RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT",
      "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
    ] as const;
    const previousValues = new Map(
      envNames.map((name) => [name, Deno.env.get(name)]),
    );
    for (const name of envNames) Deno.env.delete(name);
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "JP1",
            }),
            { status: 200 },
          ),
        ),
    );

    try {
      // Act
      await riotApi.getAccountByRiotId("asia", "Teemo", "JP1");
      const snapshot = riotApi.__testing.rateLimiterSnapshot();

      // Assert
      assertEquals(
        snapshot.appBuckets.map(({ limit, windowMs }) => ({
          limit,
          windowMs,
        })),
        [
          { limit: 20, windowMs: 1_000 },
          { limit: 100, windowMs: 120_000 },
        ],
      );
      assertSpyCalls(fetchStub, 1);
    } finally {
      for (const [name, value] of previousValues) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  });

  test("Riot APIが403を返すとき、認証設定と対象endpointを確認できるエラーを返す", async () => {
    // Arrange
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response(null, { status: 403 })),
    );

    // Act
    const error = await assertRejects(
      () => riotApi.getActiveGameByPuuid("jp1", "secret-puuid"),
      Error,
      "Riot API request failed: 403",
    );

    // Assert
    assertEquals(
      error.message,
      "Riot API request failed: 403 " +
        "(jp1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/:puuid); " +
        "authorization rejected; verify RIOT_API_KEY and endpoint access",
    );
    assertFalse(error.message.includes("secret-puuid"));
    assertSpyCalls(fetchStub, 1);
  });

  test("Account-v1を呼び出すとき、指定したRegional RoutingをURLに使う", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "EUW",
            }),
            { status: 200 },
          ),
        ),
    );

    await riotApi.getAccountByRiotId("europe", "Teemo", "EUW");
    const url = fetchStub.calls[0].args[0] as URL;

    assertEquals(url.hostname, "europe.api.riotgames.com");
    assertEquals(
      url.pathname,
      "/riot/account/v1/accounts/by-riot-id/Teemo/EUW",
    );
  });

  test("Riot APIが429を返すとき、Retry-Afterをrate limit bucketへ反映する", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    let calls = 0;
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            new Response(null, {
              status: 429,
              headers: {
                "Retry-After": "0.001",
                "X-Rate-Limit-Type": "method",
              },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "JP1",
            }),
            { status: 200 },
          ),
        );
      },
    );

    const account = await riotApi.getAccountByRiotId("asia", "Teemo", "JP1");
    const snapshot = riotApi.__testing.rateLimiterSnapshot();

    assertEquals(account?.puuid, "puuid-1");
    assertEquals(snapshot.methodBuckets.length, 1);
    assertSpyCalls(fetchStub, 2);
  });

  test("Riot APIのrate limit headersを次回以降の待機判定用bucketへ記録する", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "JP1",
            }),
            {
              status: 200,
              headers: {
                "X-App-Rate-Limit": "500:10,30000:600",
                "X-App-Rate-Limit-Count": "1:10,1:600",
                "X-Method-Rate-Limit": "100:120",
                "X-Method-Rate-Limit-Count": "1:120",
              },
            },
          ),
        ),
    );

    await riotApi.getAccountByRiotId("asia", "Teemo", "JP1");
    const snapshot = riotApi.__testing.rateLimiterSnapshot();

    assertEquals(
      snapshot.appBuckets.some((bucket) => bucket.limit === 500),
      true,
    );
    assertEquals(
      snapshot.methodBuckets.some((bucket) => bucket.limit === 100),
      true,
    );
    assertSpyCalls(fetchStub, 1);
  });

  test("Riot APIが5xxを返したあと成功するとき、再試行して結果を返す", async () => {
    Deno.env.set("RIOT_API_KEY", "test-key");
    let calls = 0;
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(new Response(null, { status: 502 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              puuid: "puuid-1",
              gameName: "Teemo",
              tagLine: "JP1",
            }),
            { status: 200 },
          ),
        );
      },
    );

    const account = await riotApi.getAccountByRiotId("asia", "Teemo", "JP1");

    assertEquals(account?.gameName, "Teemo");
    assertSpyCalls(fetchStub, 2);
  });
});
