import type {
  ActiveGame,
  LeagueEntry,
  MatchTrackingNotificationIntent,
  MatchTrackingRankSummary,
  MatchTrackingStateTransition,
  MatchWatcherState,
  OpggMatchDetail,
  RankSnapshotPayload,
  RiotAccount,
  RiotMatch,
} from "../contract/mod.ts";
import type { AppDependencies } from "../dependencies.ts";

const RANKED_QUEUE_TYPES: RankSnapshotPayload["queueType"][] = [
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
];
const RANKED_QUEUE_BY_QUEUE_ID = new Map<
  number,
  RankSnapshotPayload["queueType"]
>([
  [420, "RANKED_SOLO_5x5"],
  [440, "RANKED_FLEX_SR"],
]);

type MatchTrackingInspectionDbActions = Pick<
  AppDependencies["dbActions"],
  | "getRiotAccountByDiscordId"
  | "upsertPendingRankSnapshots"
  | "finalizeMatchRankSnapshots"
>;
type MatchTrackingInspectionRiotApi = Pick<
  AppDependencies["riotApi"],
  | "getActiveGameByPuuid"
  | "getLeagueEntriesByPuuid"
  | "getMatchById"
>;
type MatchTrackingInspectionLogger = Pick<
  AppDependencies["logger"],
  "warn"
>;
type MatchTrackingInspectionClock = {
  now: () => Date;
};

export type InspectMatchWatcherActiveGameInput = {
  guildId: string;
  targetDiscordId: string;
  lastState: MatchWatcherState;
  currentGameId: string | null;
  currentNotificationMessageId?: string | null;
  gameStartedAt?: Date | null;
  lastInGameNotifiedAt?: Date | null;
  notificationLastInGameNotifiedAt?: Date | null;
  inGameNotifyIntervalMs?: number;
};
export type InspectMatchWatcherActiveGameResult =
  | {
    status: "ok";
    account: RiotAccount;
    activeGame: ActiveGame | null;
    notificationIntent: MatchTrackingNotificationIntent | null;
    stateTransition: MatchTrackingStateTransition | null;
  }
  | {
    status: "riot_account_not_found";
    error: string;
  };
export type InspectMatchWatcherResultInput = {
  guildId: string;
  targetDiscordId: string;
  matchId: string;
  messageId?: string | null;
  startedAt?: Date | null;
  resultFetchTimeoutMs?: number;
};
export type InspectMatchWatcherResult =
  | {
    status: "ok";
    account: RiotAccount;
    match: RiotMatch | null;
    rankSummary: MatchTrackingRankSummary | null;
    opggDetail: OpggMatchDetail | null;
    notificationIntent: MatchTrackingNotificationIntent | null;
    stateTransition: MatchTrackingStateTransition | null;
  }
  | {
    status: "riot_account_not_found";
    error: string;
  };

export class MatchTrackingInspectionError extends Error {
  constructor(
    readonly source: "repository" | "riot_api",
    cause: unknown,
  ) {
    super("Match tracking inspection failed", { cause });
    this.name = "MatchTrackingInspectionError";
  }
}

function rankedQueueTypeByQueueId(queueId: number | undefined) {
  return queueId === undefined
    ? undefined
    : RANKED_QUEUE_BY_QUEUE_ID.get(queueId);
}

