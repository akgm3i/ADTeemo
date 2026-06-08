import { z } from "zod";
import type { RiotPlatform, RiotRegion } from "./db/schema.ts";

const riotAccountSchema = z.object({
  puuid: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
});

const activeGameSchema = z.object({
  gameId: z.number(),
  gameType: z.string(),
  gameStartTime: z.number(),
  mapId: z.number(),
  gameLength: z.number().optional(),
  gameMode: z.string(),
  gameQueueConfigId: z.number().optional(),
  participants: z.array(
    z.object({
      puuid: z.string().optional(),
      summonerName: z.string().optional(),
      riotId: z.string().optional(),
      championId: z.number(),
      teamId: z.number(),
    }).passthrough(),
  ),
}).passthrough();

const matchSchema = z.object({
  metadata: z.object({
    matchId: z.string(),
    participants: z.array(z.string()),
  }).passthrough(),
  info: z.object({
    gameId: z.number(),
    gameCreation: z.number(),
    gameDuration: z.number(),
    gameEndTimestamp: z.number().optional(),
    gameMode: z.string(),
    gameType: z.string(),
    mapId: z.number(),
    queueId: z.number(),
    participants: z.array(
      z.object({
        puuid: z.string(),
        riotIdGameName: z.string().optional(),
        riotIdTagline: z.string().optional(),
        summonerName: z.string().optional(),
        championName: z.string(),
        teamId: z.number(),
        win: z.boolean(),
        kills: z.number(),
        deaths: z.number(),
        assists: z.number(),
        totalMinionsKilled: z.number(),
        neutralMinionsKilled: z.number(),
        goldEarned: z.number(),
      }).passthrough(),
    ),
  }).passthrough(),
}).passthrough();

function riotApiKey() {
  const apiKey = Deno.env.get("RIOT_API_KEY");
  if (!apiKey) {
    throw new Error("RIOT_API_KEY is not set");
  }
  return apiKey;
}

function retryAfterMs(res: Response, fallbackMs: number) {
  const retryAfter = res.headers.get("Retry-After");
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) ? seconds * 1000 : fallbackMs;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRiotJson(
  url: URL,
  options: { retries?: number; notFoundAsNull?: boolean } = {},
) {
  const retries = options.retries ?? 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Riot-Token": riotApiKey(),
      },
    });

    if (res.status === 404 && options.notFoundAsNull) {
      await res.body?.cancel();
      return null;
    }

    if (res.ok) {
      return await res.json();
    }

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await res.body?.cancel();
      await sleep(retryAfterMs(res, 500 * (attempt + 1)));
      continue;
    }

    await res.body?.cancel();
    throw new Error(`Failed to fetch Riot API: ${res.status}`);
  }

  throw new Error("Failed to fetch Riot API");
}

async function getAccountByRiotId(gameName: string, tagLine: string) {
  const url = new URL(
    `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${
      encodeURIComponent(gameName)
    }/${encodeURIComponent(tagLine)}`,
  );

  const data = await fetchRiotJson(url, { notFoundAsNull: true });
  if (!data) return null;
  return riotAccountSchema.parse(data);
}

async function getActiveGameByPuuid(platform: RiotPlatform, puuid: string) {
  const url = new URL(
    `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${
      encodeURIComponent(puuid)
    }`,
  );
  const data = await fetchRiotJson(url, { notFoundAsNull: true });
  if (!data) return null;
  return activeGameSchema.parse(data);
}

async function getMatchById(region: RiotRegion, matchId: string) {
  const url = new URL(
    `https://${region}.api.riotgames.com/lol/match/v5/matches/${
      encodeURIComponent(matchId)
    }`,
  );
  const data = await fetchRiotJson(url, { notFoundAsNull: true, retries: 4 });
  if (!data) return null;
  return matchSchema.parse(data);
}

export const riotApi = {
  getAccountByRiotId,
  getActiveGameByPuuid,
  getMatchById,
};
