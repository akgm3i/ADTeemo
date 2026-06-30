import { type ApiRpcClient, resultFromRequest } from "./transport.ts";

export function createHealthApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function checkHealth() {
    return await resultFromRequest(
      () => rpcClient.health.$get(),
      async (res) => {
        const body = await res.json() as { message: string };
        return { message: body.message };
      },
    );
  }

  return { checkHealth };
}

export type HealthApiClient = ReturnType<typeof createHealthApiClient>;