function rankSnapshotPayloadsFromEntries(
  entries: LeagueEntry[],
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

function shouldCapturePendingRankSnapshots(
  input: Pick<
    InspectMatchWatcherActiveGameInput,
    "lastState" | "currentGameId"
  >,
  activeGame: ActiveGame,
) {
  const currentGameId = String(activeGame.gameId);
  return input.lastState !== "IN_GAME" || input.currentGameId !== currentGameId;
}

function matchIdForGame(
  account: Pick<RiotAccount, "platform">,
  gameId: string,
) {
  return `${account.platform.toUpperCase()}_${gameId}`;
}

function shouldNotifySince(
  lastNotifiedAt: Date | null | undefined,
  intervalMs: number | undefined,
  now: Date,
) {
  if (intervalMs === undefined) return false;
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= intervalMs;
}

function isResultFetchTimedOut(
  startedAt: Date | null | undefined,
  timeoutMs: number | undefined,
  now: Date,
) {
  if (!startedAt || timeoutMs === undefined) return false;
  return now.getTime() - startedAt.getTime() >= timeoutMs;
}

function activeGameStateTransition(
  input: InspectMatchWatcherActiveGameInput,
  activeGame: ActiveGame | null,
  account: RiotAccount,
  now: Date,
): {
  notificationIntent: MatchTrackingNotificationIntent | null;
  stateTransition: MatchTrackingStateTransition | null;
} {
  if (!activeGame) {
    if (input.lastState !== "IN_GAME" || !input.currentGameId) {
      if (input.lastState === "IDLE" && input.currentGameId === null) {
        return { notificationIntent: null, stateTransition: null };
      }
      return {
        notificationIntent: null,
        stateTransition: {
          state: {
            lastState: "IDLE",
            currentGameId: null,
            currentNotificationMessageId: null,
          },
          messageIdField: null,
        },
      };
    }

    const matchId = matchIdForGame(account, input.currentGameId);
    return {
      notificationIntent: { kind: "resultPending", matchId },
      stateTransition: {
        state: {
          lastState: "IDLE",
          currentGameId: null,
          currentMatchId: null,
          currentNotificationMessageId: null,
          pendingResultMatchId: matchId,
          pendingResultStartedAt: input.gameStartedAt ?? null,
          gameStartedAt: null,
          lastInGameNotifiedAt: null,
        },
        messageIdField: "pendingResultNotificationMessageId",
      },
    };
  }

  const currentGameId = String(activeGame.gameId);
  const started = input.lastState !== "IN_GAME" ||
    input.currentGameId !== currentGameId;
  if (started) {
    return {
      notificationIntent: { kind: "started", activeGame },
      stateTransition: {
        state: {
          lastState: "IN_GAME",
          currentGameId,
          currentMatchId: null,
          gameStartedAt: new Date(activeGame.gameStartTime),
          lastInGameNotifiedAt: now,
        },
        messageIdField: "currentNotificationMessageId",
      },
    };
  }

  return { notificationIntent: null, stateTransition: null };
}

export function createMatchTrackingInspectionService(
  dependencies: {
    dbActions: MatchTrackingInspectionDbActions;
    riotApi: MatchTrackingInspectionRiotApi;
    opggMatchDetailService: AppDependencies["opggMatchDetailService"];
    logger: MatchTrackingInspectionLogger;
    clock?: MatchTrackingInspectionClock;
  },
) {
  const clock = dependencies.clock ?? { now: () => new Date() };

  async function capturePendingRankSnapshots(
    input: InspectMatchWatcherActiveGameInput,
    account: RiotAccount,
    activeGame: ActiveGame,
  ) {
    if (!rankedQueueTypeByQueueId(activeGame.gameQueueConfigId)) return;
    if (!shouldCapturePendingRankSnapshots(input, activeGame)) return;

    try {
      const entries = await dependencies.riotApi.getLeagueEntriesByPuuid(
        account.platform,
        account.puuid,
      );
      await dependencies.dbActions.upsertPendingRankSnapshots({
        platform: account.platform,
        gameId: String(activeGame.gameId),
        puuid: account.puuid,
        snapshots: rankSnapshotPayloadsFromEntries(entries, clock.now()),
      });
    } catch (error) {
      dependencies.logger.warn(
        "match_tracking.rank_snapshot_pending_save_failed",
        {
          guildId: input.guildId,
          targetDiscordId: input.targetDiscordId,
        },
        error,
      );
    }
  }

  async function inspectActiveGame(
    input: InspectMatchWatcherActiveGameInput,
  ): Promise<InspectMatchWatcherActiveGameResult> {
    const now = clock.now();
    let account;
    try {
      account = await dependencies.dbActions.getRiotAccountByDiscordId(
        input.targetDiscordId,
      );
    } catch (error) {
      throw new MatchTrackingInspectionError("repository", error);
    }
    if (!account) {
      return {
        status: "riot_account_not_found",
        error: "Riot account not found",
      };
    }

    let activeGame;
    try {
      activeGame = await dependencies.riotApi.getActiveGameByPuuid(
        account.platform,
        account.puuid,
      );
    } catch (error) {
      throw new MatchTrackingInspectionError("riot_api", error);
    }
    if (activeGame) {
      await capturePendingRankSnapshots(input, account, activeGame);
    }

    let { notificationIntent, stateTransition } = activeGameStateTransition(
      input,
      activeGame,
      account,
      now,
    );
    if (
      activeGame && !notificationIntent &&
      shouldNotifySince(
        input.notificationLastInGameNotifiedAt ??
          input.lastInGameNotifiedAt,
        input.inGameNotifyIntervalMs,
        now,
      )
    ) {
      notificationIntent = { kind: "progress", activeGame };
      stateTransition = {
        state: {
          lastState: "IN_GAME",
          currentGameId: String(activeGame.gameId),
          lastInGameNotifiedAt: now,
        },
        messageIdField: "currentNotificationMessageId",
      };
    }
    if (stateTransition) {
      stateTransition.state.lastCheckedAt = now;
    }

    return {
      status: "ok",
      account,
      activeGame,
      notificationIntent,
      stateTransition,
    };
  }

  async function finalizeRankSnapshotsForResult(
    input: InspectMatchWatcherResultInput,
    account: RiotAccount,
    match: RiotMatch,
  ): Promise<MatchTrackingRankSummary | null> {
    const queueType = rankedQueueTypeByQueueId(match.info.queueId);
    if (!queueType) return null;

    try {
      const entries = await dependencies.riotApi.getLeagueEntriesByPuuid(
        account.platform,
        account.puuid,
      );
      const snapshots = await dependencies.dbActions.finalizeMatchRankSnapshots(
        {
          matchId: match.metadata.matchId,
          platform: account.platform,
          gameId: String(match.info.gameId),
          puuid: account.puuid,
          snapshots: rankSnapshotPayloadsFromEntries(entries, clock.now()),
        },
      );

      return {
        queueType,
        before: snapshots.before.find((snapshot) =>
          snapshot.queueType === queueType
        ) ?? null,
        after: snapshots.after.find((snapshot) =>
          snapshot.queueType === queueType
        ) ?? null,
      };
    } catch (error) {
      dependencies.logger.warn(
        "match_tracking.rank_snapshot_finalize_failed",
        {
          guildId: input.guildId,
          targetDiscordId: input.targetDiscordId,
          matchId: match.metadata.matchId,
        },
        error,
      );
      return null;
    }
  }

  async function resolveOpggMatchDetailForResult(
    input: InspectMatchWatcherResultInput,
    account: RiotAccount,
    match: RiotMatch,
  ) {
    const participant = match.info.participants.find((candidate) =>
      candidate.puuid === account.puuid
    );
    if (!participant) return null;

    try {
      return await dependencies.opggMatchDetailService.resolveAndSave({
        matchId: match.metadata.matchId,
        targetDiscordId: input.targetDiscordId,
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
      });
    } catch (error) {
      dependencies.logger.warn("match_tracking.opgg_detail_resolve_failed", {
        guildId: input.guildId,
        targetDiscordId: input.targetDiscordId,
        matchId: match.metadata.matchId,
      }, error);
      return null;
    }
  }

  async function inspectResult(
    input: InspectMatchWatcherResultInput,
  ): Promise<InspectMatchWatcherResult> {
    const now = clock.now();
    let account;
    try {
      account = await dependencies.dbActions.getRiotAccountByDiscordId(
        input.targetDiscordId,
      );
    } catch (error) {
      throw new MatchTrackingInspectionError("repository", error);
    }
    if (!account) {
      return {
        status: "riot_account_not_found",
        error: "Riot account not found",
      };
    }

    if (
      isResultFetchTimedOut(
        input.startedAt,
        input.resultFetchTimeoutMs,
        now,
      )
    ) {
      return {
        status: "ok",
        account,
        match: null,
        rankSummary: null,
        opggDetail: null,
        notificationIntent: { kind: "timeout", matchId: input.matchId },
        stateTransition: {
          state: {
            pendingResultMatchId: null,
            pendingResultNotificationMessageId: null,
            pendingResultStartedAt: null,
            lastCheckedAt: now,
          },
          messageIdField: null,
        },
      };
    }

    let match;
    try {
      match = await dependencies.riotApi.getMatchById(
        account.region,
        input.matchId,
      );
    } catch (error) {
      throw new MatchTrackingInspectionError("riot_api", error);
    }
    if (!match) {
      return {
        status: "ok",
        account,
        match: null,
        rankSummary: null,
        opggDetail: null,
        notificationIntent: null,
        stateTransition: {
          state: {
            pendingResultMatchId: input.matchId,
            pendingResultNotificationMessageId: input.messageId ?? null,
            pendingResultStartedAt: input.startedAt ?? null,
            lastCheckedAt: now,
          },
          messageIdField: null,
        },
      };
    }

    const rankSummary = await finalizeRankSnapshotsForResult(
      input,
      account,
      match,
    );
    const opggDetail = await resolveOpggMatchDetailForResult(
      input,
      account,
      match,
    );

    return {
      status: "ok",
      account,
      match,
      rankSummary,
      opggDetail,
      notificationIntent: {
        kind: "result",
        match,
        rankSummary,
        opggDetail,
      },
      stateTransition: {
        state: {
          pendingResultMatchId: null,
          pendingResultNotificationMessageId: null,
          pendingResultStartedAt: null,
          lastCheckedAt: now,
        },
        messageIdField: null,
      },
    };
  }

  return {
    inspectActiveGame,
    inspectResult,
  };
}
