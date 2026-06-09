import { z } from "zod";
import type { RiotPlatform, RiotRegion } from "./db/schema.ts";
import { apiLogger } from "./logger.ts";

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
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type RateBucket = {
  key: string;
  limit: number;
  windowMs: number;
  count: number;
  resetAt: number;
  cooldownUntil: number;
};

const DEFAULT_SHORT_LIMIT = 500;
const DEFAULT_SHORT_WINDOW_MS = 10_000;
const DEFAULT_LONG_LIMIT = 30_000;
const DEFAULT_LONG_WINDOW_MS = 600_000;

const appBuckets = new Map<string, RateBucket>();
const methodBuckets = new Map<string, RateBucket>();
let riotQueue = Promise.resolve();

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nowMs() {
  return Date.now();
}

function defaultAppBuckets(now = nowMs()) {
  return [
    {
      key: "app:short",
      limit: numberEnv(
        "RIOT_RATE_LIMIT_SHORT_WINDOW_LIMIT",
        DEFAULT_SHORT_LIMIT,
      ),
      windowMs: numberEnv(
        "RIOT_RATE_LIMIT_SHORT_WINDOW_MS",
        DEFAULT_SHORT_WINDOW_MS,
      ),
      count: 0,
      resetAt: now + numberEnv(
        "RIOT_RATE_LIMIT_SHORT_WINDOW_MS",
        DEFAULT_SHORT_WINDOW_MS,
      ),
      cooldownUntil: 0,
    },
    {
      key: "app:long",
      limit: numberEnv("RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT", DEFAULT_LONG_LIMIT),
      windowMs: numberEnv(
        "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
        DEFAULT_LONG_WINDOW_MS,
      ),
      count: 0,
      resetAt: now + numberEnv(
        "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
        DEFAULT_LONG_WINDOW_MS,
      ),
      cooldownUntil: 0,
    },
  ];
}

function ensureAppBuckets(now = nowMs()) {
  if (appBuckets.size === 0) {
    for (const bucket of defaultAppBuckets(now)) {
      appBuckets.set(bucket.key, bucket);
    }
  }
  return [...appBuckets.values()];
}

function normalizeMethodKey(url: URL) {
  let path = url.pathname;
  path = path.replace(
    /\/lol\/spectator\/v5\/active-games\/by-summoner\/[^/]+$/,
    "/lol/spectator/v5/active-games/by-summoner/:puuid",
  );
  path = path.replace(
    /\/lol\/match\/v5\/matches\/[^/]+$/,
    "/lol/match/v5/matches/:matchId",
  );
  path = path.replace(
    /\/riot\/account\/v1\/accounts\/by-riot-id\/[^/]+\/[^/]+$/,
    "/riot/account/v1/accounts/by-riot-id/:gameName/:tagLine",
  );
  return `${url.hostname}${path}`;
}

function parseRateLimitHeader(value: string | null) {
  if (!value) return [];
  return value.split(",").flatMap((part) => {
    const [limit, seconds] = part.trim().split(":").map(Number);
    if (!Number.isFinite(limit) || !Number.isFinite(seconds)) return [];
    return [{ limit, windowMs: seconds * 1000 }];
  });
}

function parseRateCountHeader(value: string | null) {
  if (!value) return [];
  return value.split(",").flatMap((part) => {
    const [count, seconds] = part.trim().split(":").map(Number);
    if (!Number.isFinite(count) || !Number.isFinite(seconds)) return [];
    return [{ count, windowMs: seconds * 1000 }];
  });
}

function resetExpiredBucket(bucket: RateBucket, now = nowMs()) {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + bucket.windowMs;
  }
}

function waitMsForBucket(bucket: RateBucket, now = nowMs()) {
  resetExpiredBucket(bucket, now);
  return Math.max(
    bucket.cooldownUntil - now,
    bucket.count >= bucket.limit ? bucket.resetAt - now : 0,
    0,
  );
}

async function waitForRiotRateLimit(methodKey: string) {
  while (true) {
    const now = nowMs();
    const buckets = [
      ...ensureAppBuckets(now),
      ...[...methodBuckets.values()].filter((bucket) =>
        bucket.key.startsWith(`method:${methodKey}:`)
      ),
    ];
    const waitMs = Math.max(
      ...buckets.map((bucket) => waitMsForBucket(bucket, now)),
      0,
    );
    if (waitMs <= 0) return;
    await sleep(waitMs);
  }
}

function incrementBuckets(methodKey: string) {
  const now = nowMs();
  for (const bucket of ensureAppBuckets(now)) {
    resetExpiredBucket(bucket, now);
    bucket.count += 1;
  }
  for (const bucket of methodBuckets.values()) {
    if (!bucket.key.startsWith(`method:${methodKey}:`)) continue;
    resetExpiredBucket(bucket, now);
    bucket.count += 1;
  }
}

