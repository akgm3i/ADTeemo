import type { Client } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import {
  activeGameCacheKey,
  type ActiveNotificationGroup,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  isAfterDate,
  isResultFetchTimedOut as isResultFetchTimedOutWithConfig,
  matchCacheKey,
  matchIdForGame,
  matchIdParts,
  newerDate,
  type PendingResult,
  pendingResultFromWatcher,
  rankedQueueTypeByQueueId,
  rankSnapshotPayloadsFromEntries,
  type RankSummary,
  selectResultNotificationMessageId,
  shouldNotifyActiveNotificationGroup
    as shouldNotifyActiveNotificationGroupWithConfig,
  shouldNotifyInGame as shouldNotifyInGameWithConfig,
} from "./match_tracking_state.ts";
import {
  createMatchTrackingNotifier,
  type WatcherChannel,
} from "./match_tracking_notifier.ts";
import { createMatchTrackingRenderer } from "./match_tracking_renderer.ts";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS = 300_000;
const DEFAULT_RESULT_FETCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DEFAULT_RIOT_LONG_WINDOW_LIMIT = 100;
const DEFAULT_RIOT_LONG_WINDOW_MS = 2 * 60 * 1000;

type ActiveGame = NonNullable<
  Awaited<ReturnType<typeof apiClient.getActiveGameByPuuid>>
>;
type ActiveGameResult = Awaited<
  ReturnType<typeof apiClient.getActiveGameByPuuid>
>;
type RiotAccountResult = Awaited<ReturnType<typeof apiClient.getRiotAccount>>;
type RiotMatch = NonNullable<
  Awaited<ReturnType<typeof apiClient.getMatchById>>
>;
type WatcherState = Parameters<typeof apiClient.updateMatchWatcherState>[2];
type MatchTrackingRenderer = ReturnType<typeof createMatchTrackingRenderer>;
type MatchTrackingNotifier = ReturnType<typeof createMatchTrackingNotifier>;
type MatchWatcherProcessingContext = {
  activeNotificationGroups: Map<string, ActiveNotificationGroup>;
  riotAccountsByTargetDiscordId: Map<string, Promise<RiotAccountResult>>;
  activeGamesByRiotAccount: Map<string, Promise<ActiveGameResult>>;
  matchesByRegionAndMatchId: Map<string, Promise<RiotMatch | null>>;
};
type ActiveGameTargetDetail = {
  targetDiscordId: string;
  championId?: number;
};
type RiotStaticDataResult = Awaited<
  ReturnType<typeof apiClient.resolveRiotStaticData>
>;
type ResolvedRiotStaticData = Extract<
  RiotStaticDataResult,
  { success: true }
>["data"];
function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function messageLocale() {
  return (Deno.env.get("BOT_MESSAGE_LANG") ?? Deno.env.get("LC_MESSAGES") ??
    Deno.env.get("LC_ALL") ?? "ja_JP").replace("-", "_").split(".")[0];
}

function createMatchWatcherProcessingContext(): MatchWatcherProcessingContext {
  return {
    activeNotificationGroups: new Map(),
    riotAccountsByTargetDiscordId: new Map(),
    activeGamesByRiotAccount: new Map(),
    matchesByRegionAndMatchId: new Map(),
  };
}

async function seedMatchWatcherProcessingContext(
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
      group,
      watcher,
      gameId,
      messageId,
      notifiedAt,
    );
  }
}

