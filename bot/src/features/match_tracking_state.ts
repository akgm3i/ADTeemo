import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import type {
  FinalizedRankSnapshot,
  RankSnapshotPayload,
} from "../api_client.ts";

const RANKED_QUEUE_TYPES: RankedQueueType[] = [
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
];
const RANKED_QUEUE_BY_QUEUE_ID = new Map<number, RankedQueueType>([
  [420, "RANKED_SOLO_5x5"],
  [440, "RANKED_FLEX_SR"],
]);
const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];
const DIVISION_ORDER = ["IV", "III", "II", "I"];

export type RankedQueueType = RankSnapshotPayload["queueType"];
export type RankSummary = {
  queueType: RankedQueueType;
  before: FinalizedRankSnapshot | null;
  after: FinalizedRankSnapshot | null;
};
export type PendingResult = {
  matchId: string;
  messageId: string | null;
  startedAt: Date | null;
};
export type ActiveNotificationGroup = {
  messageId: string | null;
  targetDiscordIds: Set<string>;
  activeWatchers: Map<string, MatchWatcher>;
  messageIdTargetDiscordIds: Map<string, Set<string>>;
  resultMessageIdsInUse: Set<string>;
};
export type ResultMetricKind =
  | "visionScore"
  | "visionScorePerMinute"
  | "jungleCs"
  | "enemyJungleCs"
  | "cs"
  | "csPerMinute";
export type ResultMetricValue = {
  kind: ResultMetricKind;
  value: string;
};
export type ResultMetricParticipant = {
  teamPosition?: string;
  individualPosition?: string;
  visionScore?: number;
  neutralMinionsKilled?: number;
  totalEnemyJungleMinionsKilled?: number;
  totalMinionsKilled?: number;
};
export type SelectResultNotificationMessageIdInput = {
  groupMessageId: string | null | undefined;
  watcherMessageId: string | null | undefined;
  activeWatcherMessageId: string | null | undefined;
  usedMessageIds: ReadonlySet<string>;
};

export function matchIdForGame(
  account: Pick<RiotAccount, "platform">,
  gameId: string | number,
) {
  return `${account.platform.toUpperCase()}_${gameId}`;
}

export function normalizePlatform(platform: string) {
  return platform.toUpperCase();
}

export function activeNotificationGroupKey(
  watcher: Pick<MatchWatcher, "guildId" | "channelId">,
  platform: string,
  gameId: string | number,
) {
  return `${watcher.guildId}:${watcher.channelId}:${
    normalizePlatform(platform)
  }:${gameId}`;
}

export function matchIdParts(matchId: string) {
  const separatorIndex = matchId.indexOf("_");
  if (separatorIndex < 0 || separatorIndex === matchId.length - 1) {
    return null;
  }
  return {
    platform: normalizePlatform(matchId.slice(0, separatorIndex)),
    gameId: matchId.slice(separatorIndex + 1),
  };
}

export function activeGameCacheKey(
  account: Pick<RiotAccount, "platform" | "puuid">,
) {
  return `${account.platform}:${account.puuid}`;
}

export function matchCacheKey(
  account: Pick<RiotAccount, "region">,
  matchId: string,
) {
  return `${account.region}:${matchId}`;
}

export function rankedQueueTypeByQueueId(queueId: number | undefined) {
  return queueId === undefined
    ? undefined
    : RANKED_QUEUE_BY_QUEUE_ID.get(queueId);
}

export function rankSnapshotPayloadsFromEntries(
  entries: Array<{
    queueType: string;
    tier?: string | null;
    rank?: string | null;
    leaguePoints?: number | null;
    wins?: number | null;
    losses?: number | null;
  }>,
  fetchedAt: Date,
): RankSnapshotPayload[] {
  return RANKED_QUEUE_TYPES.map((queueType) => {
    const entry = entries.find((candidate) =>
      candidate.queueType === queueType
    );
    return {
      queueType,
      tier: entry?.tier ?? null,
      rank: entry?.rank ?? null,
      leaguePoints: entry?.leaguePoints ?? null,
      wins: entry?.wins ?? null,
      losses: entry?.losses ?? null,
      fetchedAt,
    };
  });
}

export function newerDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

export function isAfterDate(left: Date, right: Date | null) {
  return !right || left.getTime() > right.getTime();
}