function upsertHeaderBuckets(
  target: Map<string, RateBucket>,
  prefix: string,
  limits: { limit: number; windowMs: number }[],
  counts: { count: number; windowMs: number }[],
) {
  const now = nowMs();
  for (const limit of limits) {
    const key = `${prefix}:${limit.windowMs}`;
    const count = counts.find((item) => item.windowMs === limit.windowMs)
      ?.count ?? 0;
    const existing = target.get(key);
    target.set(key, {
      key,
      limit: limit.limit,
      windowMs: limit.windowMs,
      count,
      resetAt: existing?.resetAt && existing.resetAt > now
        ? existing.resetAt
        : now + limit.windowMs,
      cooldownUntil: existing?.cooldownUntil ?? 0,
    });
  }
}

function applyRiotRateHeaders(res: Response, methodKey: string) {
  const appLimits = parseRateLimitHeader(res.headers.get("X-App-Rate-Limit"));
  const appCounts = parseRateCountHeader(
    res.headers.get("X-App-Rate-Limit-Count"),
  );
  const methodLimits = parseRateLimitHeader(
    res.headers.get("X-Method-Rate-Limit"),
  );
  const methodCounts = parseRateCountHeader(
    res.headers.get("X-Method-Rate-Limit-Count"),
  );

  if (appLimits.length > 0) {
    upsertHeaderBuckets(appBuckets, "app", appLimits, appCounts);
  }
  if (methodLimits.length > 0) {
    upsertHeaderBuckets(
      methodBuckets,
      `method:${methodKey}`,
      methodLimits,
      methodCounts,
    );
  }
}

function applyRetryAfterCooldown(
  res: Response,
  methodKey: string,
  fallbackMs: number,
) {
  const cooldownUntil = nowMs() + retryAfterMs(res, fallbackMs);
  const rateLimitType = res.headers.get("X-Rate-Limit-Type");
  let buckets = rateLimitType === "method"
    ? [...methodBuckets.values()].filter((bucket) =>
      bucket.key.startsWith(`method:${methodKey}:`)
    )
    : ensureAppBuckets();
  if (rateLimitType === "method" && buckets.length === 0) {
    const key = `method:${methodKey}:retry-after`;
    const bucket = {
      key,
      limit: 1,
      windowMs: retryAfterMs(res, fallbackMs),
      count: 1,
      resetAt: cooldownUntil,
      cooldownUntil,
    };
    methodBuckets.set(key, bucket);
    buckets = [bucket];
  }
  for (const bucket of buckets) {
    bucket.cooldownUntil = Math.max(bucket.cooldownUntil, cooldownUntil);
  }
  apiLogger.warn("riot_api.rate_limited", {
    rateLimitType: rateLimitType ?? "application",
    methodKey,
    retryAfterMs: Math.max(cooldownUntil - nowMs(), 0),
  });
}

async function scheduleRiotRequest<T>(task: () => Promise<T>) {
  const run = riotQueue.then(task, task);
  riotQueue = run.then(() => undefined, () => undefined);
  return await run;
}

async function fetchRiotJson(
  url: URL,
  options: { retries?: number; notFoundAsNull?: boolean } = {},
) {
  return await scheduleRiotRequest(async () => {
    const retries = options.retries ?? 2;
    const methodKey = normalizeMethodKey(url);
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitForRiotRateLimit(methodKey);
      incrementBuckets(methodKey);

      const res = await fetch(url, {
        headers: {
          "X-Riot-Token": riotApiKey(),
        },
      });
      applyRiotRateHeaders(res, methodKey);

      if (res.status === 404 && options.notFoundAsNull) {
        await res.body?.cancel();
        return null;
      }

      if (res.ok) {
        return await res.json();
      }

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel();
        if (res.status === 429) {
          applyRetryAfterCooldown(res, methodKey, 500 * (attempt + 1));
        }
        await sleep(retryAfterMs(res, 500 * (attempt + 1)));
        continue;
      }

      await res.body?.cancel();
      throw new Error(`Failed to fetch Riot API: ${res.status}`);
    }

    throw new Error("Failed to fetch Riot API");
  });
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
  __testing: {
    resetRateLimiter() {
      appBuckets.clear();
      methodBuckets.clear();
      riotQueue = Promise.resolve();
    },
    rateLimiterSnapshot() {
      return {
        appBuckets: [...appBuckets.values()].map((bucket) => ({ ...bucket })),
        methodBuckets: [...methodBuckets.values()].map((bucket) => ({
          ...bucket,
        })),
      };
    },
  },
};
