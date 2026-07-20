import type {
  Lane,
  RiotAccount,
  RiotPlatform,
  RiotRegion,
} from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  dateOrNull,
  failureFromResponse,
  resultFromRequest,
  successOnly,
} from "./transport.ts";

function parseRiotAccount(
  account: {
    createdAt: string | Date;
    updatedAt: string | Date | null;
  } & Omit<RiotAccount, "createdAt" | "updatedAt">,
): RiotAccount {
  return {
    ...account,
    createdAt: new Date(account.createdAt),
    updatedAt: dateOrNull(account.updatedAt),
  };
}

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
    return await resultFromRequest(
      () =>
        rpcClient.users["link-by-riot-id"].$patch({
          json: { discordId, gameName, tagLine, platform, region },
        }),
      successOnly,
      failureFromResponse,
    );
  }

  async function getRiotAccount(discordId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.users[":userId"]["riot-account"].$get({
          param: { userId: discordId },
        }),
      async (res) => {
        const body = await res.json() as {
          account: Parameters<typeof parseRiotAccount>[0];
        };
        return { account: parseRiotAccount(body.account) };
      },
      failureFromResponse,
    );
  }

  async function setMainRole(userId: string, guildId: string, role: Lane) {
    return await resultFromRequest(
      () =>
        rpcClient.users[":userId"]["main-role"].$put({
          param: { userId },
          json: { guildId, role },
        }),
      successOnly,
    );
  }

  return {
    linkAccountByRiotId,
    getRiotAccount,
    setMainRole,
  };
}

export type UsersApiClient = ReturnType<typeof createUsersApiClient>;
