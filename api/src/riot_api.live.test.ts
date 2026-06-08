import { assert, assertEquals, assertMatch } from "@std/assert";
import { riotApi } from "./riot_api.ts";
import type { RiotPlatform, RiotRegion } from "./db/schema.ts";

const liveEnabled = Deno.env.get("RIOT_LIVE_TEST") === "1";

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  assert(value && !value.endsWith("_HERE"), `${name} must be set`);
  return value;
}

function riotIdParts() {
  const riotId = requireEnv("RIOT_LIVE_TEST_RIOT_ID");
  const [gameName, tagLine, ...rest] = riotId.split("#");
  assert(
    gameName && tagLine && rest.length === 0,
    "RIOT_LIVE_TEST_RIOT_ID must be formatted as GameName#TagLine",
  );
  return { gameName, tagLine };
}

Deno.test({
  name:
    "実際のRiot Account-v1でRiot IDを取得すると、PUUIDと正規化されたRiot IDが返る",
  ignore: !liveEnabled,
  async fn() {
    const { gameName, tagLine } = riotIdParts();
    const account = await riotApi.getAccountByRiotId(gameName, tagLine);

    assert(account, "Riot account must exist");
    assert(account.puuid.length > 0);
    assertEquals(account.tagLine.toLowerCase(), tagLine.toLowerCase());
  },
});

Deno.test({
  name:
    "実際のRiot Spectator-v5で指定PUUIDのactive game確認を行うと、試合中または未試合として処理できる",
  ignore: !liveEnabled,
  async fn() {
    const { gameName, tagLine } = riotIdParts();
    const account = await riotApi.getAccountByRiotId(gameName, tagLine);
    assert(account, "Riot account must exist");

    const platform =
      (Deno.env.get("RIOT_LIVE_TEST_PLATFORM") ?? "jp1") as RiotPlatform;
    const activeGame = await riotApi.getActiveGameByPuuid(
      platform,
      account.puuid,
    );

    if (!activeGame) {
      assertEquals(activeGame, null);
      return;
    }

    assert(activeGame.gameId > 0);
    assert(activeGame.participants.length > 0);
  },
});

Deno.test({
  name:
    "実際のRiot Match-v5で指定Match IDを取得すると、Match IDと参加者情報が返る",
  ignore: !liveEnabled || !Deno.env.get("RIOT_LIVE_TEST_MATCH_ID"),
  async fn() {
    const region =
      (Deno.env.get("RIOT_LIVE_TEST_REGION") ?? "asia") as RiotRegion;
    const matchId = requireEnv("RIOT_LIVE_TEST_MATCH_ID");

    const match = await riotApi.getMatchById(region, matchId);

    assert(match, "Riot match must exist");
    assertEquals(match.metadata.matchId, matchId);
    assertMatch(match.metadata.matchId, /^[A-Z0-9]+_\d+$/);
    assert(match.info.participants.length > 0);
  },
});
