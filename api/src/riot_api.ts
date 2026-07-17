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
    }),
  ),
});

const matchSchema = z.object({
  metadata: z.object({
    matchId: z.string(),
    participants: z.array(z.string()),
  }),
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
        championId: z.number().optional(),
        championName: z.string(),
        teamId: z.number(),
        win: z.boolean(),
        kills: z.number(),
        deaths: z.number(),
        assists: z.number(),
        totalMinionsKilled: z.number(),
        neutralMinionsKilled: z.number(),
        goldEarned: z.number(),
        totalDamageDealtToChampions: z.number().optional(),
        visionScore: z.number().optional(),
        totalEnemyJungleMinionsKilled: z.number().optional(),
        teamPosition: z.string().optional(),
        individualPosition: z.string().optional(),
      }),
    ),
  }),
});

const leagueEntrySchema = z.object({
  queueType: z.string(),
  tier: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});

type RateBucket = {
  key: string;
  kind: "quota" | "cooldown";
  scope: "application" | "method";
  hostname: string;
  method?: string;
  limit: number;
  windowMs: number;
  count: number;
  resetAt: number;
  cooldownUntil: number;
};

const DEFAULT_SHORT_LIMIT = 20;
const DEFAULT_SHORT_WINDOW_MS = 1_000;
const DEFAULT_LONG_LIMIT = 100;
const DEFAULT_LONG_WINDOW_MS = 120_000;
const ATTEMPT_TIMEOUT_MS = 5_000;
const OVERALL_DEADLINE_MS = 30_000;
const RETRY_BACKOFF_STEP_MS = 500;
const NORMAL_MAX_ATTEMPTS = 3;
const MATCH_MAX_ATTEMPTS = 5;

export type RiotApiRequestErrorReason =
  | "deadline"
  | "http"
  | "network"
  | "parse"
  | "schema"
  | "timeout";

export class RiotApiRequestError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly reason: RiotApiRequestErrorReason,
    readonly methodKey: string,
    readonly status?: number,
  ) {
    const guidance = status === 403
      ? "; authorization rejected; verify RIOT_API_KEY and endpoint access"
      : "";
    const message = reason === "http"
      ? `Riot API request failed: ${status} (${methodKey})${guidance}`
      : reason === "timeout"
      ? `Riot API request timed out (${methodKey})`
      : reason === "deadline"
      ? `Riot API request deadline exceeded (${methodKey})`
      : reason === "network"
      ? `Riot API network request failed (${methodKey})`
      : reason === "parse"
      ? `Riot API response parsing failed (${methodKey})`
      : `Riot API response validation failed (${methodKey})`;
    super(message);
    this.name = "RiotApiRequestError";
    this.retryable = reason === "network" || reason === "timeout" ||
      (reason === "http" &&
        (status === 429 || (status !== undefined && status >= 500)));
  }
}

export type RiotApiClock = {
  now(): number;
};

export type RiotApiSleeper = (
  ms: number,
  signal?: AbortSignal,
) => Promise<void>;

export type RiotApiEnv = {
  get(key: string): string | undefined;
};

export type RiotApiLogger = {
  warn(event: string, context?: Record<string, unknown>): void;
};

export type CreateRiotApiDependencies = {
  fetch: typeof fetch;
  clock: RiotApiClock;
  sleeper: RiotApiSleeper;
  env: RiotApiEnv;
  logger: RiotApiLogger;
};

