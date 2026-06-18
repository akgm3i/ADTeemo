import { assertEquals } from "@std/assert";
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

  test("Match-v5が試合詳細を返すとき、participantのchampionIdをparseする", async () => {
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
                }],
              },
            }),
            { status: 200 },
          ),
        ),
    );

    const match = await riotApi.getMatchById("asia", "JP1_12345");

    assertEquals(match?.info.participants[0].championId, 17);
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
