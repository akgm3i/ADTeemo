import {
  rankedQueueTypeByQueueId,
  rankSnapshotPayloadsFromEntries,
} from "@adteemo/api/contract";
import type {
  MatchGameObservation,
  MatchWatcher,
  RiotAccount,
} from "@adteemo/api/contract";
import type { ApiClient } from "../api_client.ts";
import { wasFailureLogged } from "../api_clients/transport.ts";
import {
  type ActiveNotificationGroup,
  activeNotificationGroupKey,
  activeNotificationGroupLastInGameNotifiedAt,
  currentMatchIdFromWatcher,
  type CurrentMatchState,
  currentStateFromWatcher,
  decideActiveGame,
  decideResult,
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  isAfterDate,
  matchIdForGame,
  newerDate,
  pendingMatchState,
  type PendingResult,
  pendingResultFromWatcher,
  type ResultDecision,
  selectResultNotificationMessageId,
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
  activeGameInspectionsByAccount: Map<
    string,
    Promise<ActiveGameInspectionResult>
  >;
  pendingRankSnapshots: Map<string, Promise<void>>;
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
  warn: (
    message: string,
    metadata?: Record<string, unknown>,
    error?: unknown,
  ) => void;
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
  | "getLeagueEntriesByPuuid"
  | "upsertPendingRankSnapshots"
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
    activeGameInspectionsByAccount: new Map(),
    resultInspectionsByTargetAndMatchId: new Map(),
    pendingRankSnapshots: new Map(),
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
      currentMatchIdFromWatcher(watcher, accountResult.account)!,
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

  const key = activeNotificationGroupKey(watcher, pending.matchId);
  const existingGroup = activeNotificationGroups.get(key);
  if (existingGroup) {
    existingGroup.resultMessageIdsInUse.add(pending.messageId);
    return;
  }

  activeNotificationGroups.set(key, {
    messageId: null,
    targetAccountPuuids: new Set(),
    activeWatchers: new Map(),
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
  matchId: string,
) {
  const isCurrent = currentMatchIdFromWatcher(watcher, account) === matchId;
  const key = activeNotificationGroupKey(watcher, matchId);
  const existing = context.activeNotificationGroups.get(key);
  if (existing) {
    existing.targetAccountPuuids.add(watcher.riotAccountPuuid);
    if (
      !existing.messageId && isCurrent &&
      watcher.currentNotificationMessageId
    ) {
      existing.messageId = watcher.currentNotificationMessageId;
    }
    if (isCurrent) {
      rememberActiveNotificationWatcher(existing, watcher);
      rememberActiveNotificationMessage(existing, watcher);
    }
    return existing;
  }

  const group: ActiveNotificationGroup = {
    messageId: isCurrent ? watcher.currentNotificationMessageId : null,
    targetAccountPuuids: new Set([watcher.riotAccountPuuid]),
    activeWatchers: new Map(),
    resultMessageIdsInUse: new Set(),
  };
  if (isCurrent) {
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
  matchId: string,
  messageId: string | null,
  notifiedAt?: Date,
) {
  if (!messageId) return;
  group.messageId = messageId;
  rememberActiveNotificationWatcher(group, {
    ...currentWatcher,
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentMatchId: matchId,
    currentNotificationMessageId: messageId,
    lastInGameNotifiedAt: notifiedAt &&
        isAfterDate(notifiedAt, currentWatcher.lastInGameNotifiedAt)
      ? notifiedAt
      : currentWatcher.lastInGameNotifiedAt,
  });
  rememberActiveNotificationMessage(group, currentWatcher, messageId);

  for (const watcher of group.activeWatchers.values()) {
    if (watcher.riotAccountPuuid === currentWatcher.riotAccountPuuid) continue;
    await syncActiveNotificationWatcherState(
      dependencies,
      group,
      watcher,
      gameId,
      matchId,
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
  matchId: string,
  messageId: string | null,
  notifiedAt?: Date,
  gameMode?: string,
  observation?: MatchGameObservation | null,
) {
  if (!messageId) return false;

  const shouldSyncMessageId = watcher.currentNotificationMessageId !==
    messageId;
  const shouldSyncNotifiedAt = notifiedAt &&
    isAfterDate(notifiedAt, watcher.lastInGameNotifiedAt);
  const shouldSyncMode = gameMode !== undefined &&
    watcher.currentGameMode !== gameMode;
  const shouldSyncObservation = observation !== undefined &&
    (watcher.currentGameObservation?.championId !== observation?.championId ||
      watcher.currentGameObservation?.elapsedSeconds !==
        observation?.elapsedSeconds);
  if (
    !shouldSyncMessageId && !shouldSyncNotifiedAt && !shouldSyncMode &&
    !shouldSyncObservation
  ) {
    return false;
  }

  await setWatcherState(dependencies, watcher, {
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentMatchId: matchId,
    ...(shouldSyncMode ? { currentGameMode: gameMode } : {}),
    ...(shouldSyncObservation ? { currentGameObservation: observation } : {}),
    currentNotificationMessageId: messageId,
    lastCheckedAt: dependencies.clock.now(),
    ...(shouldSyncNotifiedAt ? { lastInGameNotifiedAt: notifiedAt } : {}),
  });
  rememberActiveNotificationWatcher(group, {
    ...watcher,
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentMatchId: matchId,
    ...(shouldSyncMode ? { currentGameMode: gameMode } : {}),
    ...(shouldSyncObservation ? { currentGameObservation: observation } : {}),
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
  };
  // HTTP access remains scoped to the account owner; API batch caching shares
  // only Riot source data across guilds, never Bot notification decisions.
  const cacheKey = JSON.stringify([
    watcher.guildId,
    watcher.targetDiscordId,
    input,
  ]);
  let promise = context.activeGameInspectionsByAccount.get(cacheKey);
  if (!promise) {
    promise = dependencies.apiClient.inspectMatchWatcherActiveGame(
      watcher.guildId,
      watcher.targetDiscordId,
      input,
    );
    context.activeGameInspectionsByAccount.set(cacheKey, promise);
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
) {
  return JSON.stringify({
    guildId: watcher.guildId,
    targetDiscordId: watcher.targetDiscordId,
    riotAccountPuuid: watcher.riotAccountPuuid,
    matchId: pending.matchId,
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
      : result.status === 502 && result.code === "RIOT_MATCH_ACCESS_DENIED"
      ? "match_access_denied"
      : "unclassified_failure",
  });
}

async function tryFetchAndNotifyResult(
  dependencies: MatchTrackingServiceDependencies,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
  pending: PendingResult,
  currentState: CurrentMatchState = currentStateFromWatcher(watcher),
  notifyPending = false,
) {
  const decisionInput = {
    pending,
    now: dependencies.clock.now(),
    resultFetchTimeoutMs: dependencies.config.resultFetchTimeoutMs,
  };
  const preflight = decideResult(decisionInput);
  let decision: ResultDecision | { kind: "timeout" };
  if (preflight.kind === "inspect") {
    const inspection = await inspectResultForWatcher(
      dependencies,
      context,
      watcher,
      pending,
    );
    decision = decideResult({ ...decisionInput, inspection });
    if (!inspection.success) {
      logWatcherInspectionFailure(dependencies, watcher, "result", inspection);
    }
  } else {
    decision = preflight;
  }
  if (decision.kind === "timeout" || decision.kind === "unavailable") {
    const accessDenied = decision.kind === "unavailable";
    if (!accessDenied) {
      dependencies.logger.warn("match_tracking.fetch_result_timeout", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        matchId: pending.matchId,
      });
    }
    const messageId = await notify(
      dependencies,
      watcher,
      pending.messageId,
      await dependencies.renderer.resultUnavailable(
        watcher,
        pending.matchId,
        pending.gameMode === "KIWI"
          ? "mayhem"
          : accessDenied
          ? "access_denied"
          : "timeout",
        pending.observation,
      ),
      `${accessDenied ? "unavailable" : "timeout"}:${pending.matchId}`,
    );
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      ...pendingMatchState(null),
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "cleared" as const, messageId };
  }
  if (decision.kind === "pending") {
    if (decision.failed && !notifyPending) {
      return { status: "pending" as const, messageId: pending.messageId };
    }
    // Inspect before editing so a ready result never races a pending embed.
    const messageId = notifyPending
      ? await notify(
        dependencies,
        watcher,
        pending.messageId,
        dependencies.renderer.resultPending(watcher, pending.matchId),
        `pending:${pending.matchId}`,
      )
      : pending.messageId;
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      ...pendingMatchState(pending, messageId),
      lastCheckedAt: dependencies.clock.now(),
    });
    return { status: "pending" as const, messageId };
  }
  const { account, match, rankSummary, opggDetail } = decision.result;
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
      pending.observation,
    ),
    `result:${pending.matchId}`,
  );
  await setWatcherState(dependencies, watcher, {
    ...currentState,
    ...pendingMatchState(null),
    lastCheckedAt: dependencies.clock.now(),
  });
  return { status: "cleared" as const, messageId };
}

async function capturePendingRankSnapshots(
  dependencies: MatchTrackingServiceDependencies,
  context: MatchWatcherProcessingContext,
  watcher: MatchWatcher,
  account: RiotAccount,
  game: ActiveGame,
) {
  if (!rankedQueueTypeByQueueId(game.gameQueueConfigId)) return;
  const key = `${matchIdForGame(account, game.gameId)}:${account.puuid}`;
  let task = context.pendingRankSnapshots.get(key);
  if (!task) {
    task = (async () => {
      try {
        const entries = await dependencies.apiClient.getLeagueEntriesByPuuid(
          account.platform,
          account.puuid,
        );
        const result = await dependencies.apiClient.upsertPendingRankSnapshots({
          platform: account.platform,
          gameId: String(game.gameId),
          puuid: account.puuid,
          snapshots: rankSnapshotPayloadsFromEntries(
            entries,
            dependencies.clock.now(),
          ),
        });
        if (!result.success) {
          throw new Error("Pending rank snapshot persistence failed", {
            cause: result,
          });
        }
      } catch (error) {
        dependencies.logger.warn(
          "match_tracking.rank_snapshot_pending_save_failed",
          {
            guildId: watcher.guildId,
            targetDiscordId: watcher.targetDiscordId,
          },
          error,
        );
      }
    })();
    context.pendingRankSnapshots.set(key, task);
  }
  await task;
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
  const { account, activeGame } = activeGameResult;
  const observedGroup = activeGame
    ? getActiveNotificationGroup(
      context,
      watcher,
      account,
      matchIdForGame(account, activeGame.gameId),
    )
    : null;
  const decision = decideActiveGame({
    watcher,
    account,
    activeGame,
    notificationLastInGameNotifiedAt: observedGroup
      ? activeNotificationGroupLastInGameNotifiedAt(observedGroup)
      : null,
    inGameNotifyIntervalMs: dependencies.config.inGameNotifyIntervalMs,
    now: dependencies.clock.now(),
  });
  if (decision.kind === "idle") {
    if (decision.current) {
      await setWatcherState(dependencies, watcher, {
        ...decision.current,
        lastCheckedAt: dependencies.clock.now(),
      });
    }
    return;
  }
  if (decision.kind === "ended") {
    const previousGroup = getActiveNotificationGroup(
      context,
      watcher,
      account,
      decision.previous.matchId,
    );
    await tryFetchAndNotifyResult(
      dependencies,
      watcher,
      context,
      {
        ...decision.previous,
        messageId: resultNotificationMessageId(previousGroup, watcher),
      },
      decision.current,
      true,
    );
    return;
  }
  const current = decision.current;
  const game = decision.game;
  const activeGroup = getActiveNotificationGroup(
    context,
    watcher,
    account,
    current.currentMatchId,
  );
  const gameId = current.currentGameId;
  if (decision.kind === "started") {
    const previous = decision.previous
      ? {
        ...decision.previous,
        messageId: resultNotificationMessageId(
          getActiveNotificationGroup(
            context,
            watcher,
            account,
            decision.previous.matchId,
          ),
          watcher,
        ),
      }
      : null;
    if (previous && pendingStatus === "pending") {
      dependencies.logger.warn("match_tracking.pending_result_replaced", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        pendingMatchId: pending?.matchId,
      });
    }
    await capturePendingRankSnapshots(
      dependencies,
      context,
      watcher,
      account,
      game,
    );
    const notifiedAt = dependencies.clock.now();
    const messageId = await notify(
      dependencies,
      watcher,
      activeGroup.messageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        game,
        "started",
        await activeGameTargetDetails(
          context,
          game,
          activeGroup.targetAccountPuuids,
        ),
      ),
      `started:${account.platform}:${gameId}`,
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeGroup,
      watcher,
      gameId,
      current.currentMatchId,
      messageId,
      messageId ? notifiedAt : undefined,
    );
    const currentState: CurrentMatchState = {
      ...current,
      currentNotificationMessageId: messageId,
      lastInGameNotifiedAt: messageId ? notifiedAt : null,
    };
    await setWatcherState(dependencies, watcher, {
      ...currentState,
      ...(previous ? pendingMatchState(previous) : {}),
      lastCheckedAt: dependencies.clock.now(),
    });
    if (previous) {
      await tryFetchAndNotifyResult(
        dependencies,
        watcher,
        context,
        previous,
        currentState,
        true,
      );
    }
    return;
  }
  if (decision.kind === "progress") {
    const notifiedAt = dependencies.clock.now();
    const messageId = await notify(
      dependencies,
      watcher,
      activeGroup.messageId ?? watcher.currentNotificationMessageId,
      await dependencies.renderer.activeGame(
        watcher,
        account,
        game,
        "progress",
        await activeGameTargetDetails(
          context,
          game,
          activeGroup.targetAccountPuuids,
        ),
      ),
      `progress:${account.platform}:${gameId}:${
        watcher.lastInGameNotifiedAt?.getTime() ?? 0
      }`,
    );
    await updateActiveNotificationGroupMessage(
      dependencies,
      activeGroup,
      watcher,
      gameId,
      current.currentMatchId,
      messageId,
      messageId ? notifiedAt : undefined,
    );
    await setWatcherState(dependencies, watcher, {
      lastState: "IN_GAME",
      currentGameId: gameId,
      currentMatchId: current.currentMatchId,
      currentGameMode: current.currentGameMode,
      currentGameObservation: current.currentGameObservation,
      currentNotificationMessageId: messageId,
      lastCheckedAt: dependencies.clock.now(),
      ...(messageId ? { lastInGameNotifiedAt: notifiedAt } : {}),
    });
    return;
  }
  const synced = await syncActiveNotificationWatcherState(
    dependencies,
    activeGroup,
    watcher,
    gameId,
    current.currentMatchId,
    activeGroup.messageId,
    undefined,
    game.gameMode,
    current.currentGameObservation,
  );
  if (synced) return;
  await setWatcherState(dependencies, watcher, {
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentMatchId: current.currentMatchId,
    currentGameMode: current.currentGameMode,
    currentGameObservation: current.currentGameObservation,
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
