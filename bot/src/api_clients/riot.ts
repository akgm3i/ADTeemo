import { responseContracts } from "@adteemo/api/contract";
import type {
  RiotPlatform,
  RiotRegion,
  RiotStaticDataResolveData,
} from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  type FailureResult,
  readContractResponse,
  requestResult,
  throwApiResponseError,
} from "./transport.ts";
export type { RiotStaticDataResolveData };
export type RiotStaticDataResolveInput = {
  locale?: string;
  championIds?: number[];
  queueIds?: number[];
  mapIds?: number[];
  gameModes?: string[];
};
export type RiotStaticDataResolveResult = {
  success: true;
  data: RiotStaticDataResolveData;
} | FailureResult;

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
      await throwApiResponseError(
        res,
        "GET /riot/active-games/:platform/:puuid",
      );
    }
    return (await readContractResponse(responseContracts.activeGame, res))
      .activeGame;
  }

  async function getMatchById(region: RiotRegion, matchId: string) {
    const res = await rpcClient.riot.matches[":region"][":matchId"].$get({
      param: { region, matchId },
    });
    if (!res.ok) {
      await throwApiResponseError(res, "GET /riot/matches/:region/:matchId");
    }
    return (await readContractResponse(responseContracts.riotMatch, res)).match;
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
      await throwApiResponseError(
        res,
        "GET /riot/league-entries/:platform/:puuid",
      );
    }
    return (await readContractResponse(responseContracts.leagueEntries, res))
      .entries;
  }

  async function resolveRiotStaticData(
    payload: RiotStaticDataResolveInput,
  ): Promise<RiotStaticDataResolveResult> {
    const result = await requestResult(
      responseContracts.staticData,
      () =>
        rpcClient.riot["static-data"].resolve.$post({
          json: payload,
        }),
    );
    if (!result.success) return result;
    const { success, ...data } = result;
    return { success, data };
  }

  return {
    getActiveGameByPuuid,
    getMatchById,
    getLeagueEntriesByPuuid,
    resolveRiotStaticData,
  };
}

export type RiotApiClient = ReturnType<typeof createRiotApiClient>;