export function defaultSleeper(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(complete, ms);

    function complete() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    function abort() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function methodKey(hostname: string, method: string) {
  return `${hostname}${method.slice(method.indexOf(" ") + 1)}`;
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

function resetExpiredBucket(bucket: RateBucket, now: number) {
  if (bucket.kind === "cooldown") return;
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + bucket.windowMs;
  }
}

function waitMsForBucket(bucket: RateBucket, now: number) {
  if (bucket.kind === "cooldown") {
    return Math.max(bucket.cooldownUntil - now, 0);
  }
  resetExpiredBucket(bucket, now);
  return Math.max(
    bucket.cooldownUntil - now,
    bucket.count >= bucket.limit ? bucket.resetAt - now : 0,
    0,
  );
}

function upsertHeaderBuckets(
  target: Map<string, RateBucket>,
  scope: "application" | "method",
  hostname: string,
  method: string | undefined,
  limits: { limit: number; windowMs: number }[],
  counts: { count: number; windowMs: number }[],
  now: number,
) {
  for (const limit of limits) {
    const key = scope === "application"
      ? `${scope}:${hostname}:${limit.windowMs}`
      : `${scope}:${hostname}:${method}:${limit.windowMs}`;
    const existing = target.get(key);
    const count = counts.find((item) => item.windowMs === limit.windowMs)
      ?.count ?? existing?.count ?? 1;
    target.set(key, {
      key,
      kind: "quota",
      scope,
      hostname,
      method,
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

type AttemptResult<T> =
  | { kind: "http"; status: number; retryAfterMs: number }
  | { kind: "network" }
  | { kind: "not_found" }
  | { kind: "parse" }
  | { kind: "schema" }
  | { kind: "success"; data: T }
  | { kind: "timeout" };

type ScheduledAttemptResult<T> =
  | { kind: "rate_limited"; waitMs: number }
  | { kind: "attempt"; result: AttemptResult<T> };

export function createRiotApi(dependencies: CreateRiotApiDependencies) {
  const appBuckets = new Map<string, RateBucket>();
  const methodBuckets = new Map<string, RateBucket>();
  let riotQueue = Promise.resolve();

  function numberEnv(name: string, fallback: number) {
    const value = Number(dependencies.env.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function riotApiKey() {
    const apiKey = dependencies.env.get("RIOT_API_KEY");
    if (!apiKey) throw new Error("RIOT_API_KEY is not set");
    return apiKey;
  }

  function retryAfterMs(response: Response, fallbackMs: number) {
    const retryAfter = response.headers.get("Retry-After");
    if (!retryAfter) return fallbackMs;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    return Number.isFinite(date)
      ? Math.max(date - dependencies.clock.now(), 0)
      : fallbackMs;
  }

  function defaultAppBuckets(hostname: string, now: number): RateBucket[] {
    const shortWindowMs = numberEnv(
      "RIOT_RATE_LIMIT_SHORT_WINDOW_MS",
      DEFAULT_SHORT_WINDOW_MS,
    );
    const longWindowMs = numberEnv(
      "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
      DEFAULT_LONG_WINDOW_MS,
    );
    return [
      {
        key: `application:${hostname}:${shortWindowMs}`,
        kind: "quota",
        scope: "application",
        hostname,
        limit: numberEnv(
          "RIOT_RATE_LIMIT_SHORT_WINDOW_LIMIT",
          DEFAULT_SHORT_LIMIT,
        ),
        windowMs: shortWindowMs,
        count: 0,
        resetAt: now + shortWindowMs,
        cooldownUntil: 0,
      },
      {
        key: `application:${hostname}:${longWindowMs}`,
        kind: "quota",
        scope: "application",
        hostname,
        limit: numberEnv(
          "RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT",
          DEFAULT_LONG_LIMIT,
        ),
        windowMs: longWindowMs,
        count: 0,
        resetAt: now + longWindowMs,
        cooldownUntil: 0,
      },
    ];
  }

  function ensureAppBuckets(hostname: string, now = dependencies.clock.now()) {
    let buckets = [...appBuckets.values()].filter((bucket) =>
      bucket.hostname === hostname
    );
    if (buckets.length === 0) {
      for (const bucket of defaultAppBuckets(hostname, now)) {
        appBuckets.set(bucket.key, bucket);
      }
      buckets = [...appBuckets.values()].filter((bucket) =>
        bucket.hostname === hostname
      );
    }
    return buckets;
  }

  function endpointBuckets(hostname: string, method: string, now: number) {
    for (const [key, bucket] of methodBuckets) {
      if (
        bucket.kind === "cooldown" && bucket.hostname === hostname &&
        bucket.method === method && now >= bucket.cooldownUntil
      ) {
        methodBuckets.delete(key);
      }
    }
    return [
      ...ensureAppBuckets(hostname, now),
      ...[...methodBuckets.values()].filter((bucket) =>
        bucket.hostname === hostname && bucket.method === method
      ),
    ];
  }

  function deadlineError(methodKey: string) {
    return new RiotApiRequestError("deadline", methodKey);
  }

  function assertBeforeDeadline(deadline: number, methodKey: string) {
    if (dependencies.clock.now() >= deadline) throw deadlineError(methodKey);
  }

  async function sleepWithinDeadline(
    requestedMs: number,
    deadline: number,
    methodKey: string,
  ) {
    if (requestedMs <= 0) return;
    const remainingMs = deadline - dependencies.clock.now();
    if (remainingMs <= 0) throw deadlineError(methodKey);
    const sleepMs = Math.min(requestedMs, remainingMs);
    await dependencies.sleeper(sleepMs);
    if (requestedMs > sleepMs || dependencies.clock.now() >= deadline) {
      throw deadlineError(methodKey);
    }
  }

  function riotRateLimitWaitMs(
    hostname: string,
    method: string,
  ) {
    const now = dependencies.clock.now();
    return Math.max(
      ...endpointBuckets(hostname, method, now).map((bucket) =>
        waitMsForBucket(bucket, now)
      ),
      0,
    );
  }

  function incrementBuckets(hostname: string, method: string) {
    const now = dependencies.clock.now();
    for (const bucket of endpointBuckets(hostname, method, now)) {
      if (bucket.kind === "cooldown") continue;
      resetExpiredBucket(bucket, now);
      bucket.count += 1;
    }
  }

  function replaceHeaderBucketWindows(
    target: Map<string, RateBucket>,
    hostname: string,
    method: string | undefined,
    windows: Set<number>,
  ) {
    for (const [key, bucket] of target) {
      if (
        bucket.hostname === hostname && bucket.method === method &&
        !windows.has(bucket.windowMs)
      ) target.delete(key);
    }
  }

  function applyRiotRateHeaders(
    response: Response,
    hostname: string,
    method: string,
  ) {
    const appLimits = parseRateLimitHeader(
      response.headers.get("X-App-Rate-Limit"),
    );
    const appCounts = parseRateCountHeader(
      response.headers.get("X-App-Rate-Limit-Count"),
    );
    const methodLimits = parseRateLimitHeader(
      response.headers.get("X-Method-Rate-Limit"),
    );
    const methodCounts = parseRateCountHeader(
      response.headers.get("X-Method-Rate-Limit-Count"),
    );
    const now = dependencies.clock.now();

    if (appLimits.length > 0) {
      replaceHeaderBucketWindows(
        appBuckets,
        hostname,
        undefined,
        new Set(appLimits.map(({ windowMs }) => windowMs)),
      );
      upsertHeaderBuckets(
        appBuckets,
        "application",
        hostname,
        undefined,
        appLimits,
        appCounts,
        now,
      );
    }
    if (methodLimits.length > 0) {
      replaceHeaderBucketWindows(
        methodBuckets,
        hostname,
        method,
        new Set(methodLimits.map(({ windowMs }) => windowMs)),
      );
      upsertHeaderBuckets(
        methodBuckets,
        "method",
        hostname,
        method,
        methodLimits,
        methodCounts,
        now,
      );
    }
  }

  function applyRetryAfterCooldown(
    response: Response,
    hostname: string,
    method: string,
    methodKey: string,
    fallbackMs: number,
  ) {
    const now = dependencies.clock.now();
    const cooldownMs = retryAfterMs(response, fallbackMs);
    const cooldownUntil = now + cooldownMs;
    const rateLimitType = response.headers.get("X-Rate-Limit-Type");
    let buckets = rateLimitType === "method"
      ? [...methodBuckets.values()].filter((bucket) =>
        bucket.hostname === hostname && bucket.method === method
      )
      : ensureAppBuckets(hostname, now);
    if (rateLimitType === "method" && buckets.length === 0) {
      const windowMs = Math.max(cooldownMs, 1);
      const key = `method:${hostname}:${method}:${windowMs}`;
      const bucket: RateBucket = {
        key,
        kind: "cooldown",
        scope: "method",
        hostname,
        method,
        limit: 1,
        windowMs,
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
    try {
      dependencies.logger.warn("riot_api.rate_limited", {
        rateLimitType: rateLimitType ?? "application",
        methodKey,
        retryAfterMs: cooldownMs,
      });
    } catch {
      // Logging must not prevent the queue tail from being released.
    }
  }

  function cancelBody(response: Response) {
    try {
      response.body?.cancel().catch(() => undefined);
    } catch {
      // A failed body cancellation does not change the request result.
    }
  }

  async function performAttempt<T>(
    url: URL,
    schema: z.ZodType<T>,
    apiKey: string,
    requestController: AbortController,
    fallbackCooldownMs: number,
    method: string,
    methodKey: string,
  ): Promise<AttemptResult<T>> {
    let response: Response;
    try {
      response = await dependencies.fetch(url, {
        headers: { "X-Riot-Token": apiKey },
        signal: requestController.signal,
      });
    } catch {
      return requestController.signal.aborted
        ? { kind: "timeout" }
        : { kind: "network" };
    }
    if (requestController.signal.aborted) {
      cancelBody(response);
      return { kind: "timeout" };
    }

    applyRiotRateHeaders(response, url.hostname, method);
    if (response.status === 429) {
      applyRetryAfterCooldown(
        response,
        url.hostname,
        method,
        methodKey,
        fallbackCooldownMs,
      );
    }
    if (response.status === 404) {
      cancelBody(response);
      return { kind: "not_found" };
    }
    if (!response.ok) {
      const status = response.status;
      const retryDelayMs = retryAfterMs(response, fallbackCooldownMs);
      cancelBody(response);
      return { kind: "http", status, retryAfterMs: retryDelayMs };
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return { kind: "network" };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { kind: "parse" };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { kind: "schema" };
    return { kind: "success", data: parsed.data };
  }

  async function attempt<T>(
    url: URL,
    schema: z.ZodType<T>,
    apiKey: string,
    deadline: number,
    fallbackCooldownMs: number,
    method: string,
    methodKeyValue: string,
  ): Promise<AttemptResult<T>> {
    assertBeforeDeadline(deadline, methodKeyValue);
    const attemptDeadline = Math.min(
      deadline,
      dependencies.clock.now() + ATTEMPT_TIMEOUT_MS,
    );
    const requestController = new AbortController();
    const operation = performAttempt(
      url,
      schema,
      apiKey,
      requestController,
      fallbackCooldownMs,
      method,
      methodKeyValue,
    );
    let settled = false;
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Immediate fake responses may require several promise jobs to read JSON.
    // Let them settle before arming an injected sleeper that advances fake time.
    for (let index = 0; index < 10 && !settled; index++) {
      await Promise.resolve();
    }
    if (settled) return await operation;

    const sleepController = new AbortController();
    const timeoutPromise = dependencies.sleeper(
      Math.max(attemptDeadline - dependencies.clock.now(), 0),
      sleepController.signal,
    ).then(
      () => ({ kind: "timeout" } as const),
      () => ({ kind: "timeout" } as const),
    );
    try {
      const result = await Promise.race([operation, timeoutPromise]);
      if (result.kind === "timeout") requestController.abort();
      return result;
    } finally {
      sleepController.abort();
    }
  }

  async function scheduleRiotAttempt<T>(
    methodKey: string,
    deadline: number,
    task: () => Promise<T>,
  ) {
    const previous = riotQueue;
    let releaseQueue!: () => void;
    const queueSlot = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    riotQueue = previous.then(() => queueSlot);
    try {
      let previousSettled = false;
      void previous.then(() => {
        previousSettled = true;
      });
      for (let index = 0; index < 10 && !previousSettled; index++) {
        await Promise.resolve();
      }
      if (!previousSettled) {
        const sleepController = new AbortController();
        const deadlineWait = dependencies.sleeper(
          Math.max(deadline - dependencies.clock.now(), 0),
          sleepController.signal,
        ).then(
          () => {
            throw deadlineError(methodKey);
          },
          () => {
            throw deadlineError(methodKey);
          },
        );
        try {
          await Promise.race([previous, deadlineWait]);
        } finally {
          sleepController.abort();
        }
      }
      assertBeforeDeadline(deadline, methodKey);
      return await task();
    } finally {
      releaseQueue();
    }
  }

  async function fetchRiotJson<T>(
    url: URL,
    schema: z.ZodType<T>,
    options: {
      method: string;
      maxAttempts?: number;
      notFoundAsNull?: boolean;
    },
  ): Promise<T | null> {
    const requestMethodKey = methodKey(url.hostname, options.method);
    const deadline = dependencies.clock.now() + OVERALL_DEADLINE_MS;
    const apiKey = riotApiKey();
    const maxAttempts = options.maxAttempts ?? NORMAL_MAX_ATTEMPTS;
    const method = options.method;
    let attemptNumber = 1;
    while (true) {
      assertBeforeDeadline(deadline, requestMethodKey);
      const fallbackMs = RETRY_BACKOFF_STEP_MS * attemptNumber;
      const scheduled = await scheduleRiotAttempt<ScheduledAttemptResult<T>>(
        requestMethodKey,
        deadline,
        async () => {
          const waitMs = riotRateLimitWaitMs(url.hostname, method);
          if (waitMs > 0) return { kind: "rate_limited", waitMs };

          incrementBuckets(url.hostname, method);
          return {
            kind: "attempt",
            result: await attempt(
              url,
              schema,
              apiKey,
              deadline,
              fallbackMs,
              method,
              requestMethodKey,
            ),
          };
        },
      );
      if (scheduled.kind === "rate_limited") {
        await sleepWithinDeadline(
          scheduled.waitMs,
          deadline,
          requestMethodKey,
        );
        continue;
      }

      const result = scheduled.result;
      assertBeforeDeadline(deadline, requestMethodKey);

      if (result.kind === "success") {
        return result.data;
      }
      if (result.kind === "not_found" && options.notFoundAsNull) return null;
      if (result.kind === "parse" || result.kind === "schema") {
        throw new RiotApiRequestError(result.kind, requestMethodKey);
      }
      if (result.kind === "not_found") {
        throw new RiotApiRequestError("http", requestMethodKey, 404);
      }
      const retryable = result.kind === "network" ||
        result.kind === "timeout" ||
        (result.kind === "http" &&
          (result.status === 429 || result.status >= 500));
      if (!retryable || attemptNumber >= maxAttempts) {
        throw new RiotApiRequestError(
          result.kind,
          requestMethodKey,
          result.kind === "http" ? result.status : undefined,
        );
      }
      const linearBackoffMs = RETRY_BACKOFF_STEP_MS * attemptNumber;
      const retryDelayMs = result.kind === "http"
        ? Math.max(linearBackoffMs, result.retryAfterMs)
        : linearBackoffMs;
      await sleepWithinDeadline(
        retryDelayMs,
        deadline,
        requestMethodKey,
      );
      attemptNumber += 1;
    }
  }

  async function getAccountByRiotId(
    region: RiotRegion,
    gameName: string,
    tagLine: string,
  ) {
    const url = new URL(
      `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${
        encodeURIComponent(gameName)
      }/${encodeURIComponent(tagLine)}`,
    );
    return await fetchRiotJson(url, riotAccountSchema, {
      method: "GET /riot/account/v1/accounts/by-riot-id/:gameName/:tagLine",
      notFoundAsNull: true,
    });
  }

  async function getActiveGameByPuuid(platform: RiotPlatform, puuid: string) {
    const url = new URL(
      `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${
        encodeURIComponent(puuid)
      }`,
    );
    return await fetchRiotJson(url, activeGameSchema, {
      method: "GET /lol/spectator/v5/active-games/by-summoner/:puuid",
      notFoundAsNull: true,
    });
  }

  async function getMatchById(region: RiotRegion, matchId: string) {
    const url = new URL(
      `https://${region}.api.riotgames.com/lol/match/v5/matches/${
        encodeURIComponent(matchId)
      }`,
    );
    return await fetchRiotJson(url, matchSchema, {
      method: "GET /lol/match/v5/matches/:matchId",
      maxAttempts: MATCH_MAX_ATTEMPTS,
      notFoundAsNull: true,
    });
  }

  async function getLeagueEntriesByPuuid(
    platform: RiotPlatform,
    puuid: string,
  ) {
    const url = new URL(
      `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${
        encodeURIComponent(puuid)
      }`,
    );
    return (await fetchRiotJson(url, z.array(leagueEntrySchema), {
      method: "GET /lol/league/v4/entries/by-puuid/:puuid",
      notFoundAsNull: true,
    })) ?? [];
  }

  return {
    getAccountByRiotId,
    getActiveGameByPuuid,
    getMatchById,
    getLeagueEntriesByPuuid,
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
}

export const riotApi = createRiotApi({
  fetch: (input, init) => globalThis.fetch(input, init),
  clock: { now: () => Date.now() },
  sleeper: defaultSleeper,
  env: Deno.env,
  logger: apiLogger,
});