export function activeNotificationGroupLastInGameNotifiedAt(
  group: ActiveNotificationGroup,
) {
  const messageId = group.messageId;
  if (!messageId) return null;

  let lastInGameNotifiedAt: Date | null = null;
  for (const watcher of group.activeWatchers.values()) {
    if (watcher.currentNotificationMessageId !== messageId) continue;
    lastInGameNotifiedAt = newerDate(
      lastInGameNotifiedAt,
      watcher.lastInGameNotifiedAt,
    );
  }
  return lastInGameNotifiedAt;
}

export function selectResultNotificationMessageId(
  input: SelectResultNotificationMessageIdInput,
) {
  const watcherMessageId = input.activeWatcherMessageId ??
    input.watcherMessageId;
  const groupMessageId = input.groupMessageId;
  if (watcherMessageId && watcherMessageId !== groupMessageId) {
    return input.usedMessageIds.has(watcherMessageId) ? null : watcherMessageId;
  }

  const messageId = groupMessageId ?? watcherMessageId;
  if (!messageId) return null;
  return input.usedMessageIds.has(messageId) ? null : messageId;
}

export function currentStateFromWatcher(watcher: MatchWatcher) {
  return {
    lastState: watcher.lastState === "FETCHING_RESULT"
      ? "IDLE" as const
      : watcher.lastState,
    currentGameId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentGameId,
    currentMatchId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentMatchId,
    currentNotificationMessageId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentNotificationMessageId,
    gameStartedAt: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.gameStartedAt,
    lastInGameNotifiedAt: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.lastInGameNotifiedAt,
  };
}

export function pendingResultFromWatcher(
  watcher: MatchWatcher,
): PendingResult | null {
  const matchId = watcher.pendingResultMatchId ??
    (watcher.lastState === "FETCHING_RESULT" ? watcher.currentMatchId : null);
  if (!matchId) return null;
  return {
    matchId,
    messageId: watcher.pendingResultNotificationMessageId ??
      watcher.currentNotificationMessageId,
    startedAt: watcher.pendingResultStartedAt ??
      watcher.gameStartedAt,
  };
}

export function elapsedMinutes(
  activeGame: { gameLength?: number; gameStartTime: number },
  now: number,
) {
  const currentLengthMs = (activeGame.gameLength ?? 0) * 1000;
  const elapsedMs = activeGame.gameStartTime > 0
    ? Math.max(now - activeGame.gameStartTime, currentLengthMs)
    : currentLengthMs;
  return Math.max(0, Math.floor(elapsedMs / 60_000));
}

export function shouldNotifySince(
  lastInGameNotifiedAt: Date | null,
  intervalMs: number,
  now: Date,
) {
  if (!lastInGameNotifiedAt) return true;
  return now.getTime() - lastInGameNotifiedAt.getTime() >= intervalMs;
}

export function shouldNotifyInGame(
  watcher: Pick<MatchWatcher, "lastInGameNotifiedAt">,
  intervalMs: number,
  now: Date,
) {
  return shouldNotifySince(watcher.lastInGameNotifiedAt, intervalMs, now);
}

export function shouldNotifyActiveNotificationGroup(
  group: ActiveNotificationGroup,
  watcher: Pick<MatchWatcher, "lastInGameNotifiedAt">,
  intervalMs: number,
  now: Date,
) {
  return shouldNotifySince(
    activeNotificationGroupLastInGameNotifiedAt(group) ??
      watcher.lastInGameNotifiedAt,
    intervalMs,
    now,
  );
}

export function hasResultFetchTimedOut(
  watcher: Pick<MatchWatcher, "pendingResultStartedAt" | "gameStartedAt">,
  timeoutMs: number,
  now: Date,
) {
  const startedAt = watcher.pendingResultStartedAt ?? watcher.gameStartedAt;
  if (!startedAt) return false;
  return isResultFetchTimedOut(startedAt, timeoutMs, now);
}

export function isResultFetchTimedOut(
  startedAt: Date,
  timeoutMs: number,
  now: Date,
) {
  return now.getTime() - startedAt.getTime() >= timeoutMs;
}

export function formatPerMinute(
  value: number,
  gameDurationSeconds: number,
) {
  if (!Number.isFinite(value) || !Number.isFinite(gameDurationSeconds)) {
    return "-";
  }
  if (value < 0 || gameDurationSeconds <= 0) return "-";
  return (value / (gameDurationSeconds / 60)).toFixed(1);
}

