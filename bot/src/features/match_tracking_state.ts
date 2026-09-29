import { canonicalRiotPlatform } from "@adteemo/api/contract";
import type {
  ActiveGame,
  MatchGameObservation,
  MatchWatcher,
  RiotAccount,
} from "@adteemo/api/contract";
import type {
  ApiClient,
  FinalizedRankSnapshot,
  RankSnapshotPayload,
} from "../api_client.ts";

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
  gameMode?: string | null;
  observation?: MatchGameObservation | null;
  messageId: string | null;
  startedAt: Date | null;
};
export type ActiveNotificationGroup = {
  messageId: string | null;
  targetAccountPuuids: Set<string>;
  activeWatchers: Map<string, MatchWatcher>;
  resultMessageIdsInUse: Set<string>;
};
export type ResultMetricKind =
  | "visionScore"
  | "visionScorePerMinute"
  | "minionCs"
  | "allyJungleCs"
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
  totalAllyJungleMinionsKilled?: number;
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
  return `${canonicalRiotPlatform(account.platform).toUpperCase()}_${gameId}`;
}

export function normalizePlatform(platform: string) {
  return platform.toUpperCase();
}

export function activeNotificationGroupKey(
  watcher: Pick<MatchWatcher, "guildId" | "channelId">,
  matchId: string,
) {
  return `${watcher.guildId}:${watcher.channelId}:${matchId.toUpperCase()}`;
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
    currentGameMode: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentGameMode,
    currentGameObservation: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentGameObservation,
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
    gameMode: watcher.pendingResultGameMode ??
      (watcher.lastState === "FETCHING_RESULT"
        ? watcher.currentGameMode
        : null),
    observation: watcher.pendingResultObservation ??
      (watcher.lastState === "FETCHING_RESULT"
        ? watcher.currentGameObservation
        : null),
    messageId: watcher.pendingResultNotificationMessageId ??
      watcher.currentNotificationMessageId,
    startedAt: watcher.pendingResultStartedAt ??
      watcher.gameStartedAt,
  };
}

/** Retain only this account's observed Mayhem data, never another game's. */
export function observeMayhemGame(
  puuid: string,
  previous: MatchGameObservation | null,
  game: ActiveGame,
  now: Date,
): MatchGameObservation | null {
  if (game.gameMode !== "KIWI") return null;
  const participant = game.participants.find((p) => p.puuid === puuid);
  const championId = participant?.championId && participant.championId > 0
    ? participant.championId
    : previous?.championId ?? null;
  const durations = [previous?.elapsedSeconds, game.gameLength];
  if (game.gameStartTime > 0 && game.gameStartTime <= now.getTime()) {
    durations.push(Math.floor((now.getTime() - game.gameStartTime) / 1000));
  }
  const knownDurations = durations.filter((value): value is number =>
    value !== null && value !== undefined && value >= 0
  );
  const elapsedSeconds = knownDurations.length
    ? Math.max(...knownDurations)
    : null;
  return championId === null && elapsedSeconds === null
    ? null
    : { championId, elapsedSeconds };
}

export type CurrentMatchState = Pick<
  MatchWatcher,
  | "lastState"
  | "currentGameId"
  | "currentGameMode"
  | "currentGameObservation"
  | "currentMatchId"
  | "currentNotificationMessageId"
  | "gameStartedAt"
  | "lastInGameNotifiedAt"
>;
export type PendingMatchState = Pick<
  MatchWatcher,
  | "pendingResultMatchId"
  | "pendingResultGameMode"
  | "pendingResultObservation"
  | "pendingResultNotificationMessageId"
  | "pendingResultStartedAt"
>;

type ActiveMatchState = CurrentMatchState & {
  lastState: "IN_GAME";
  currentGameId: string;
  currentMatchId: string;
};
export type ActiveGameDecision =
  | { kind: "idle"; current: CurrentMatchState | null }
  | { kind: "ended"; current: CurrentMatchState; previous: PendingResult }
  | {
    kind: "started";
    game: ActiveGame;
    current: ActiveMatchState;
    previous: PendingResult | null;
  }
  | {
    kind: "progress" | "observed";
    game: ActiveGame;
    current: ActiveMatchState;
  };

export function currentMatchIdFromWatcher(
  watcher: MatchWatcher,
  account: RiotAccount,
) {
  return watcher.lastState === "IN_GAME" && watcher.currentGameId
    ? watcher.currentMatchId ?? matchIdForGame(account, watcher.currentGameId)
    : null;
}

function idleMatchState(): CurrentMatchState {
  return {
    lastState: "IDLE",
    currentGameId: null,
    currentGameMode: null,
    currentGameObservation: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    gameStartedAt: null,
    lastInGameNotifiedAt: null,
  };
}

