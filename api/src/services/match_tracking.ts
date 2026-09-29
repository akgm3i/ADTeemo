import { riotPlatformForMatchId } from "../contract/riot_routing.ts";
import type {
  ActiveGame,
  LeagueEntry,
  MatchTrackingRankSummary,
  OpggMatchDetail,
  RiotAccount,
  RiotMatch,
} from "../contract/mod.ts";
import type { AppDependencies } from "../dependencies.ts";

import {
  rankedQueueTypeByQueueId,
  rankSnapshotPayloadsFromEntries,
} from "../contract/ranked_snapshots.ts";

type MatchTrackingInspectionDbActions = Pick<
  AppDependencies["dbActions"],
  | "getRiotAccountByDiscordId"
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
  inspectionBatchId?: string;
  guildId: string;
  targetDiscordId: string;
  riotAccountPuuid?: string;
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
  inspectionBatchId?: string;
  guildId: string;
  targetDiscordId: string;
  riotAccountPuuid?: string;
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

export class MatchTrackingInspectionError extends Error {
  constructor(
    readonly source: "repository" | "riot_api",
    cause: unknown,
  ) {
    super("Match tracking inspection failed", { cause });
    this.name = "MatchTrackingInspectionError";
  }
}

// Reuse source data only within an explicit Bot tick. Never cache watcher-specific
// decisions. Bounds reclaim batches abandoned by a stopped or restarted worker.
function batchSource<T>(now: () => number) {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  return (
    batchId: string | undefined,
    scope: string[],
    fetch: () => Promise<T>,
  ) => {
    if (!batchId) return fetch();
    const at = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key);
    }
    const key = JSON.stringify([batchId, ...scope]);
    const cached = entries.get(key);
    if (cached) return cached.value;
    if (entries.size >= 1000) entries.delete(entries.keys().next().value!);
    const value = fetch();
    entries.set(key, { expiresAt: at + 300_000, value });
    return value;
  };
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
  const nowMs = () => clock.now().getTime();
  const activeSource = batchSource<ActiveGame | null>(nowMs);
  const matchSource = batchSource<RiotMatch | null>(nowMs);
  const leagueSource = batchSource<LeagueEntry[]>(nowMs);

  async function inspectActiveGame(
    input: InspectMatchWatcherActiveGameInput,
  ): Promise<InspectMatchWatcherActiveGameResult> {
    let account;
    try {
      account = input.riotAccountPuuid === undefined
        ? await dependencies.dbActions.getRiotAccountByDiscordId(
          input.targetDiscordId,
        )
        : await dependencies.dbActions.getRiotAccountByDiscordId(
          input.targetDiscordId,
          input.riotAccountPuuid,
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
      activeGame = await activeSource(
        input.inspectionBatchId,
        [account.platform, account.puuid],
        () =>
          dependencies.riotApi.getActiveGameByPuuid(
            account.platform,
            account.puuid,
          ),
      );
    } catch (error) {
      throw new MatchTrackingInspectionError("riot_api", error);
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
      const entries = await leagueSource(
        input.inspectionBatchId,
        [account.platform, account.puuid, "after", input.matchId],
        () =>
          dependencies.riotApi.getLeagueEntriesByPuuid(
            account.platform,
            account.puuid,
          ),
      );
      const snapshots = await dependencies.dbActions.finalizeMatchRankSnapshots(
        {
          matchId: match.metadata.matchId,
          platform: riotPlatformForMatchId(match.metadata.matchId) ??
            account.platform,
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
    let account;
    try {
      account = input.riotAccountPuuid === undefined
        ? await dependencies.dbActions.getRiotAccountByDiscordId(
          input.targetDiscordId,
        )
        : await dependencies.dbActions.getRiotAccountByDiscordId(
          input.targetDiscordId,
          input.riotAccountPuuid,
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

    let match;
    try {
      match = await matchSource(
        input.inspectionBatchId,
        [account.region, input.matchId],
        () => dependencies.riotApi.getMatchById(account.region, input.matchId),
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
