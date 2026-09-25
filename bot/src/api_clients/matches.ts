import type { z } from "zod";
import {
  finalizeRankSnapshotsSchema,
  recordCustomMatchSchema,
  responseContracts,
  upsertPendingRankSnapshotsSchema,
} from "@adteemo/api/contract";
import type {
  CustomMatchStat,
  MatchRankSnapshot,
  OpggMatchDetail,
  RankSnapshotPayload,
  RecordCustomMatchInput,
  ResolveOpggMatchDetailPayload,
} from "@adteemo/api/contract";
export type {
  CustomMatchStat,
  OpggMatchDetail,
  RankSnapshotPayload,
  RecordCustomMatchInput,
  ResolveOpggMatchDetailPayload,
};
export type FinalizedRankSnapshot = MatchRankSnapshot;
export type ResolveOpggMatchDetailResult = {
  success: true;
  detail: OpggMatchDetail | null;
} | FailureResult;
import {
  type ApiRpcClient,
  type FailureResult,
  requestResult,
} from "./transport.ts";

export function createMatchesApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function recordCustomMatch(
    input: z.infer<typeof recordCustomMatchSchema>,
  ) {
    return await requestResult(
      responseContracts.recordMatch,
      () => rpcClient.matches.custom.$post({ json: input }),
    );
  }

  async function upsertPendingRankSnapshots(
    payload: z.infer<typeof upsertPendingRankSnapshotsSchema>,
  ) {
    return await requestResult(
      responseContracts.pendingRankSnapshots,
      () =>
        rpcClient.matches["rank-snapshots"].pending.$post({
          json: payload,
        }),
    );
  }

  async function finalizeRankSnapshots(
    matchId: string,
    payload: z.infer<typeof finalizeRankSnapshotsSchema>,
  ) {
    return await requestResult(
      responseContracts.finalizeRankSnapshots,
      () =>
        rpcClient.matches[":matchId"]["rank-snapshots"].finalize.$post({
          param: { matchId },
          json: payload,
        }),
    );
  }

  async function resolveOpggMatchDetail(
    matchId: string,
    payload: ResolveOpggMatchDetailPayload,
  ): Promise<ResolveOpggMatchDetailResult> {
    return await requestResult(
      responseContracts.opggDetail,
      () =>
        rpcClient.matches[":matchId"]["external-details"].opgg.resolve.$post({
          param: { matchId },
          json: payload,
        }),
    );
  }

  return {
    recordCustomMatch,
    upsertPendingRankSnapshots,
    finalizeRankSnapshots,
    resolveOpggMatchDetail,
  };
}

export type MatchesApiClient = ReturnType<typeof createMatchesApiClient>;
