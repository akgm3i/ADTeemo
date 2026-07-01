import type { Client } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import {
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  shouldNotifyInGame as shouldNotifyInGameWithConfig,
} from "./match_tracking_state.ts";
import {
  createMatchTrackingNotifier,
  type WatcherChannel,
} from "./match_tracking_notifier.ts";
import { createMatchTrackingRenderer } from "./match_tracking_renderer.ts";
import {
  createMatchTrackingService,
  type MatchTrackingServiceConfig,
} from "./match_tracking_service.ts";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS = 300_000;
const DEFAULT_RESULT_FETCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DEFAULT_RIOT_LONG_WINDOW_LIMIT = 100;
const DEFAULT_RIOT_LONG_WINDOW_MS = 2 * 60 * 1000;

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function messageLocale() {
  return (Deno.env.get("BOT_MESSAGE_LANG") ?? Deno.env.get("LC_MESSAGES") ??
    Deno.env.get("LC_ALL") ?? "ja_JP").replace("-", "_").split(".")[0];
}

function matchTrackingServiceConfig(): MatchTrackingServiceConfig {
  return {
    pollIntervalMs: numberEnv(
      "MATCH_WATCH_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
    ),
    inGameNotifyIntervalMs: numberEnv(
      "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
      DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS,
    ),
    resultFetchTimeoutMs: numberEnv(
      "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
      DEFAULT_RESULT_FETCH_TIMEOUT_MS,
    ),
    riotLongWindowLimit: numberEnv(
      "RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT",
      DEFAULT_RIOT_LONG_WINDOW_LIMIT,
    ),
    riotLongWindowMs: numberEnv(
      "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
      DEFAULT_RIOT_LONG_WINDOW_MS,
    ),
  };
}

async function resolveRiotStaticData(input: {
  championIds: number[];
  queueIds: number[];
  mapIds: number[];
  gameModes: string[];
}) {
  const result = await apiClient.resolveRiotStaticData({
    locale: messageLocale(),
    ...input,
  });
  return result.success ? result.data : null;
}

function createDefaultMatchTrackingRenderer() {
  return createMatchTrackingRenderer({
    messages: {
      formatMessage: messageHandler.formatMessage.bind(messageHandler),
      keys: messageKeys,
    },
    resolveStaticData: resolveRiotStaticData,
    clock: {
      now: () => new Date(),
    },
  });
}

function createDefaultMatchTrackingService(client: Client) {
  return createMatchTrackingService({
    apiClient,
    notifier: createMatchTrackingNotifier({
      client: {
        channels: {
          fetch: async (channelId) =>
            await client.channels.fetch(channelId) as WatcherChannel | null,
        },
      },
      logger: botLogger,
    }),
    renderer: createDefaultMatchTrackingRenderer(),
    clock: {
      now: () => new Date(),
    },
    logger: botLogger,
    config: matchTrackingServiceConfig(),
  });
}

async function processMatchWatchers(client: Client) {
  await createDefaultMatchTrackingService(client).processMatchWatchers();
}

let workerId: number | undefined;
let processingMatchWatchers = false;
let lastBudgetWarningAt = 0;

function warnIfRiotRequestBudgetRisk(watcherCount: number) {
  const config = matchTrackingServiceConfig();
  const estimatedRequests = watcherCount *
    Math.ceil(config.riotLongWindowMs / config.pollIntervalMs);
  const now = Date.now();
  if (
    estimatedRequests >= config.riotLongWindowLimit * 0.8 &&
    now - lastBudgetWarningAt >= config.riotLongWindowMs
  ) {
    lastBudgetWarningAt = now;
    botLogger.warn("match_tracking.riot_request_budget_risk", {
      watcherCount,
      pollIntervalMs: config.pollIntervalMs,
      rateLimitWindowMs: config.riotLongWindowMs,
      estimatedRequestsPerWindow: estimatedRequests,
      limitPerWindow: config.riotLongWindowLimit,
    });
  }
}

async function guardedProcessMatchWatchers(client: Client) {
  if (processingMatchWatchers) {
    botLogger.warn("match_tracking.worker_tick_skipped", {
      reason: "previous_tick_still_running",
    });
    return;
  }
  processingMatchWatchers = true;
  try {
    await processMatchWatchers(client);
  } finally {
    processingMatchWatchers = false;
  }
}

function startMatchTrackingWorker(client: Client) {
  if (workerId !== undefined) return;

  const pollIntervalMs = numberEnv(
    "MATCH_WATCH_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  workerId = setInterval(() => {
    guardedProcessMatchWatchers(client);
  }, pollIntervalMs);
  guardedProcessMatchWatchers(client);
}

function stopMatchTrackingWorker() {
  if (workerId === undefined) return;
  clearInterval(workerId);
  workerId = undefined;
}

function hasResultFetchTimedOut(watcher: MatchWatcher) {
  return hasResultFetchTimedOutWithConfig(
    watcher,
    numberEnv(
      "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
      DEFAULT_RESULT_FETCH_TIMEOUT_MS,
    ),
    new Date(),
  );
}

function shouldNotifyInGame(watcher: MatchWatcher) {
  return shouldNotifyInGameWithConfig(
    watcher,
    numberEnv(
      "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
      DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS,
    ),
    new Date(),
  );
}

export const matchTracker = {
  processMatchWatchers,
  startMatchTrackingWorker,
  stopMatchTrackingWorker,
  hasResultFetchTimedOut,
  shouldNotifyInGame,
  warnIfRiotRequestBudgetRisk,
};
