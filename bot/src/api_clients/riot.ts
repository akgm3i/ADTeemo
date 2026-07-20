import type {
  ActiveGame,
  LeagueEntry,
  RiotMatch,
  RiotPlatform,
  RiotRegion,
} from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  failureFromResponse,
  type FailureResult,
  resultFromRequest,
  throwApiResponseError,
} from "./transport.ts";

export type RiotStaticDataResolveInput = {
  locale?: string;
  championIds?: number[];
  queueIds?: number[];
  mapIds?: number[];
  gameModes?: string[];
};
export type RiotStaticDataResolveData = {
  champions: Record<
    string,
    { name: string | null; iconUrl: string | null }
  >;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};
export type RiotStaticDataResolveResult =
  | { success: true; data: RiotStaticDataResolveData }
  | FailureResult;

export function createRiotApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function getActiveGameByPuuid(
    platform: RiotPlatform,
    puuid: string,
  ) {
    const res = await rpcClient.riot["active-games"][":platform"][":puuid"]
      .$get({
        param: { platform, puuid },
      });
    if (!res.ok) {
      await throwApiResponseError(res);
    }
    const body = await res.json() as { activeGame?: ActiveGame | null } | null;
    return body?.activeGame ?? null;
  }

  async function getMatchById(region: RiotRegion, matchId: string) {
    const res = await rpcClient.riot.matches[":region"][":matchId"].$get({
      param: { region, matchId },
    });
    if (!res.ok) {
      await throwApiResponseError(res);
    }
    const body = await res.json() as { match?: RiotMatch | null } | null;
    return body?.match ?? null;
  }

  async function getLeagueEntriesByPuuid(
    platform: RiotPlatform,
    puuid: string,
  ) {
    const res = await rpcClient.riot["league-entries"][":platform"][":puuid"]
      .$get({
        param: { platform, puuid },
      });
    if (!res.ok) {
      await throwApiResponseError(res);
    }
    const body = await res.json() as { entries?: LeagueEntry[] } | null;
    return body?.entries ?? [];
  }

  async function resolveRiotStaticData(
    payload: RiotStaticDataResolveInput,
  ): Promise<RiotStaticDataResolveResult> {
    return await resultFromRequest(
      () =>
        rpcClient.riot["static-data"].resolve.$post({
          json: payload,
        }),
      async (res) => {
        const data = await res.json() as RiotStaticDataResolveData;
        return { data };
      },
      failureFromResponse,
    );
  }

  return {
    getActiveGameByPuuid,
    getMatchById,
    getLeagueEntriesByPuuid,
    resolveRiotStaticData,
  };
}

export type RiotApiClient = ReturnType<typeof createRiotApiClient>;
