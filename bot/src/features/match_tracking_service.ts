import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import type { ApiClient } from "../api_client.ts";
import { wasFailureLogged } from "../api_clients/transport.ts";
import {
  type ActiveNotificationGroup,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  isAfterDate,
  matchIdForGame,
  matchIdParts,
  newerDate,
  type PendingResult,
  pendingResultFromWatcher,
  selectResultNotificationMessageId,
  shouldNotifyActiveNotificationGroup
    as shouldNotifyActiveNotificationGroupWithConfig,
  shouldNotifyInGame as shouldNotifyInGameWithConfig,
} from "./match_tracking_state.ts";
import { createRiotRequestBudgetMonitor } from "./match_tracking_budget.ts";
import type { NotificationResult } from "./match_tracking_notifier.ts";
import type { createMatchTrackingRenderer } from "./match_tracking_renderer.ts";

type ActiveGame = NonNullable<
  Awaited<ReturnType<ApiClient["getActiveGameByPuuid"]>>
>;
type RiotAccountResult = Awaited<ReturnType<ApiClient["getRiotAccount"]>>;
type ActiveGameInspectionResult = Awaited<
  ReturnType<ApiClient["inspectMatchWatcherActiveGame"]>
>;
type ResultInspectionResult = Awaited<
  ReturnType<ApiClient["inspectMatchWatcherResult"]>
>;
type WatcherInspectionFailure =
  | Extract<ActiveGameInspectionResult, { success: false }>
  | Extract<ResultInspectionResult, { success: false }>;
type WatcherInspectionOperation = "active_game" | "result";
type WatcherState = Parameters<ApiClient["updateMatchWatcherState"]>[2];
type MatchTrackingRenderer = ReturnType<typeof createMatchTrackingRenderer>;
type MatchTrackingEmbed = ReturnType<MatchTrackingRenderer["resultPending"]>;
type MatchTrackingNotifier = {
  sendOrEditWatcherMessage: (
    watcher: MatchWatcher,
    messageId: string | null | undefined,
    embed: MatchTrackingEmbed,
    intentKey: string,
  ) => Promise<NotificationResult>;
};
type MatchWatcherProcessingContext = {
  inspectionBatchId: string;
  activeNotificationGroups: Map<string, ActiveNotificationGroup>;
  riotAccountsByPuuid: Map<string, Promise<RiotAccountResult>>;
  activeGameInspectionsByTargetAndState: Map<
    string,
    Promise<ActiveGameInspectionResult>
  >;
  resultInspectionsByTargetAndMatchId: Map<
    string,
    Promise<ResultInspectionResult>
  >;
};
type ActiveGameTargetDetail = {
  targetDiscordId: string;
  riotAccountPuuid: string;
  accountName: string;
  championId?: number;
};
export type MatchTrackingServiceConfig = {
  pollIntervalMs: number;
  inGameNotifyIntervalMs: number;
  resultFetchTimeoutMs: number;
  riotLongWindowLimit: number;
  riotLongWindowMs: number;
};
export type MatchTrackingServiceLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (
    message: string,
    metadata?: Record<string, unknown>,
    error?: unknown,
  ) => void;
};
export type MatchTrackingServiceClock = {
  now: () => Date;
};
export type MatchTrackingServiceApiClient = Pick<
  ApiClient,
  | "getEnabledMatchWatchers"
  | "getRiotAccount"
  | "inspectMatchWatcherActiveGame"
  | "inspectMatchWatcherResult"
  | "updateMatchWatcherState"
>;
export type MatchTrackingServiceDependencies = {
  apiClient: MatchTrackingServiceApiClient;
  notifier: MatchTrackingNotifier;
  renderer: MatchTrackingRenderer;
  clock: MatchTrackingServiceClock;
  logger: MatchTrackingServiceLogger;
  config: MatchTrackingServiceConfig;
};

function createMatchWatcherProcessingContext(): MatchWatcherProcessingContext {
  return {
    inspectionBatchId: crypto.randomUUID(),
    activeNotificationGroups: new Map(),
    riotAccountsByPuuid: new Map(),
    activeGameInspectionsByTargetAndState: new Map(),
    resultInspectionsByTargetAndMatchId: new Map(),
  };
}