async function syncActiveNotificationWatcherState(
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

  await setWatcherState(watcher, {
    lastState: "IN_GAME",
    currentGameId: gameId,
    currentNotificationMessageId: messageId,
    lastCheckedAt: new Date(),
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
  context: MatchWatcherProcessingContext,
  targetDiscordId: string,
) {
  const cached = context.riotAccountsByTargetDiscordId.get(targetDiscordId);
  if (cached) return cached;

  const result = apiClient.getRiotAccount(targetDiscordId);
  context.riotAccountsByTargetDiscordId.set(targetDiscordId, result);
  return result;
}

function getActiveGameForAccount(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
) {
  const cacheKey = activeGameCacheKey(account);
  const cached = context.activeGamesByRiotAccount.get(cacheKey);
  if (cached) return cached;

  const result = apiClient.getActiveGameByPuuid(
    account.platform,
    account.puuid,
  );
  context.activeGamesByRiotAccount.set(cacheKey, result);
  return result;
}

function getMatchForPendingResult(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
  matchId: string,
) {
  const cacheKey = matchCacheKey(account, matchId);
  const cached = context.matchesByRegionAndMatchId.get(cacheKey);
  if (cached) return cached;

  const result = apiClient.getMatchById(account.region, matchId);
  context.matchesByRegionAndMatchId.set(cacheKey, result);
  return result;
}

async function capturePendingRankSnapshots(
  watcher: MatchWatcher,
  account: RiotAccount,
  activeGame: ActiveGame,
) {
  if (!rankedQueueTypeByQueueId(activeGame.gameQueueConfigId)) return;

  try {
    const entries = await apiClient.getLeagueEntriesByPuuid(
      account.platform,
      account.puuid,
    );
    const result = await apiClient.upsertPendingRankSnapshots({
      platform: account.platform,
      gameId: String(activeGame.gameId),
      puuid: account.puuid,
      snapshots: rankSnapshotPayloadsFromEntries(entries, new Date()),
    });
    if (!result.success) {
      botLogger.warn("match_tracking.rank_snapshot_pending_save_failed", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        error: result.error,
      });
    }
  } catch (error) {
    botLogger.warn("match_tracking.rank_snapshot_before_fetch_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function finalizeRankSnapshotsForResult(
  watcher: MatchWatcher,
  account: RiotAccount,
  match: RiotMatch,
): Promise<RankSummary | null> {
  const queueType = rankedQueueTypeByQueueId(match.info.queueId);
  if (!queueType) return null;

  try {
    const entries = await apiClient.getLeagueEntriesByPuuid(
      account.platform,
      account.puuid,
    );
    const result = await apiClient.finalizeRankSnapshots(
      match.metadata.matchId,
      {
        platform: account.platform,
        gameId: String(match.info.gameId),
        puuid: account.puuid,
        snapshots: rankSnapshotPayloadsFromEntries(entries, new Date()),
      },
    );
    if (!result.success) {
      botLogger.warn("match_tracking.rank_snapshot_finalize_failed", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        matchId: match.metadata.matchId,
        error: result.error,
      });
      return null;
    }

    return {
      queueType,
      before: result.snapshots.before.find((snapshot) =>
        snapshot.queueType === queueType
      ) ?? null,
      after: result.snapshots.after.find((snapshot) =>
        snapshot.queueType === queueType
      ) ?? null,
    };
  } catch (error) {
    botLogger.warn("match_tracking.rank_snapshot_after_fetch_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: match.metadata.matchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function shouldNotifyInGame(
  watcher: MatchWatcher,
  intervalMs = numberEnv(
    "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
    DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS,
  ),
  now = new Date(),
) {
  return shouldNotifyInGameWithConfig(watcher, intervalMs, now);
}

function shouldNotifyActiveNotificationGroup(
  group: ActiveNotificationGroup,
  watcher: MatchWatcher,
  intervalMs = numberEnv(
    "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
    DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS,
  ),
  now = new Date(),
) {
  return shouldNotifyActiveNotificationGroupWithConfig(
    group,
    watcher,
    intervalMs,
    now,
  );
}

function hasResultFetchTimedOut(
  watcher: MatchWatcher,
  timeoutMs = numberEnv(
    "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
    DEFAULT_RESULT_FETCH_TIMEOUT_MS,
  ),
  now = new Date(),
) {
  return hasResultFetchTimedOutWithConfig(watcher, timeoutMs, now);
}

function isResultFetchTimedOut(
  startedAt: Date,
  timeoutMs = numberEnv(
    "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
    DEFAULT_RESULT_FETCH_TIMEOUT_MS,
  ),
  now = new Date(),
) {
  return isResultFetchTimedOutWithConfig(startedAt, timeoutMs, now);
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

async function activeGameTargetDetails(
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
      : await getRiotAccountForWatcher(context, targetDiscordId);
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

async function resolveOpggMatchDetailForResult(
  watcher: MatchWatcher,
  account: RiotAccount,
  match: RiotMatch,
) {
  const participant = match.info.participants.find((candidate) =>
    candidate.puuid === account.puuid
  );
  if (!participant) return null;

  const result = await apiClient.resolveOpggMatchDetail(
    match.metadata.matchId,
    {
      targetDiscordId: watcher.targetDiscordId,
      match: {
        gameCreation: match.info.gameCreation,
        gameDuration: match.info.gameDuration,
        queueId: match.info.queueId,
        participant: {
          puuid: participant.puuid,
          championId: participant.championId,
          championName: participant.championName,
        },
      },
    },
  );
  if (!result.success) {
    botLogger.warn("match_tracking.opgg_detail_resolve_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: match.metadata.matchId,
      error: result.error,
    });
    return null;
  }
  return result.detail;
}

async function setWatcherState(
  watcher: MatchWatcher,
  state: Parameters<typeof apiClient.updateMatchWatcherState>[2],
) {
  const result = await apiClient.updateMatchWatcherState(
    watcher.guildId,
    watcher.targetDiscordId,
    state,
  );
  if (!result.success) {
    botLogger.error("match_tracking.state_update_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: result.error,
    });
  }
}

async function tryFetchAndNotifyResult(
  notifier: MatchTrackingNotifier,
  renderer: MatchTrackingRenderer,
  watcher: MatchWatcher,
  account: RiotAccount,
  context: MatchWatcherProcessingContext,
  pending: PendingResult,
  currentState: WatcherState = currentStateFromWatcher(watcher),
) {
  if (pending.startedAt && isResultFetchTimedOut(pending.startedAt)) {
    botLogger.warn("match_tracking.fetch_result_timeout", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: pending.matchId,
    });
    const messageId = await notifier.sendOrEditWatcherMessage(
      watcher,
      pending.messageId,
      renderer.resultFetchTimeout(watcher, pending.matchId),
    );
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: null,
      pendingResultNotificationMessageId: null,
      pendingResultStartedAt: null,
      currentMatchId: null,
      lastCheckedAt: new Date(),
    });
    return { status: "cleared" as const, messageId };
  }

  const match = await getMatchForPendingResult(
    context,
    account,
    pending.matchId,
  );
  if (!match) {
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: pending.matchId,
      pendingResultNotificationMessageId: pending.messageId,
      pendingResultStartedAt: pending.startedAt,
      currentMatchId: null,
      lastCheckedAt: new Date(),
    });
    return { status: "pending" as const, messageId: pending.messageId };
  }

  const rankSummary = await finalizeRankSnapshotsForResult(
    watcher,
    account,
    match,
  );
  const opggDetail = await resolveOpggMatchDetailForResult(
    watcher,
    account,
    match,
  );
  const messageId = await notifier.sendOrEditWatcherMessage(
    watcher,
    pending.messageId,
    await renderer.matchResult(
      watcher,
      account,
      match,
      rankSummary,
      opggDetail,
    ),
  );
  await setWatcherState(watcher, {
    ...currentState,
    currentMatchId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    lastCheckedAt: new Date(),
  });
  return { status: "cleared" as const, messageId };
}

