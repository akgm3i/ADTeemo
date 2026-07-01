import { type Client, EmbedBuilder } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import { apiClient, type OpggMatchDetail } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import {
  activeGameCacheKey,
  type ActiveNotificationGroup,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  displayMetric,
  elapsedMinutes,
  formatKillParticipation,
  formatRankSnapshot,
  hasResultFetchTimedOut as hasResultFetchTimedOutWithConfig,
  isAfterDate,
  isResultFetchTimedOut as isResultFetchTimedOutWithConfig,
  matchCacheKey,
  matchIdForGame,
  matchIdParts,
  newerDate,
  type PendingResult,
  pendingResultFromWatcher,
  rankDelta,
  rankedQueueTypeByQueueId,
  rankSnapshotPayloadsFromEntries,
  type RankSummary,
  type ResultMetricKind,
  resultMetricValues,
  selectResultNotificationMessageId,
  shouldNotifyActiveNotificationGroup
    as shouldNotifyActiveNotificationGroupWithConfig,
  shouldNotifyInGame as shouldNotifyInGameWithConfig,
} from "./match_tracking_state.ts";

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
type RiotMatchParticipant = RiotMatch["info"]["participants"][number];
type WatcherState = Parameters<typeof apiClient.updateMatchWatcherState>[2];
type MatchWatcherProcessingContext = {
  activeNotificationGroups: Map<string, ActiveNotificationGroup>;
  riotAccountsByTargetDiscordId: Map<string, Promise<RiotAccountResult>>;
  activeGamesByRiotAccount: Map<string, Promise<ActiveGameResult>>;
  matchesByRegionAndMatchId: Map<string, Promise<RiotMatch | null>>;
};
type WatcherMessage = {
  id?: string;
  edit?: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};
type WatcherChannel = {
  send?: (options: { embeds: EmbedBuilder[] }) => Promise<WatcherMessage>;
  messages?: {
    fetch?: (messageId: string) => Promise<WatcherMessage>;
  };
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

function fallbackChampionName(
  championId: number | undefined,
  fallbackName?: string,
) {
  if (fallbackName) return fallbackName;
  if (championId === undefined) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.unknownChampion,
    );
  }
  return messageHandler.formatMessage(
    messageKeys.matchTracking.embed.fallback.championId,
    { id: championId },
  );
}

function championNameById(
  staticData: ResolvedRiotStaticData | null,
  championId: number | undefined,
  fallbackName?: string,
) {
  if (championId === undefined) {
    return fallbackChampionName(championId, fallbackName);
  }
  return staticData?.champions[String(championId)]?.name ??
    fallbackChampionName(championId, fallbackName);
}

function championIconUrlById(
  staticData: ResolvedRiotStaticData | null,
  championId: number | undefined,
) {
  if (championId === undefined) return null;
  return staticData?.champions[String(championId)]?.iconUrl ?? null;
}

function queueName(
  staticData: ResolvedRiotStaticData | null,
  queueId: number | undefined,
) {
  if (queueId === undefined) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.unknownQueue,
    );
  }
  const fallback = messageHandler.formatMessage(
    messageKeys.matchTracking.embed.fallback.queueId,
    { id: queueId },
  );
  return staticData?.queues[String(queueId)] ?? fallback;
}

function mapName(
  staticData: ResolvedRiotStaticData | null,
  mapId: number,
) {
  const fallback = messageHandler.formatMessage(
    messageKeys.matchTracking.embed.fallback.mapId,
    { id: mapId },
  );
  return staticData?.maps[String(mapId)] ?? fallback;
}