async function seedMatchWatcherProcessingContext(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watchers: MatchWatcher[],
) {
  for (const watcher of watchers) {
    rememberPendingResultNotificationMessage(
      context.activeNotificationGroups,
      watcher,
    );

    if (
      watcher.lastState !== "IN_GAME" || !watcher.currentGameId
    ) {
      continue;
    }

    const accountResult = await getRiotAccountForWatcher(
      dependencies,
      context,
      watcher,
    );
    if (!accountResult.success) continue;

    const key = activeNotificationGroupKey(
      watcher,
      accountResult.account.platform,
      watcher.currentGameId,
    );
    const existingGroup = context.activeNotificationGroups.get(key);
    if (existingGroup) {
      existingGroup.targetAccountPuuids.add(watcher.riotAccountPuuid);
      rememberActiveNotificationWatcher(existingGroup, watcher);
      rememberActiveNotificationMessage(existingGroup, watcher);
      continue;
    }

    const group: ActiveNotificationGroup = {
      messageId: watcher.currentNotificationMessageId,
      targetAccountPuuids: new Set([watcher.riotAccountPuuid]),
      activeWatchers: new Map([[watcher.riotAccountPuuid, watcher]]),
      messageIdAccountPuuids: new Map(),
      resultMessageIdsInUse: new Set(),
    };
    rememberActiveNotificationMessage(group, watcher);
    context.activeNotificationGroups.set(key, group);
  }
}

function rememberPendingResultNotificationMessage(
  activeNotificationGroups: Map<string, ActiveNotificationGroup>,
  watcher: MatchWatcher,
) {
  const pending = pendingResultFromWatcher(watcher);
  if (!pending?.messageId) return;

  const parts = matchIdParts(pending.matchId);
  if (!parts) return;

  const key = activeNotificationGroupKey(watcher, parts.platform, parts.gameId);
  const existingGroup = activeNotificationGroups.get(key);
  if (existingGroup) {
    existingGroup.resultMessageIdsInUse.add(pending.messageId);
    return;
  }

  activeNotificationGroups.set(key, {
    messageId: null,
    targetAccountPuuids: new Set(),
    activeWatchers: new Map(),
    messageIdAccountPuuids: new Map(),
    resultMessageIdsInUse: new Set([pending.messageId]),
  });
}

function rememberActiveNotificationWatcher(
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
) {
  const existing = group.activeWatchers.get(watcher.riotAccountPuuid);
  if (!existing) {
    group.activeWatchers.set(watcher.riotAccountPuuid, watcher);
    return;
  }

  const shouldKeepSyncedGroupMessageId = group.messageId !== null &&
    existing.currentNotificationMessageId === group.messageId &&
    watcher.currentNotificationMessageId !== group.messageId;
  const currentNotificationMessageId = shouldKeepSyncedGroupMessageId
    ? existing.currentNotificationMessageId
    : watcher.currentNotificationMessageId ??
      existing.currentNotificationMessageId;

  group.activeWatchers.set(watcher.riotAccountPuuid, {
    ...watcher,
    currentGameId: watcher.currentGameId ?? existing.currentGameId,
    currentNotificationMessageId,
    lastInGameNotifiedAt: newerDate(
      existing.lastInGameNotifiedAt,
      watcher.lastInGameNotifiedAt,
    ),
  });
}

function rememberActiveNotificationMessage(
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
  messageId = watcher.currentNotificationMessageId,
) {
  if (!messageId) return;
  group.messageId ??= messageId;
  const targetAccountPuuids = group.messageIdAccountPuuids.get(messageId) ??
    new Set<string>();
  targetAccountPuuids.add(watcher.riotAccountPuuid);
  group.messageIdAccountPuuids.set(messageId, targetAccountPuuids);
}

function resultNotificationMessageId(
  group: ActiveNotificationGroup | undefined,
  watcher: MatchWatcher,
) {
  if (!group) return watcher.currentNotificationMessageId ?? null;

  const activeWatcher = group.activeWatchers.get(watcher.riotAccountPuuid);
  const messageId = selectResultNotificationMessageId({
    groupMessageId: group.messageId,
    watcherMessageId: watcher.currentNotificationMessageId,
    activeWatcherMessageId: activeWatcher?.currentNotificationMessageId,
    usedMessageIds: group.resultMessageIdsInUse,
  });
  if (!messageId) return null;
  group.resultMessageIdsInUse.add(messageId);
  return messageId;
}