async function processWatcher(
  notifier: MatchTrackingNotifier,
  renderer: MatchTrackingRenderer,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
) {
  const accountResult = await getRiotAccountForWatcher(
    context,
    watcher.targetDiscordId,
  );
  if (!accountResult.success) {
    botLogger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: accountResult.error,
    });
    return;
  }
  const account = accountResult.account;

  const pending = pendingResultFromWatcher(watcher);
  let pendingStatus: "none" | "pending" | "cleared" = "none";
  if (pending) {
    const result = await tryFetchAndNotifyResult(
      notifier,
      renderer,
      watcher,
      account,
      context,
      pending,
    );
    pendingStatus = result.status;
    if (watcher.lastState === "FETCHING_RESULT" && watcher.currentMatchId) {
      return;
    }
  }

  const activeGame = await getActiveGameForAccount(context, account);
  if (!activeGame) {
    if (watcher.lastState === "IN_GAME" && watcher.currentGameId) {
      const activeNotificationGroup = getActiveNotificationGroup(
        context,
        watcher,
        account,
        watcher.currentGameId,
      );
      const matchId = matchIdForGame(account, watcher.currentGameId);
      const messageId = await notifier.sendOrEditWatcherMessage(
        watcher,
        resultNotificationMessageId(activeNotificationGroup, watcher),
        renderer.resultPending(watcher, matchId),
      );
      await tryFetchAndNotifyResult(
        notifier,
        renderer,
        watcher,
        account,
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

    await setWatcherState(watcher, {
      lastState: "IDLE",
      currentGameId: null,
      currentNotificationMessageId: null,
      lastCheckedAt: new Date(),
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
      botLogger.warn("match_tracking.pending_result_replaced", {
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
    const notifiedAt = new Date();
    const previousMessageId = await notifier.sendOrEditWatcherMessage(
      watcher,
      resultNotificationMessageId(previousActiveNotificationGroup, watcher),
      renderer.resultPending(watcher, previousMatchId),
    );
    await capturePendingRankSnapshots(watcher, account, activeGame);
    const newMessageId = await notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId,
      await renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
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
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: previousMatchId,
      pendingResultNotificationMessageId: previousMessageId,
      pendingResultStartedAt: watcher.gameStartedAt,
      lastCheckedAt: new Date(),
    });
    await tryFetchAndNotifyResult(
      notifier,
      renderer,
      watcher,
      account,
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
    const notifiedAt = new Date();
    await capturePendingRankSnapshots(watcher, account, activeGame);
    const messageId = await notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId,
      await renderer.activeGame(
        watcher,
        account,
        activeGame,
        "started",
        await activeGameTargetDetails(
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      notifiedAt,
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: messageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastCheckedAt: new Date(),
      lastInGameNotifiedAt: notifiedAt,
    });
    return;
  }

  if (shouldNotifyActiveNotificationGroup(activeNotificationGroup, watcher)) {
    const notifiedAt = new Date();
    const messageId = await notifier.sendOrEditWatcherMessage(
      watcher,
      activeNotificationGroup.messageId ?? watcher.currentNotificationMessageId,
      await renderer.activeGame(
        watcher,
        account,
        activeGame,
        "progress",
        await activeGameTargetDetails(
          context,
          watcher,
          account,
          activeGame,
          activeNotificationGroup.targetDiscordIds,
        ),
      ),
    );
    await updateActiveNotificationGroupMessage(
      activeNotificationGroup,
      watcher,
      currentGameId,
      messageId,
      notifiedAt,
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentNotificationMessageId: messageId,
      lastCheckedAt: new Date(),
      lastInGameNotifiedAt: notifiedAt,
    });
    return;
  }

  const didSyncSharedMessageId = await syncActiveNotificationWatcherState(
    activeNotificationGroup,
    watcher,
    currentGameId,
    activeNotificationGroup.messageId,
  );
  if (didSyncSharedMessageId) {
    return;
  }

  await setWatcherState(watcher, {
    lastState: "IN_GAME",
    currentGameId,
    lastCheckedAt: new Date(),
  });
}

async function processMatchWatchers(client: Client) {
  const result = await apiClient.getEnabledMatchWatchers();
  if (!result.success) {
    botLogger.error("match_tracking.watchers_fetch_failed", {
      error: result.error,
    });
    return;
  }

  warnIfRiotRequestBudgetRisk(result.watchers.length);

  const context = createMatchWatcherProcessingContext();
  const renderer = createDefaultMatchTrackingRenderer();
  const notifier = createMatchTrackingNotifier({
    client: {
      channels: {
        fetch: async (channelId) =>
          await client.channels.fetch(channelId) as WatcherChannel | null,
      },
    },
    logger: botLogger,
  });
  await seedMatchWatcherProcessingContext(context, result.watchers);
  for (const watcher of result.watchers) {
    try {
      await processWatcher(notifier, renderer, watcher, context);
    } catch (error) {
      botLogger.error("match_tracking.watcher_failed", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      }, error);
    }
  }
}

let workerId: number | undefined;
let processingMatchWatchers = false;
let lastBudgetWarningAt = 0;

function warnIfRiotRequestBudgetRisk(
  watcherCount: number,
  pollIntervalMs = numberEnv(
    "MATCH_WATCH_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  ),
) {
  const longWindowLimit = numberEnv(
    "RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT",
    DEFAULT_RIOT_LONG_WINDOW_LIMIT,
  );
  const longWindowMs = numberEnv(
    "RIOT_RATE_LIMIT_LONG_WINDOW_MS",
    DEFAULT_RIOT_LONG_WINDOW_MS,
  );
  const estimatedRequests = watcherCount *
    Math.ceil(longWindowMs / pollIntervalMs);
  const now = Date.now();
  if (
    estimatedRequests >= longWindowLimit * 0.8 &&
    now - lastBudgetWarningAt >= longWindowMs
  ) {
    lastBudgetWarningAt = now;
    botLogger.warn("match_tracking.riot_request_budget_risk", {
      watcherCount,
      pollIntervalMs,
      rateLimitWindowMs: longWindowMs,
      estimatedRequestsPerWindow: estimatedRequests,
      limitPerWindow: longWindowLimit,
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

export const matchTracker = {
  processMatchWatchers,
  startMatchTrackingWorker,
  stopMatchTrackingWorker,
  hasResultFetchTimedOut,
  shouldNotifyInGame,
  warnIfRiotRequestBudgetRisk,
};