function gameModeName(
  staticData: ResolvedRiotStaticData | null,
  gameMode: string,
) {
  return staticData?.gameModes[gameMode] ?? gameMode;
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

function resultMetricFieldMessageKey(kind: ResultMetricKind) {
  switch (kind) {
    case "visionScore":
      return messageKeys.matchTracking.embed.field.visionScore;
    case "visionScorePerMinute":
      return messageKeys.matchTracking.embed.field.visionScorePerMinute;
    case "jungleCs":
      return messageKeys.matchTracking.embed.field.jungleCs;
    case "enemyJungleCs":
      return messageKeys.matchTracking.embed.field.enemyJungleCs;
    case "cs":
      return messageKeys.matchTracking.embed.field.cs;
    case "csPerMinute":
      return messageKeys.matchTracking.embed.field.csPerMinute;
  }
}

function resultMetricFields(
  participant: RiotMatchParticipant,
  gameDurationSeconds: number,
) {
  return resultMetricValues(participant, gameDurationSeconds).map(
    ({ kind, value }) => ({
      name: messageHandler.formatMessage(resultMetricFieldMessageKey(kind)),
      value,
      inline: true,
    }),
  );
}

function rankFieldValue(summary: RankSummary | null) {
  if (!summary?.after) return null;

  const afterRank = formatRankSnapshot(summary.after);
  if (!afterRank) return null;

  if (!summary.before) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.rank.current,
      { rank: afterRank },
    );
  }

  const beforeRank = formatRankSnapshot(summary.before);
  const delta = beforeRank ? rankDelta(summary.before, summary.after) : null;
  if (beforeRank && delta !== null) {
    const sign = delta > 0 ? "+" : "";
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.rank.delta,
      {
        delta: `${sign}${delta}`,
        before: beforeRank,
        after: afterRank,
      },
    );
  }

  return messageHandler.formatMessage(
    messageKeys.matchTracking.embed.rank.current,
    { rank: afterRank },
  );
}

function opggScoreValue(score: number) {
  return score.toFixed(1);
}

function opggFieldValue(detail: OpggMatchDetail | null) {
  if (!detail) return null;

  const lines = [
    messageHandler.formatMessage(
      messageKeys.matchTracking.embed.opgg.detail,
      { url: detail.detailUrl },
    ),
  ];
  const laneScore = detail.participant?.laneScore;
  if (laneScore !== null && laneScore !== undefined) {
    lines.push(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.opgg.laneScore,
        { score: opggScoreValue(laneScore) },
      ),
    );
  }
  if (detail.averageTier) {
    lines.push(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.opgg.averageTier,
        { tier: detail.averageTier },
      ),
    );
  }
  return lines.join("\n");
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

async function buildActiveGameEmbed(
  watcher: MatchWatcher,
  account: RiotAccount,
  activeGame: ActiveGame,
  kind: "started" | "progress",
  targetDetails?: ActiveGameTargetDetail[],
) {
  const participant = activeGame.participants.find((p) =>
    p.puuid === account.puuid
  );
  const minutes = elapsedMinutes(activeGame, Date.now());
  const championIds = [
    participant?.championId,
    ...(targetDetails?.map((detail) => detail.championId) ?? []),
  ].filter((id): id is number => id !== undefined);
  const staticData = await resolveRiotStaticData({
    championIds: [...new Set(championIds)],
    queueIds: activeGame.gameQueueConfigId === undefined
      ? []
      : [activeGame.gameQueueConfigId],
    mapIds: [activeGame.mapId],
    gameModes: [activeGame.gameMode],
  });
  const champion = championNameById(
    staticData,
    participant?.championId,
  );
  const queue = queueName(staticData, activeGame.gameQueueConfigId);
  const map = mapName(staticData, activeGame.mapId);
  const mode = gameModeName(staticData, activeGame.gameMode);
  const title = kind === "started"
    ? messageHandler.formatMessage(
      messageKeys.matchTracking.embed.active.startedTitle,
    )
    : messageHandler.formatMessage(
      messageKeys.matchTracking.embed.active.progressTitle,
    );
  const targets = targetDetails?.length
    ? targetDetails.map(({ targetDiscordId, championId }) => ({
      targetDiscordId,
      champion: championNameById(staticData, championId),
    }))
    : [{ targetDiscordId: watcher.targetDiscordId, champion }];
  const thumbnailUrl = targets.length === 1
    ? championIconUrlById(staticData, participant?.championId)
    : null;
  const description = messageHandler.formatMessage(
    messageKeys.matchTracking.embed.active.description,
    {
      member: targets.map(({ targetDiscordId }) => `<@${targetDiscordId}>`)
        .join(", "),
    },
  );
  const targetChampionField = targets.length > 1
    ? {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.activeChampions,
      ),
      value: targets.map(({ targetDiscordId, champion }) =>
        `<@${targetDiscordId}>: ${champion}`
      ).join("\n"),
      inline: false,
    }
    : {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.champion,
      ),
      value: champion,
      inline: true,
    };
  const footerText = targets.length > 1
    ? messageHandler.formatMessage(
      messageKeys.matchTracking.embed.footer.gameOnly,
      {
        platform: account.platform.toUpperCase(),
        gameId: activeGame.gameId,
      },
    )
    : messageHandler.formatMessage(
      messageKeys.matchTracking.embed.footer.game,
      {
        platform: account.platform.toUpperCase(),
        gameId: activeGame.gameId,
        riotId: `${account.gameName}#${account.tagLine}`,
      },
    );

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(kind === "started" ? 0x2ecc71 : 0x3498db)
    .addFields(
      targetChampionField,
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.queue,
        ),
        value: queue,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.map,
        ),
        value: map,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.mode,
        ),
        value: mode,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.elapsed,
        ),
        value: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.fallback.elapsedMinutes,
          { minutes },
        ),
        inline: true,
      },
    )
    .setFooter({
      text: footerText,
    })
    .setTimestamp(new Date());
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }
  return embed;
}