/** The sole owner of active-match identity and notification timing decisions. */
export function decideActiveGame(input: {
  watcher: MatchWatcher;
  account: RiotAccount;
  activeGame: ActiveGame | null;
  notificationLastInGameNotifiedAt: Date | null;
  inGameNotifyIntervalMs: number;
  now: Date;
}): ActiveGameDecision {
  const { watcher, account, activeGame, now } = input;
  const previousMatchId = currentMatchIdFromWatcher(watcher, account);
  const previous: PendingResult | null = previousMatchId
    ? {
      matchId: previousMatchId,
      gameMode: watcher.currentGameMode,
      observation: watcher.currentGameObservation,
      messageId: watcher.currentNotificationMessageId,
      startedAt: watcher.gameStartedAt,
    }
    : null;
  if (!activeGame) {
    if (previous) return { kind: "ended", previous, current: idleMatchState() };
    return {
      kind: "idle",
      current: watcher.lastState === "IDLE" && watcher.currentGameId === null
        ? null
        : idleMatchState(),
    };
  }
  const matchId = matchIdForGame(account, activeGame.gameId);
  const sameGame = previousMatchId === matchId;
  const current: ActiveMatchState = {
    lastState: "IN_GAME",
    currentGameId: String(activeGame.gameId),
    currentMatchId: matchId,
    currentGameMode: activeGame.gameMode,
    currentGameObservation: observeMayhemGame(
      watcher.riotAccountPuuid,
      sameGame ? watcher.currentGameObservation : null,
      activeGame,
      now,
    ),
    currentNotificationMessageId: sameGame
      ? watcher.currentNotificationMessageId
      : null,
    gameStartedAt: sameGame
      ? watcher.gameStartedAt
      : new Date(activeGame.gameStartTime),
    lastInGameNotifiedAt: sameGame ? watcher.lastInGameNotifiedAt : null,
  };
  if (!sameGame) {
    return { kind: "started", game: activeGame, current, previous };
  }
  return {
    kind: shouldNotifySince(
        input.notificationLastInGameNotifiedAt ?? watcher.lastInGameNotifiedAt,
        input.inGameNotifyIntervalMs,
        now,
      )
      ? "progress"
      : "observed",
    game: activeGame,
    current,
  };
}

type ResultInspection = Awaited<
  ReturnType<ApiClient["inspectMatchWatcherResult"]>
>;
type ReadyResult = Extract<ResultInspection, { success: true }>;
type ResultPreflight = { kind: "inspect" } | { kind: "timeout" };
export type ResultDecision =
  | { kind: "unavailable" }
  | { kind: "pending"; failed: boolean }
  | {
    kind: "result";
    result: ReadyResult & { match: NonNullable<ReadyResult["match"]> };
  };
type ResultDecisionInput = {
  pending: PendingResult;
  now: Date;
  resultFetchTimeoutMs: number;
};

/** The result deadline belongs to the watcher, not the shared Riot response. */
export function decideResult(
  input: ResultDecisionInput & { inspection: ResultInspection },
): ResultDecision;
export function decideResult(input: ResultDecisionInput): ResultPreflight;
export function decideResult(
  input: ResultDecisionInput & { inspection?: ResultInspection },
): ResultPreflight | ResultDecision {
  const result = input.inspection;
  if (!result) {
    return {
      kind: input.pending.startedAt && isResultFetchTimedOut(
          input.pending.startedAt,
          input.resultFetchTimeoutMs,
          input.now,
        )
        ? "timeout"
        : "inspect",
    };
  }
  if (!result.success) {
    return result.status === 502 && result.code === "RIOT_MATCH_ACCESS_DENIED"
      ? { kind: "unavailable" }
      : { kind: "pending", failed: true };
  }
  return result.match
    ? { kind: "result", result: { ...result, match: result.match } }
    : { kind: "pending", failed: false };
}

export function pendingMatchState(
  pending: PendingResult | null,
  messageId: string | null = pending?.messageId ?? null,
): PendingMatchState {
  return {
    pendingResultMatchId: pending?.matchId ?? null,
    pendingResultGameMode: pending?.gameMode ?? null,
    pendingResultObservation: pending?.observation ?? null,
    pendingResultNotificationMessageId: messageId,
    pendingResultStartedAt: pending?.startedAt ?? null,
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

  const minions = displayMetric(participant.totalMinionsKilled);
  const jungle = displayMetric(participant.neutralMinionsKilled);
  if (minions !== null && jungle !== null) {
    const cs = Number(minions) + Number(jungle);
    fields.push(
      { kind: "cs", value: String(cs) },
      { kind: "csPerMinute", value: formatPerMinute(cs, gameDurationSeconds) },
    );
  }
  if (role === "JUNGLE") {
    // Riot's neutralMinionsKilled also counts pets; it is not a disjoint
    // river/objective count. Display reported counts without subtracting camps.
    for (
      const [kind, raw] of [
        ["minionCs", participant.totalMinionsKilled],
        ["jungleCs", participant.neutralMinionsKilled],
        ["allyJungleCs", participant.totalAllyJungleMinionsKilled],
        ["enemyJungleCs", participant.totalEnemyJungleMinionsKilled],
      ] as const
    ) {
      const value = displayMetric(raw);
      if (value !== null) fields.push({ kind, value });
    }
  }
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
