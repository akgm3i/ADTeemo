import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { riotApi } from "./riot_api.ts";

describe("riot_api.ts", () => {
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

    const account = await riotApi.getAccountByRiotId("Teemo", "JP1");

    assertEquals(account?.puuid, "puuid-1");
    assertSpyCalls(fetchStub, 2);
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

    const account = await riotApi.getAccountByRiotId("Teemo", "JP1");

    assertEquals(account?.gameName, "Teemo");
    assertSpyCalls(fetchStub, 2);
  });
});