function getActiveNotificationGroup(
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
  account: RiotAccount,
  gameId: string | number,
) {
  const key = activeNotificationGroupKey(watcher, account.platform, gameId);
  const existing = context.activeNotificationGroups.get(key);
  if (existing) {
    existing.targetAccountPuuids.add(watcher.riotAccountPuuid);
    if (
      !existing.messageId && watcher.currentGameId === String(gameId) &&
      watcher.currentNotificationMessageId
    ) {
      existing.messageId = watcher.currentNotificationMessageId;
    }
    if (watcher.currentGameId === String(gameId)) {
      rememberActiveNotificationWatcher(existing, watcher);
      rememberActiveNotificationMessage(existing, watcher);
    }
    return existing;
  }

  const group: ActiveNotificationGroup = {
    messageId: watcher.currentGameId === String(gameId)
      ? watcher.currentNotificationMessageId
      : null,
    targetAccountPuuids: new Set([watcher.riotAccountPuuid]),
    activeWatchers: new Map(),
    messageIdAccountPuuids: new Map(),
    resultMessageIdsInUse: new Set(),
  };
  if (watcher.currentGameId === String(gameId)) {
    rememberActiveNotificationWatcher(group, watcher);
    rememberActiveNotificationMessage(group, watcher);
  }
  context.activeNotificationGroups.set(key, group);
  return group;
}

async function updateActiveNotificationGroupMessage(
  dependencies: MatchTrackingServiceDependencies,
  group: ActiveNotificationGroup,
  currentWatcher: MatchWatcher,
  gameId: string,
  messageId: string | null,
  notifiedAt?: Date,
) {
  if (!messageId) return;
  group.messageId = messageId;
  rememberActiveNotificationWatcher(group, {
    ...currentWatcher,
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentNotificationMessageId: messageId,
    lastInGameNotifiedAt: notifiedAt &&
        isAfterDate(notifiedAt, currentWatcher.lastInGameNotifiedAt)
      ? notifiedAt
      : currentWatcher.lastInGameNotifiedAt,
  });
  rememberActiveNotificationMessage(group, currentWatcher, messageId);
  if (!messageId) {
    return;
  }

  for (const watcher of group.activeWatchers.values()) {
    if (watcher.riotAccountPuuid === currentWatcher.riotAccountPuuid) continue;
    await syncActiveNotificationWatcherState(
      dependencies,
      group,
      watcher,
      gameId,
      messageId,
      messageId ? notifiedAt : undefined,
    );
  }
}

async function syncActiveNotificationWatcherState(
  dependencies: MatchTrackingServiceDependencies,
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
  gameId: string,
  messageId: string | null,
  notifiedAt?: Date,
) {
  if (!messageId) return false;

  const shouldSyncMessageId = watcher.currentNotificationMessageId !==
    messageId;
  const shouldSyncNotifiedAt = notifiedAt &&
    isAfterDate(notifiedAt, watcher.lastInGameNotifiedAt);
  if (!shouldSyncMessageId && !shouldSyncNotifiedAt) return false;

  await setWatcherState(dependencies, watcher, {
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentNotificationMessageId: messageId,
    lastCheckedAt: dependencies.clock.now(),
    ...(shouldSyncNotifiedAt ? { lastInGameNotifiedAt: notifiedAt } : {}),
  });
  rememberActiveNotificationWatcher(group, {
    ...watcher,
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentNotificationMessageId: messageId,
    lastInGameNotifiedAt: shouldSyncNotifiedAt
      ? notifiedAt
      : watcher.lastInGameNotifiedAt,
  });
  rememberActiveNotificationMessage(group, watcher, messageId);
  return true;
}

function getRiotAccountForWatcher(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
) {
  const cached = context.riotAccountsByPuuid.get(watcher.riotAccountPuuid);
  if (cached) return cached;
  const result = dependencies.apiClient.getRiotAccount(
    watcher.targetDiscordId,
    watcher.riotAccountPuuid,
  );
  context.riotAccountsByPuuid.set(watcher.riotAccountPuuid, result);
  return result;
}

function rememberRiotAccountForWatcher(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
) {
  context.riotAccountsByPuuid.set(
    account.puuid,
    Promise.resolve({ success: true as const, account }),
  );
}

