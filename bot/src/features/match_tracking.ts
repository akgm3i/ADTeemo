import type { Client } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { botLogger, createBotLogger } from "../logger.ts";
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
import { createRiotRequestBudgetMonitor } from "./match_tracking_budget.ts";

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

function createDefaultMatchTrackingService(
  client: Client,
  correlationId: string = crypto.randomUUID(),
) {
  const logContext = { correlationId };
  const logger = createBotLogger(logContext);
  const service = createMatchTrackingService({
    apiClient,
    notifier: createMatchTrackingNotifier({
      client: {
        channels: {
          fetch: async (channelId) =>
            await client.channels.fetch(channelId) as WatcherChannel | null,
        },
      },
      logger,
    }),
    renderer: createDefaultMatchTrackingRenderer(),
    clock: {
      now: () => new Date(),
    },
    logger,
    config: matchTrackingServiceConfig(),
  });
  return {
    ...service,
    setCorrelationId(value: string) {
      logContext.correlationId = value;
    },
  };
}

async function processMatchWatchers(client: Client) {
  await createDefaultMatchTrackingService(client).processMatchWatchers();
}

export type MatchTrackingWorkerService = {
  processMatchWatchers: () => Promise<void>;
  setCorrelationId?: (correlationId: string) => void;
};

export type MatchTrackingWorkerScheduler = {
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
};

export type MatchTrackingWorkerDependencies = {
  createService: () => MatchTrackingWorkerService;
  scheduler: MatchTrackingWorkerScheduler;
  config: {
    pollIntervalMs: number;
  };
  logger: {
    warn: (message: string, metadata: Record<string, unknown>) => void;
    error: (
      message: string,
      metadata: Record<string, unknown>,
      error?: unknown,
    ) => void;
  };
};

export function createMatchTrackingWorker(
  dependencies: MatchTrackingWorkerDependencies,
) {
  let workerId: number | undefined;
  let processingMatchWatchers = false;

  async function guardedProcessMatchWatchers(
    service: MatchTrackingWorkerService,
  ) {
    const correlationId = crypto.randomUUID();
    if (processingMatchWatchers) {
      dependencies.logger.warn("match_tracking.worker_tick_skipped", {
        correlationId,
        reason: "previous_tick_still_running",
      });
      return;
    }
    processingMatchWatchers = true;
    service.setCorrelationId?.(correlationId);
    try {
      await service.processMatchWatchers();
    } catch (error) {
      dependencies.logger.error("match_tracking.worker_tick_failed", {
        correlationId,
        errorCategory: "unexpected",
      }, error);
    } finally {
      processingMatchWatchers = false;
    }
  }

  function start() {
    if (workerId !== undefined) return;

    const service = dependencies.createService();
    workerId = dependencies.scheduler.setInterval(() => {
      void guardedProcessMatchWatchers(service);
    }, dependencies.config.pollIntervalMs);
    void guardedProcessMatchWatchers(service);
  }

  function stop() {
    if (workerId === undefined) return;
    dependencies.scheduler.clearInterval(workerId);
    workerId = undefined;
  }

  return {
    start,
    stop,
  };
}

function createDefaultMatchTrackingWorker(client: Client) {
  return createMatchTrackingWorker({
    createService: () => createDefaultMatchTrackingService(client),
    scheduler: {
      setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
      clearInterval: (intervalId) => clearInterval(intervalId),
    },
    config: {
      pollIntervalMs: numberEnv(
        "MATCH_WATCH_POLL_INTERVAL_MS",
        DEFAULT_POLL_INTERVAL_MS,
      ),
    },
    logger: botLogger,
  });
}

let defaultWorker:
  | ReturnType<typeof createDefaultMatchTrackingWorker>
  | undefined;

const defaultBudgetMonitor = createRiotRequestBudgetMonitor({
  config: matchTrackingServiceConfig,
  clock: {
    now: () => new Date(),
  },
  logger: botLogger,
});

function startMatchTrackingWorker(client: Client) {
  defaultWorker ??= createDefaultMatchTrackingWorker(client);
  defaultWorker.start();
}

function stopMatchTrackingWorker() {
  defaultWorker?.stop();
  defaultWorker = undefined;
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
  createMatchTrackingWorker,
  createDefaultMatchTrackingWorker,
  startMatchTrackingWorker,
  stopMatchTrackingWorker,
  hasResultFetchTimedOut,
  shouldNotifyInGame,
  warnIfRiotRequestBudgetRisk: defaultBudgetMonitor.warnIfRiotRequestBudgetRisk,
};
