import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import type { ApiClient } from "../api_client.ts";
import {
  type ActiveNotificationGroup,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  isAfterDate,
  isResultFetchTimedOut as isResultFetchTimedOutWithConfig,
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
type WatcherState = Parameters<ApiClient["updateMatchWatcherState"]>[2];
type MatchTrackingRenderer = ReturnType<typeof createMatchTrackingRenderer>;
type MatchTrackingEmbed = ReturnType<MatchTrackingRenderer["resultPending"]>;
type MatchTrackingNotifier = {
  sendOrEditWatcherMessage: (
    watcher: MatchWatcher,
    messageId: string | null | undefined,
    embed: MatchTrackingEmbed,
  ) => Promise<string | null>;
};
type MatchWatcherProcessingContext = {
  activeNotificationGroups: Map<string, ActiveNotificationGroup>;
  riotAccountsByTargetDiscordId: Map<string, Promise<RiotAccountResult>>;
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
    activeNotificationGroups: new Map(),
    riotAccountsByTargetDiscordId: new Map(),
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
      watcher.targetDiscordId,
    );
    if (!accountResult.success) continue;

    const key = activeNotificationGroupKey(
      watcher,
      accountResult.account.platform,
      watcher.currentGameId,
    );
    const existingGroup = context.activeNotificationGroups.get(key);
    if (existingGroup) {
      existingGroup.targetDiscordIds.add(watcher.targetDiscordId);
      rememberActiveNotificationWatcher(existingGroup, watcher);
      rememberActiveNotificationMessage(existingGroup, watcher);
      continue;
    }

    const group: ActiveNotificationGroup = {
      messageId: watcher.currentNotificationMessageId,
      targetDiscordIds: new Set([watcher.targetDiscordId]),
      activeWatchers: new Map([[watcher.targetDiscordId, watcher]]),
      messageIdTargetDiscordIds: new Map(),
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
    targetDiscordIds: new Set(),
    activeWatchers: new Map(),
    messageIdTargetDiscordIds: new Map(),
    resultMessageIdsInUse: new Set([pending.messageId]),
  });
}