async function inspectActiveGameForWatcher(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
) {
  const input = {
    inspectionBatchId: context.inspectionBatchId,
    riotAccountPuuid: watcher.riotAccountPuuid,
    lastState: watcher.lastState,
    currentGameId: watcher.currentGameId,
    currentNotificationMessageId: watcher.currentNotificationMessageId,
    gameStartedAt: watcher.gameStartedAt,
    lastInGameNotifiedAt: watcher.lastInGameNotifiedAt,
  };
  // The API returns a watcher-specific intent and transition, not just Riot
  // data. Reuse it only for the same scope and complete request payload.
  const cacheKey = JSON.stringify([
    watcher.guildId,
    watcher.targetDiscordId,
    input,
  ]);
  let promise = context.activeGameInspectionsByTargetAndState.get(cacheKey);
  if (!promise) {
    promise = dependencies.apiClient.inspectMatchWatcherActiveGame(
      watcher.guildId,
      watcher.targetDiscordId,
      input,
    );
    context.activeGameInspectionsByTargetAndState.set(cacheKey, promise);
  }

  const result = await promise;
  if (result.success) {
    rememberRiotAccountForWatcher(context, result.account);
  }
  return result;
}

function resultInspectionCacheKey(
  watcher: MatchWatcher,
  pending: PendingResult,
  resultFetchTimeoutMs: number,
) {
  return JSON.stringify({
    guildId: watcher.guildId,
    targetDiscordId: watcher.targetDiscordId,
    riotAccountPuuid: watcher.riotAccountPuuid,
    matchId: pending.matchId,
    messageId: pending.messageId ?? null,
    startedAt: pending.startedAt?.toISOString() ?? null,
    resultFetchTimeoutMs,
  });
}

async function inspectResultForWatcher(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
  pending: PendingResult,
) {
  const cacheKey = resultInspectionCacheKey(
    watcher,
    pending,
    dependencies.config.resultFetchTimeoutMs,
  );
  let promise = context.resultInspectionsByTargetAndMatchId.get(cacheKey);
  if (!promise) {
    promise = dependencies.apiClient.inspectMatchWatcherResult(
      watcher.guildId,
      watcher.targetDiscordId,
      {
        inspectionBatchId: context.inspectionBatchId,
        riotAccountPuuid: watcher.riotAccountPuuid,
        matchId: pending.matchId,
        messageId: pending.messageId,
        startedAt: pending.startedAt,
        resultFetchTimeoutMs: dependencies.config.resultFetchTimeoutMs,
      },
    );
    context.resultInspectionsByTargetAndMatchId.set(cacheKey, promise);
  }

  const result = await promise;
  if (result.success) {
    rememberRiotAccountForWatcher(context, result.account);
  }
  return result;
}

function shouldNotifyActiveNotificationGroup(
  dependencies: MatchTrackingServiceDependencies,
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
) {
  return shouldNotifyActiveNotificationGroupWithConfig(
    group,
    watcher,
    dependencies.config.inGameNotifyIntervalMs,
    dependencies.clock.now(),
  );
}

function shouldNotifyInGame(
  watcher: MatchWatcher,
  intervalMs: number,
  now: Date,
) {
  return shouldNotifyInGameWithConfig(watcher, intervalMs, now);
}

function hasResultFetchTimedOut(
  watcher: MatchWatcher,
  timeoutMs: number,
  now: Date,
) {
  return hasResultFetchTimedOutWithConfig(watcher, timeoutMs, now);
}

async function activeGameTargetDetails(
  context: MatchWatcherProcessingContext,
  activeGame: ActiveGame,
  targetAccountPuuids: Iterable<string>,
): Promise<ActiveGameTargetDetail[]> {
  const details: ActiveGameTargetDetail[] = [];
  for (const puuid of targetAccountPuuids) {
    const accountResult = await context.riotAccountsByPuuid.get(puuid);
    if (!accountResult?.success) continue;
    const account = accountResult.account;
    const participant = activeGame.participants.find((p) => p.puuid === puuid);
    details.push({
      targetDiscordId: account.discordId,
      riotAccountPuuid: puuid,
      accountName: `${account.gameName}#${account.tagLine}`,
      championId: participant?.championId,
    });
  }
  return details;
}

