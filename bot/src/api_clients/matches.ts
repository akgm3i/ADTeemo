import { z } from "zod";
import {
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  resolveOpggMatchDetailSchema,
  upsertPendingRankSnapshotsSchema,
} from "@adteemo/api/contract";
import type { RiotPlatform } from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  COMMUNICATION_ERROR,
  logCommunicationError,
  readErrorMessage,
  resultFromRequest,
  successOnly,
  unexpectedResponseError,
} from "./transport.ts";

export type MatchParticipant = z.infer<typeof createParticipantSchema>;
export type RankSnapshotPayload = z.infer<
  typeof upsertPendingRankSnapshotsSchema
>["snapshots"][number];
export type FinalizedRankSnapshot = {
  matchId: string;
  puuid: string;
  platform: RiotPlatform;
  queueType: RankSnapshotPayload["queueType"];
  phase: "before" | "after";
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
};
export type ResolveOpggMatchDetailPayload = z.infer<
  typeof resolveOpggMatchDetailSchema
>;
export type OpggMatchDetail = {
  provider: "opgg";
  providerRegion: string;
  providerMatchId: string;
  detailUrl: string;
  providerCreatedAt: Date;
  averageTier: string | null;
  participant?: {
    puuid: string;
    participantId: number | null;
    laneScore: number | null;
  };
};
export type ResolveOpggMatchDetailResult =
  | { success: true; detail: OpggMatchDetail | null }
  | { success: false; error: string };

function parseRankSnapshot(
  snapshot: Omit<FinalizedRankSnapshot, "fetchedAt"> & {
    fetchedAt: string | Date;
  },
): FinalizedRankSnapshot {
  return {
    ...snapshot,
    fetchedAt: new Date(snapshot.fetchedAt),
  };
}

export function createMatchesApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function createMatchParticipant(
    matchId: string,
    participant: MatchParticipant,
  ) {
    try {
      const res = await rpcClient.matches[":matchId"].participants.$post({
        param: { matchId },
        json: participant,
      });

      if (!res.ok) {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      }

      const data = await res.json() as { id?: unknown };
      if (typeof data.id !== "number") {
        console.error("API response missing participant id", data);
        return {
          success: false,
          error: "API response missing participant id",
        };
      }

      return { success: true, id: data.id };
    } catch (error) {
      logCommunicationError(error);
      return { success: false, error: COMMUNICATION_ERROR };
    }
  }

  async function upsertPendingRankSnapshots(
    payload: z.infer<typeof upsertPendingRankSnapshotsSchema>,
  ) {
    return await resultFromRequest(
      () =>
        rpcClient.matches["rank-snapshots"].pending.$post({
          json: payload,
        }),
      successOnly,
    );
  }

  async function finalizeRankSnapshots(
    matchId: string,
    payload: z.infer<typeof finalizeRankSnapshotsSchema>,
  ) {
    return await resultFromRequest(
      () =>
        rpcClient.matches[":matchId"]["rank-snapshots"].finalize.$post({
          param: { matchId },
          json: payload,
        }),
      async (res) => {
        const body = await res.json() as {
          snapshots: {
            before: Parameters<typeof parseRankSnapshot>[0][];
            after: Parameters<typeof parseRankSnapshot>[0][];
          };
        };
        return {
          snapshots: {
            before: body.snapshots.before.map(parseRankSnapshot),
            after: body.snapshots.after.map(parseRankSnapshot),
          },
        };
      },
    );
  }

  async function resolveOpggMatchDetail(
    matchId: string,
    payload: ResolveOpggMatchDetailPayload,
  ): Promise<ResolveOpggMatchDetailResult> {
    return await resultFromRequest(
      () =>
        rpcClient.matches[":matchId"]["external-details"].opgg.resolve.$post({
          param: { matchId },
          json: payload,
        }),
      async (res) => {
        const body = await res.json() as {
          detail?:
            | (Omit<OpggMatchDetail, "providerCreatedAt"> & {
              providerCreatedAt: string | Date;
            })
            | null;
        };
        return {
          detail: body.detail == null ? null : {
            ...body.detail,
            providerCreatedAt: new Date(body.detail.providerCreatedAt),
          },
        };
      },
      async (res) => ({
        success: false,
        error: await readErrorMessage(res),
      }),
    );
  }

  return {
    createMatchParticipant,
    upsertPendingRankSnapshots,
    finalizeRankSnapshots,
    resolveOpggMatchDetail,
  };
}

export type MatchesApiClient = ReturnType<typeof createMatchesApiClient>;
