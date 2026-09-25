import {
  responseContracts,
  type RiotPlatform,
  type RiotRegion,
} from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";

export function createAuthApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function getLoginUrl(
    discordId: string,
    guildId: string,
    platform: RiotPlatform = "jp1",
    region: RiotRegion = "asia",
  ) {
    return await requestResult(
      responseContracts.loginUrl,
      () =>
        rpcClient.auth.rso["login-url"].$get({
          query: { discordId, guildId, platform, region },
        }),
    );
  }

  return { getLoginUrl };
}

export type AuthApiClient = ReturnType<typeof createAuthApiClient>;