function buildResultPendingEmbed(watcher: MatchWatcher, matchId: string) {
  return new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultPending.title,
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultPending.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(0xf1c40f)
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId },
      ),
    })
    .setTimestamp(new Date());
}

function buildResultFetchTimeoutEmbed(
  watcher: MatchWatcher,
  matchId: string,
) {
  return new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.title,
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(0x95a5a6)
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId },
      ),
    })
    .setTimestamp(new Date());
}

async function buildMatchResultEmbed(
  watcher: MatchWatcher,
  account: RiotAccount,
  match: RiotMatch,
  rankSummary: RankSummary | null = null,
  opggDetail: OpggMatchDetail | null = null,
) {
  const participant = match.info.participants.find((p) =>
    p.puuid === account.puuid
  );
  if (!participant) {
    return new EmbedBuilder()
      .setTitle(
        messageHandler.formatMessage(
          messageKeys.matchTracking.embed.result.participantMissingTitle,
        ),
      )
      .setDescription(
        messageHandler.formatMessage(
          messageKeys.matchTracking.embed.result.participantMissingDescription,
          { member: `<@${watcher.targetDiscordId}>` },
        ),
      )
      .setColor(0x95a5a6)
      .setFooter({
        text: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.footer.match,
          { matchId: match.metadata.matchId },
        ),
      })
      .setTimestamp(new Date());
  }

  const staticData = await resolveRiotStaticData({
    championIds: participant.championId === undefined
      ? []
      : [participant.championId],
    queueIds: [match.info.queueId],
    mapIds: [match.info.mapId],
    gameModes: [match.info.gameMode],
  });
  const champion = championNameById(
    staticData,
    participant.championId,
    participant.championName,
  );
  const thumbnailUrl = championIconUrlById(
    staticData,
    participant.championId,
  );
  const teamKills = match.info.participants
    .filter((candidate) => candidate.teamId === participant.teamId)
    .reduce((sum, candidate) => sum + candidate.kills, 0);
  const killParticipation = formatKillParticipation(
    participant.kills,
    participant.assists,
    teamKills,
  );
  const queue = queueName(staticData, match.info.queueId);
  const map = mapName(staticData, match.info.mapId);
  const mode = gameModeName(staticData, match.info.gameMode);
  const result = participant.win
    ? messageHandler.formatMessage(messageKeys.matchTracking.embed.result.win)
    : messageHandler.formatMessage(messageKeys.matchTracking.embed.result.loss);
  const rankValue = rankFieldValue(rankSummary);
  const opggValue = opggFieldValue(opggDetail);
  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.champion,
      ),
      value: champion,
      inline: true,
    },
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.kda,
      ),
      value:
        `${participant.kills}/${participant.deaths}/${participant.assists}`,
      inline: true,
    },
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.killParticipation,
      ),
      value: killParticipation,
      inline: true,
    },
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.gold,
      ),
      value: String(participant.goldEarned),
      inline: true,
    },
  ];
  const damage = displayMetric(participant.totalDamageDealtToChampions);
  if (damage) {
    fields.push({
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.damage,
      ),
      value: damage,
      inline: true,
    });
  }
  fields.push(
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.queue,
      ),
      value: queue,
      inline: true,
    },
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.map,
      ),
      value: map,
      inline: true,
    },
    {
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.mode,
      ),
      value: mode,
      inline: true,
    },
    ...resultMetricFields(participant, match.info.gameDuration),
  );
  const embed = new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.title,
        { result },
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(participant.win ? 0x2ecc71 : 0xe74c3c)
    .addFields(fields)
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.matchWithRiotId,
        {
          matchId: match.metadata.matchId,
          riotId: `${account.gameName}#${account.tagLine}`,
        },
      ),
    })
    .setTimestamp(new Date(match.info.gameEndTimestamp ?? Date.now()));
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }
  if (rankValue) {
    embed.addFields({
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.rank,
      ),
      value: rankValue,
      inline: false,
    });
  }
  if (opggValue) {
    embed.addFields({
      name: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.field.opgg,
      ),
      value: opggValue,
      inline: false,
    });
  }
  return embed;
}