export function resultMetricRole(participant: ResultMetricParticipant) {
  for (
    const position of [
      participant.teamPosition,
      participant.individualPosition,
    ]
  ) {
    switch (position?.toUpperCase()) {
      case "TOP":
        return "TOP";
      case "JUNGLE":
        return "JUNGLE";
      case "MIDDLE":
      case "MID":
        return "MIDDLE";
      case "BOTTOM":
      case "BOT":
        return "BOTTOM";
      case "UTILITY":
      case "SUPPORT":
        return "SUPPORT";
    }
  }
  return "UNKNOWN";
}

export function displayMetric(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? String(value)
    : null;
}

export function resultMetricValues(
  participant: ResultMetricParticipant,
  gameDurationSeconds: number,
): ResultMetricValue[] {
  const fields: ResultMetricValue[] = [];
  const role = resultMetricRole(participant);

  if (role === "SUPPORT") {
    const visionScore = participant.visionScore;
    if (
      visionScore === undefined || !Number.isFinite(visionScore) ||
      visionScore < 0
    ) {
      return fields;
    }
    fields.push(
      {
        kind: "visionScore",
        value: String(visionScore),
      },
      {
        kind: "visionScorePerMinute",
        value: formatPerMinute(visionScore, gameDurationSeconds),
      },
    );
    return fields;
  }

  if (role === "JUNGLE") {
    const jungleCs = displayMetric(participant.neutralMinionsKilled);
    if (jungleCs) {
      fields.push({
        kind: "jungleCs",
        value: jungleCs,
      });
    }
    const enemyJungleCs = displayMetric(
      participant.totalEnemyJungleMinionsKilled,
    );
    if (enemyJungleCs) {
      fields.push({
        kind: "enemyJungleCs",
        value: enemyJungleCs,
      });
    }
    return fields;
  }

  const cs = (participant.totalMinionsKilled ?? 0) +
    (participant.neutralMinionsKilled ?? 0);
  fields.push(
    {
      kind: "cs",
      value: String(cs),
    },
    {
      kind: "csPerMinute",
      value: formatPerMinute(cs, gameDurationSeconds),
    },
  );
  return fields;
}

export function formatKillParticipation(
  participantKills: number,
  participantAssists: number,
  teamKills: number,
) {
  if (
    !Number.isFinite(participantKills) ||
    !Number.isFinite(participantAssists) ||
    !Number.isFinite(teamKills) ||
    participantKills < 0 ||
    participantAssists < 0 ||
    teamKills <= 0
  ) {
    return "-";
  }
  return `${
    (((participantKills + participantAssists) / teamKills) * 100).toFixed(1)
  }%`;
}

export function displayTier(tier: string) {
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
}

export function isApexTier(tier: string) {
  const tierIndex = TIER_ORDER.indexOf(tier.toUpperCase());
  const masterIndex = TIER_ORDER.indexOf("MASTER");
  return tierIndex >= masterIndex && masterIndex >= 0;
}

export function formatRankSnapshot(snapshot: FinalizedRankSnapshot) {
  if (
    !snapshot.tier || snapshot.leaguePoints === null ||
    snapshot.leaguePoints === undefined
  ) {
    return null;
  }
  const rank = snapshot.rank && !isApexTier(snapshot.tier)
    ? ` ${snapshot.rank}`
    : "";
  return `${displayTier(snapshot.tier)}${rank} ${snapshot.leaguePoints}LP`;
}

export function rankSnapshotTotalLp(snapshot: FinalizedRankSnapshot) {
  if (
    !snapshot.tier || snapshot.leaguePoints === null ||
    snapshot.leaguePoints === undefined
  ) {
    return null;
  }

  const tierIndex = TIER_ORDER.indexOf(snapshot.tier.toUpperCase());
  if (tierIndex < 0) return null;
  const masterIndex = TIER_ORDER.indexOf("MASTER");
  if (isApexTier(snapshot.tier)) {
    return masterIndex * 400 + snapshot.leaguePoints;
  }

  if (!snapshot.rank) return null;
  const divisionIndex = DIVISION_ORDER.indexOf(snapshot.rank.toUpperCase());
  if (divisionIndex < 0) return null;
  return tierIndex * 400 + divisionIndex * 100 + snapshot.leaguePoints;
}

export function rankDelta(
  before: FinalizedRankSnapshot,
  after: FinalizedRankSnapshot,
) {
  const beforeLp = rankSnapshotTotalLp(before);
  const afterLp = rankSnapshotTotalLp(after);
  if (beforeLp === null || afterLp === null) return null;
  const delta = afterLp - beforeLp;
  if (delta === 0 || Math.abs(delta) > 100) return null;
  return delta;
}