async function setWatcherState(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  state: WatcherState,
) {
  const result = await dependencies.apiClient.updateMatchWatcherState(
    watcher.guildId,
    watcher.targetDiscordId,
    { ...state, riotAccountPuuid: watcher.riotAccountPuuid },
  );
  if (!result.success) {
    throw new Error("Match watcher state persistence failed", {
      cause: result,
    });
  }
}

async function notify(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  messageId: string | null | undefined,
  embed: MatchTrackingEmbed,
  intentKey: string,
): Promise<string | null> {
  const result = await dependencies.notifier.sendOrEditWatcherMessage(
    watcher,
    messageId,
    embed,
    intentKey,
  );
  if (result.status === "sent" || result.status === "edited") {
    return result.messageId;
  }
  if (result.status === "permanent_failure") {
    dependencies.logger.error("match_tracking.delivery_permanent_failure", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      reason: result.reason,
    });
    return null;
  }
  throw new Error("Match notification was not delivered", { cause: result });
}

function resultTransitionStateForCurrentState(
  currentState: WatcherState,
  state: Partial<WatcherState> | undefined,
): Partial<WatcherState> {
  if (!state || currentState.lastState !== "IN_GAME") return state ?? {};
  const {
    lastState: _lastState,
    currentGameId: _currentGameId,
    currentMatchId: _currentMatchId,
    currentNotificationMessageId: _currentNotificationMessageId,
    gameStartedAt: _gameStartedAt,
    lastInGameNotifiedAt: _lastInGameNotifiedAt,
    ...resultState
  } = state;
  return resultState;
}

function logWatcherInspectionFailure(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  operation: WatcherInspectionOperation,
  result: WatcherInspectionFailure,
) {
  if (wasFailureLogged(result)) return;

  if (
    result.status === 404 && result.code === "RIOT_ACCOUNT_NOT_FOUND"
  ) {
    dependencies.logger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      operation,
      status: result.status,
      reason: "riot_account_not_found",
    });
    return;
  }

  dependencies.logger.warn("match_tracking.watcher_inspection_failed", {
    guildId: watcher.guildId,
    targetDiscordId: watcher.targetDiscordId,
    operation,
    ...(result.status === undefined ? {} : { status: result.status }),
    reason: result.status === 502 && result.code === "RIOT_API_UNAVAILABLE"
      ? "upstream_failure"
      : "unclassified_failure",
  });
}

async function tryFetchAndNotifyResult(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
  pending: PendingResult,
  currentState: WatcherState = currentStateFromWatcher(watcher),
) {
  const result = await inspectResultForWatcher(
    dependencies,
    context,
    watcher,
    pending,
  );
  if (!result.success) {
    logWatcherInspectionFailure(dependencies, watcher, "result", result);
    return { status: "pending" as const, messageId: pending.messageId };
  }
  const {
    account,
    match,
    rankSummary,
    opggDetail,
    notificationIntent,
    stateTransition,
  } = result;
  if (notificationIntent?.kind === "timeout") {
    dependencies.logger.warn("match_tracking.fetch_result_timeout", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: pending.matchId,
    });
    const messageId = await notify(
      dependencies,
      watcher,
      pending.messageId,
      dependencies.renderer.resultFetchTimeout(
        watcher,
        notificationIntent.matchId,
      ),
      `timeout:${pending.matchId}`,
    );
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      ...resultTransitionStateForCurrentState(
        currentState,
        stateTransition
          ?.state ?? {
          pendingResultMatchId: null,
          pendingResultNotificationMessageId: null,
          pendingResultStartedAt: null,
        },
      ),
      currentMatchId: null,
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "cleared" as const, messageId };
  }
  if (!match || (notificationIntent && notificationIntent.kind !== "result")) {
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      ...resultTransitionStateForCurrentState(
        currentState,
        stateTransition
          ?.state ?? {
          pendingResultMatchId: pending.matchId,
          pendingResultNotificationMessageId: pending.messageId,
          pendingResultStartedAt: pending.startedAt,
          currentMatchId: null,
        },
      ),
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "pending" as const, messageId: pending.messageId };
  }

  const messageId = await notify(
    dependencies,
    watcher,
    pending.messageId,
    await dependencies.renderer.matchResult(
      watcher,
      account,
      match,
      rankSummary,
      opggDetail,
    ),
    `result:${pending.matchId}`,
  );
  await setWatcherState(dependencies, watcher, {
    ...currentState,
    ...resultTransitionStateForCurrentState(
      currentState,
      stateTransition
        ?.state ?? {
        currentMatchId: null,
        pendingResultMatchId: null,
        pendingResultNotificationMessageId: null,
        pendingResultStartedAt: null,
      },
    ),
    lastCheckedAt: dependencies.clock.now(),
  });
  return { status: "cleared" as const, messageId };
}

