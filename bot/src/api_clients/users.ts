import { responseContracts } from "@adteemo/api/contract";
import type { Lane, RiotPlatform, RiotRegion } from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";

export function createUsersApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function linkAccountByRiotId(
    discordId: string,
    gameName: string,
    tagLine: string,
    platform?: RiotPlatform,
    region?: RiotRegion,
  ) {
    return await requestResult(
      responseContracts.linkAccount,
      () =>
        rpcClient.users["link-by-riot-id"].$patch({
          json: { discordId, gameName, tagLine, platform, region },
        }),
    );
  }

  async function getRiotAccount(discordId: string, puuid?: string) {
    return await requestResult(
      responseContracts.riotAccount,
      () =>
        rpcClient.users[":userId"]["riot-account"].$get({
          param: { userId: discordId },
          query: puuid ? { puuid } : {},
        }),
    );
  }

  async function getRiotAccounts(discordId: string) {
    return await requestResult(
      responseContracts.riotAccounts,
      () =>
        rpcClient.users[":userId"]["riot-accounts"].$get({
          param: { userId: discordId },
        }),
    );
  }

  async function setMainRiotAccount(discordId: string, puuid: string) {
    return await requestResult(
      responseContracts.mainRiotAccount,
      () =>
        rpcClient.users[":userId"]["riot-accounts"][":puuid"].main.$put({
          param: { userId: discordId, puuid },
        }),
    );
  }

  async function deleteRiotAccount(discordId: string, puuid: string) {
    return await requestResult(
      responseContracts.deleteRiotAccount,
      () =>
        rpcClient.users[":userId"]["riot-accounts"][":puuid"].$delete({
          param: { userId: discordId, puuid },
        }),
    );
  }

  async function setMainRole(userId: string, guildId: string, role: Lane) {
    return await requestResult(
      responseContracts.mainRole,
      () =>
        rpcClient.users[":userId"]["main-role"].$put({
          param: { userId },
          json: { guildId, role },
        }),
    );
  }

  return {
    linkAccountByRiotId,
    getRiotAccount,
    getRiotAccounts,
    setMainRiotAccount,
    deleteRiotAccount,
    setMainRole,
  };
}

export type UsersApiClient = ReturnType<typeof createUsersApiClient>;
