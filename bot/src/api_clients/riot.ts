import type { RiotPlatform, RiotRegion } from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  readErrorMessage,
  resultFromRequest,
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
  | { success: false; error: string };

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
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.activeGame;
  }

  async function getMatchById(region: RiotRegion, matchId: string) {
    const res = await rpcClient.riot.matches[":region"][":matchId"].$get({
      param: { region, matchId },
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.match;
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
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.entries;
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
      async (res) => ({
        success: false,
        error: await readErrorMessage(res),
      }),
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