async function processWatcher(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
) {
  const pending = pendingResultFromWatcher(watcher);
  let pendingStatus: "none" | "pending" | "cleared" = "none";
  if (pending) {
    const result = await tryFetchAndNotifyResult(
      dependencies,
      watcher,
      context,
      pending,
    );
    pendingStatus = result.status;
    if (
      watcher.lastState === "FETCHING_RESULT" && watcher.currentMatchId
    ) {
      return;
    }
  }

  const activeGameResult = await inspectActiveGameForWatcher(
    dependencies,
    context,
    watcher,
  );
  if (!activeGameResult.success) {
    logWatcherInspectionFailure(
      dependencies,
      watcher,
      "active_game",
      activeGameResult,
    );
    return;
  }
  const account = activeGameResult.account;

  const activeGame = activeGameResult.activeGame;
  if (!activeGame) {
    if (watcher.lastState === "IN_GAME" && watcher.currentGameId) {
      const activeNotificationGroup = getActiveNotificationGroup(
        context,
        watcher,
        account,
        watcher.currentGameId,
      );
      const resultPendingIntent = activeGameResult.notificationIntent?.kind ===
          "resultPending"
        ? activeGameResult.notificationIntent
        : {
          kind: "resultPending" as const,
          matchId: matchIdForGame(
            account,
            watcher.currentGameId,
          ),
        };
      const matchId = resultPendingIntent.matchId;
      const messageId = await notify(
        dependencies,
        watcher,
        resultNotificationMessageId(activeNotificationGroup, watcher),
        dependencies.renderer.resultPending(watcher, matchId),
        `pending:${matchId}`,
      );
      await tryFetchAndNotifyResult(
        dependencies,
        watcher,
        context,
        {
          matchId,
          messageId,
          startedAt: watcher.gameStartedAt,
        },
        {
          lastState: "IDLE",
          currentGameId: null,
          currentMatchId: null,
          currentNotificationMessageId: null,
          gameStartedAt: null,
          lastInGameNotifiedAt: null,
        },
      );
      return;
    }

    if (watcher.lastState === "IDLE" && watcher.currentGameId === null) {
      return;
    }

    await setWatcherState(dependencies, watcher, {
      lastState: "IDLE",
      currentGameId: null,
      currentNotificationMessageId: null,
      lastCheckedAt: dependencies.clock.now(),
    });
    return;
  }

  const currentGameId = String(activeGame.gameId);
  const activeNotificationGroup = getActiveNotificationGroup(
    context,
    watcher,
    account,
    currentGameId,
  );
  if (
    watcher.lastState === "IN_GAME" &&
    watcher.currentGameId &&
    watcher.currentGameId !== currentGameId
  ) {
    if (pendingStatus === "pending") {
      dependencies.logger.warn("match_tracking.pending_result_replaced", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        pendingMatchId: pending?.matchId,
      });
    }
    const previousMatchId = matchIdForGame(account, watcher.currentGameId);
    const previousActiveNotificationGroup = getActiveNotificationGroup(
      context,
      watcher,
      account,
      watcher.currentGameId,
    );
    const notifiedAt = dependencies.clock.now();
    const previousMessageId = await notify(
      dependencies,
      watcher,
      resultNotificationMessageId(previousActiveNotificationGroup, watcher),
      dependencies.renderer.resultPending(watcher, previousMatchId),
      `pending:${previousMatchId}`,
    );
    const newMessageId = await notify(
      dependencies,
      watcher,
      activeNotificationGroup.messageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          context,
          activeGame,
          activeNotificationGroup.targetAccountPuuids,
        ),
      ),
      `started:${account.platform}:${currentGameId}`,
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      newMessageId,
      newMessageId ? notifiedAt : undefined,
    );
    const currentState = {
      lastState: "IN_GAME" as const,
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: newMessageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastInGameNotifiedAt: newMessageId ? notifiedAt : null,
    };
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      pendingResultMatchId: previousMatchId,
      pendingResultNotificationMessageId: previousMessageId,
      pendingResultStartedAt: watcher.gameStartedAt,
      lastCheckedAt: dependencies.clock.now(),
    });
    await tryFetchAndNotifyResult(
      dependencies,
      watcher,
      context,
      {
        matchId: previousMatchId,
        messageId: previousMessageId,
        startedAt: watcher.gameStartedAt,
      },
      currentState,
    );
    return;
  }

  const started = watcher.lastState !== "IN_GAME" ||
    watcher.currentGameId !== currentGameId;
  if (started) {
    const notifiedAt = dependencies.clock.now();
    const messageId = await notify(
      dependencies,
      watcher,
      activeNotificationGroup.messageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          context,
          activeGame,
          activeNotificationGroup.targetAccountPuuids,
        ),
      ),
      `started:${account.platform}:${currentGameId}`,
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      messageId ? notifiedAt : undefined,
    );
    await setWatcherState(dependencies, watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: messageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastCheckedAt: dependencies.clock.now(),
      ...(messageId ? { lastInGameNotifiedAt: notifiedAt } : {}),
    });
    return;
  }

  if (
    shouldNotifyActiveNotificationGroup(
      dependencies,
      activeNotificationGroup,
      watcher,
    )
  ) {
    const notifiedAt = dependencies.clock.now();
    const messageId = await notify(
      dependencies,
      watcher,
      activeNotificationGroup.messageId ?? watcher.currentNotificationMessageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "progress",
        await activeGameTargetDetails(
          context,
          activeGame,
          activeNotificationGroup.targetAccountPuuids,
        ),
      ),
      `progress:${account.platform}:${currentGameId}:${
        watcher.lastInGameNotifiedAt?.getTime() ?? 0
      }`,
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      messageId ? notifiedAt : undefined,
    );
    await setWatcherState(dependencies, watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentNotificationMessageId: messageId,
      lastCheckedAt: dependencies.clock.now(),
      ...(messageId ? { lastInGameNotifiedAt: notifiedAt } : {}),
    });
    return;
  }

  const didSyncSharedMessageId = await syncActiveNotificationWatcherState(
    dependencies,
    activeNotificationGroup,
    watcher,
    currentGameId,
    activeNotificationGroup.messageId,
  );
  if (didSyncSharedMessageId) {
    return;
  }

  await setWatcherState(dependencies, watcher, {
    lastState: "IN_GAME",
    currentGameId,
    lastCheckedAt: dependencies.clock.now(),
  });
}

