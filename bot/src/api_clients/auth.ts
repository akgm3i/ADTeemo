import { type ApiRpcClient, resultFromRequest } from "./transport.ts";

export function createAuthApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function getLoginUrl(discordId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.auth.rso["login-url"].$get({
          query: { discordId },
        }),
      async (res) => {
        const body = await res.json() as { url: string };
        return { url: body.url };
      },
    );
  }

  return { getLoginUrl };
}

export type AuthApiClient = ReturnType<typeof createAuthApiClient>;
