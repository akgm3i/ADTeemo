import type {
  ActiveGame,
  LeagueEntry,
  MatchTrackingRankSummary,
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
};
export type InspectMatchWatcherActiveGameResult =
  | {
    status: "ok";
    account: RiotAccount;
    activeGame: ActiveGame | null;
  }
  | {
    status: "riot_account_not_found";
    error: string;
  };
export type InspectMatchWatcherResultInput = {
  guildId: string;
  targetDiscordId: string;
  matchId: string;
};
export type InspectMatchWatcherResult =
  | {
    status: "ok";
    account: RiotAccount;
    match: RiotMatch | null;
    rankSummary: MatchTrackingRankSummary | null;
    opggDetail: OpggMatchDetail | null;
  }
  | {
    status: "riot_account_not_found";
    error: string;
  };

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
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async function inspectActiveGame(
    input: InspectMatchWatcherActiveGameInput,
  ): Promise<InspectMatchWatcherActiveGameResult> {
    const account = await dependencies.dbActions.getRiotAccountByDiscordId(
      input.targetDiscordId,
    );
    if (!account) {
      return {
        status: "riot_account_not_found",
        error: "Riot account not found",
      };
    }

    const activeGame = await dependencies.riotApi.getActiveGameByPuuid(
      account.platform,
      account.puuid,
    );
    if (activeGame) {
      await capturePendingRankSnapshots(input, account, activeGame);
    }

    return {
      status: "ok",
      account,
      activeGame,
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
          error: error instanceof Error ? error.message : String(error),
        },
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
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async function inspectResult(
    input: InspectMatchWatcherResultInput,
  ): Promise<InspectMatchWatcherResult> {
    const account = await dependencies.dbActions.getRiotAccountByDiscordId(
      input.targetDiscordId,
    );
    if (!account) {
      return {
        status: "riot_account_not_found",
        error: "Riot account not found",
      };
    }

    const match = await dependencies.riotApi.getMatchById(
      account.region,
      input.matchId,
    );
    if (!match) {
      return {
        status: "ok",
        account,
        match: null,
        rankSummary: null,
        opggDetail: null,
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
    };
  }

  return {
    inspectActiveGame,
    inspectResult,
  };
}