export function createMatchTrackingService(
  dependencies: MatchTrackingServiceDependencies,
) {
  const budgetMonitor = createRiotRequestBudgetMonitor({
    config: () => dependencies.config,
    clock: dependencies.clock,
    logger: dependencies.logger,
  });

  async function processMatchWatchers() {
    const result = await dependencies.apiClient.getEnabledMatchWatchers();
    if (!result.success && !wasFailureLogged(result)) {
      dependencies.logger.error("match_tracking.watchers_fetch_failed");
    }
    if (!result.success) return;

    budgetMonitor.warnIfRiotRequestBudgetRisk(result.watchers.length);

    const context = createMatchWatcherProcessingContext();
    await seedMatchWatcherProcessingContext(
      dependencies,
      context,
      result.watchers,
    );
    for (const watcher of result.watchers) {
      try {
        await processWatcher(dependencies, watcher, context);
      } catch (error) {
        dependencies.logger.error("match_tracking.watcher_failed", {
          guildId: watcher.guildId,
          targetDiscordId: watcher.targetDiscordId,
        }, error);
      }
    }
  }

  return {
    processMatchWatchers,
    hasResultFetchTimedOut: (watcher: MatchWatcher) =>
      hasResultFetchTimedOut(
        watcher,
        dependencies.config.resultFetchTimeoutMs,
        dependencies.clock.now(),
      ),
    shouldNotifyInGame: (watcher: MatchWatcher) =>
      shouldNotifyInGame(
        watcher,
        dependencies.config.inGameNotifyIntervalMs,
        dependencies.clock.now(),
      ),
    warnIfRiotRequestBudgetRisk: budgetMonitor.warnIfRiotRequestBudgetRisk,
  };
}
