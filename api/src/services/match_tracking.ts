import type {
  ActiveGame,
  LeagueEntry,
  MatchWatcherState,
  RankSnapshotPayload,
  RiotAccount,
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
  "getRiotAccountByDiscordId" | "upsertPendingRankSnapshots"
>;
type MatchTrackingInspectionRiotApi = Pick<
  AppDependencies["riotApi"],
  "getActiveGameByPuuid" | "getLeagueEntriesByPuuid"
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

  return {
    inspectActiveGame,
  };
}