function rememberActiveNotificationWatcher(
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
) {
  const existing = group.activeWatchers.get(watcher.targetDiscordId);
  if (!existing) {
    group.activeWatchers.set(watcher.targetDiscordId, watcher);
    return;
  }

  const shouldKeepSyncedGroupMessageId = group.messageId !== null &&
    existing.currentNotificationMessageId === group.messageId &&
    watcher.currentNotificationMessageId !== group.messageId;
  const currentNotificationMessageId = shouldKeepSyncedGroupMessageId
    ? existing.currentNotificationMessageId
    : watcher.currentNotificationMessageId ??
      existing.currentNotificationMessageId;

  group.activeWatchers.set(watcher.targetDiscordId, {
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
  const targetDiscordIds = group.messageIdTargetDiscordIds.get(messageId) ??
    new Set<string>();
  targetDiscordIds.add(watcher.targetDiscordId);
  group.messageIdTargetDiscordIds.set(messageId, targetDiscordIds);
}

function resultNotificationMessageId(
  group: ActiveNotificationGroup | undefined,
  watcher: MatchWatcher,
) {
  if (!group) return watcher.currentNotificationMessageId ?? null;

  const activeWatcher = group.activeWatchers.get(watcher.targetDiscordId);
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
    existing.targetDiscordIds.add(watcher.targetDiscordId);
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
    targetDiscordIds: new Set([watcher.targetDiscordId]),
    activeWatchers: new Map(),
    messageIdTargetDiscordIds: new Map(),
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
    if (watcher.targetDiscordId === currentWatcher.targetDiscordId) continue;
    await syncActiveNotificationWatcherState(
      dependencies,
      group,
      watcher,
      gameId,
      messageId,
      notifiedAt,
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
  targetDiscordId: string,
) {
  const cached = context.riotAccountsByTargetDiscordId.get(targetDiscordId);
  if (cached) return cached;

  const result = dependencies.apiClient.getRiotAccount(targetDiscordId);
  context.riotAccountsByTargetDiscordId.set(targetDiscordId, result);
  return result;
}

function rememberRiotAccountForWatcher(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
) {
  context.riotAccountsByTargetDiscordId.set(
    account.discordId,
    Promise.resolve({ success: true as const, account }),
  );
}

async function inspectActiveGameForWatcher(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
) {
  const cacheKey = [
    watcher.targetDiscordId,
    watcher.lastState,
    watcher.currentGameId ?? "",
  ].join(":");
  let promise = context.activeGameInspectionsByTargetAndState.get(cacheKey);
  if (!promise) {
    promise = dependencies.apiClient.inspectMatchWatcherActiveGame(
      watcher.guildId,
      watcher.targetDiscordId,
      {
        lastState: watcher.lastState,
        currentGameId: watcher.currentGameId,
      },
    );
    context.activeGameInspectionsByTargetAndState.set(cacheKey, promise);
  }

  const result = await promise;
  if (result.success) {
    rememberRiotAccountForWatcher(context, result.account);
  }
  return result;
}

async function inspectResultForWatcher(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
  matchId: string,
) {
  const cacheKey = `${watcher.targetDiscordId}:${matchId}`;
  let promise = context.resultInspectionsByTargetAndMatchId.get(cacheKey);
  if (!promise) {
    promise = dependencies.apiClient.inspectMatchWatcherResult(
      watcher.guildId,
      watcher.targetDiscordId,
      { matchId },
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

function isResultFetchTimedOut(
  dependencies: MatchTrackingServiceDependencies,
  startedAt: Date,
) {
  return isResultFetchTimedOutWithConfig(
    startedAt,
    dependencies.config.resultFetchTimeoutMs,
    dependencies.clock.now(),
  );
}

async function activeGameTargetDetails(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  currentWatcher: MatchWatcher,
  currentAccount: RiotAccount,
  activeGame: ActiveGame,
  targetDiscordIds: Iterable<string>,
): Promise<ActiveGameTargetDetail[]> {
  const details: ActiveGameTargetDetail[] = [];
  for (const targetDiscordId of targetDiscordIds) {
    const accountResult = targetDiscordId === currentWatcher.targetDiscordId
      ? { success: true as const, account: currentAccount }
      : await getRiotAccountForWatcher(
        dependencies,
        context,
        targetDiscordId,
      );
    if (!accountResult.success) {
      details.push({
        targetDiscordId,
      });
      continue;
    }

    const participant = activeGame.participants.find((p) =>
      p.puuid === accountResult.account.puuid
    );
    details.push({
      targetDiscordId,
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
    state,
  );
  if (!result.success) {
    dependencies.logger.error("match_tracking.state_update_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: result.error,
    });
  }
}

async function tryFetchAndNotifyResult(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
  pending: PendingResult,
  currentState: WatcherState = currentStateFromWatcher(watcher),
) {
  if (
    pending.startedAt && isResultFetchTimedOut(dependencies, pending.startedAt)
  ) {
    dependencies.logger.warn("match_tracking.fetch_result_timeout", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: pending.matchId,
    });
    const messageId = await dependencies.notifier.sendOrEditWatcherMessage(
      watcher,
      pending.messageId,
      dependencies.renderer.resultFetchTimeout(watcher, pending.matchId),
    );
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      pendingResultMatchId: null,
      pendingResultNotificationMessageId: null,
      pendingResultStartedAt: null,
      currentMatchId: null,
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "cleared" as const, messageId };
  }

  const result = await inspectResultForWatcher(
    dependencies,
    context,
    watcher,
    pending.matchId,
  );
  if (!result.success) {
    dependencies.logger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: result.error,
    });
    return { status: "pending" as const, messageId: pending.messageId };
  }
  const { account, match, rankSummary, opggDetail } = result;
  if (!match) {
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      pendingResultMatchId: pending.matchId,
      pendingResultNotificationMessageId: pending.messageId,
      pendingResultStartedAt: pending.startedAt,
      currentMatchId: null,
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "pending" as const, messageId: pending.messageId };
  }

  const messageId = await dependencies.notifier.sendOrEditWatcherMessage(
    watcher,
    pending.messageId,
    await dependencies.renderer.matchResult(
      watcher,
      account,
      match,
      rankSummary,
      opggDetail,
    ),
  );
  await setWatcherState(dependencies, watcher, {
    ...currentState,
    currentMatchId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
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
    dependencies.logger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: activeGameResult.error,
    });
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
      const matchId = matchIdForGame(account, watcher.currentGameId);
      const messageId = await dependencies.notifier.sendOrEditWatcherMessage(
        watcher,
        resultNotificationMessageId(activeNotificationGroup, watcher),
        dependencies.renderer.resultPending(watcher, matchId),
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
    const previousMessageId = await dependencies.notifier
      .sendOrEditWatcherMessage(
        watcher,
        resultNotificationMessageId(previousActiveNotificationGroup, watcher),
        dependencies.renderer.resultPending(watcher, previousMatchId),
      );
    const newMessageId = await dependencies.notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          dependencies,
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      newMessageId,
      notifiedAt,
    );
    const currentState = {
      lastState: "IN_GAME" as const,
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: newMessageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastInGameNotifiedAt: notifiedAt,
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
    const messageId = await dependencies.notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          dependencies,
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      notifiedAt,
    );
    await setWatcherState(dependencies, watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: messageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastCheckedAt: dependencies.clock.now(),
      lastInGameNotifiedAt: notifiedAt,
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
    const messageId = await dependencies.notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId ?? watcher.currentNotificationMessageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        activeGame,
        "progress",
        await activeGameTargetDetails(
          dependencies,
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      notifiedAt,
    );
    await setWatcherState(dependencies, watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentNotificationMessageId: messageId,
      lastCheckedAt: dependencies.clock.now(),
      lastInGameNotifiedAt: notifiedAt,
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
    if (!result.success) {
      dependencies.logger.error("match_tracking.watchers_fetch_failed", {
        error: result.error,
      });
      return;
    }

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