async function sendOrEditWatcherMessage(
  client: Client,
  watcher: MatchWatcher,
  messageId: string | null | undefined,
  embed: EmbedBuilder,
) {
  try {
    const channel = await client.channels.fetch(watcher.channelId) as
      | WatcherChannel
      | null;
    if (!channel?.send) {
      botLogger.warn("match_tracking.channel_not_found", {
        guildId: watcher.guildId,
        channelId: watcher.channelId,
      });
      return messageId ?? null;
    }

    if (messageId && channel.messages?.fetch) {
      try {
        const message = await channel.messages.fetch(messageId);
        await message.edit?.({ embeds: [embed] });
        return message.id ?? messageId;
      } catch (error) {
        botLogger.warn("match_tracking.edit_message_failed", {
          guildId: watcher.guildId,
          channelId: watcher.channelId,
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const message = await channel.send({ embeds: [embed] });
    return message.id ?? null;
  } catch (error) {
    botLogger.error("match_tracking.send_message_failed", {
      guildId: watcher.guildId,
      channelId: watcher.channelId,
    }, error);
    return messageId ?? null;
  }
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
  client: Client,
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
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      pending.messageId,
      buildResultFetchTimeoutEmbed(watcher, pending.matchId),
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
  const messageId = await sendOrEditWatcherMessage(
    client,
    watcher,
    pending.messageId,
    await buildMatchResultEmbed(
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
  client: Client,
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
      client,
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
      const messageId = await sendOrEditWatcherMessage(
        client,
        watcher,
        resultNotificationMessageId(activeNotificationGroup, watcher),
        buildResultPendingEmbed(watcher, matchId),
      );
      await tryFetchAndNotifyResult(client, watcher, account, context, {
        matchId,
        messageId,
        startedAt: watcher.gameStartedAt,
      }, {
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
      });
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
    const previousMessageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      resultNotificationMessageId(previousActiveNotificationGroup, watcher),
      buildResultPendingEmbed(watcher, previousMatchId),
    );
    await capturePendingRankSnapshots(watcher, account, activeGame);
    const newMessageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      activeNotificationGroup.messageId,
      await buildActiveGameEmbed(
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
    await tryFetchAndNotifyResult(client, watcher, account, context, {
      matchId: previousMatchId,
      messageId: previousMessageId,
      startedAt: watcher.gameStartedAt,
    }, currentState);
    return;
  }

  const started = watcher.lastState !== "IN_GAME" ||
    watcher.currentGameId !== currentGameId;
  if (started) {
    const notifiedAt = new Date();
    await capturePendingRankSnapshots(watcher, account, activeGame);
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      activeNotificationGroup.messageId,
      await buildActiveGameEmbed(
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
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      activeNotificationGroup.messageId ?? watcher.currentNotificationMessageId,
      await buildActiveGameEmbed(
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
  await seedMatchWatcherProcessingContext(context, result.watchers);
  for (const watcher of result.watchers) {
    try {
      await processWatcher(client, watcher, context);
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
