import { responseContracts } from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";

export function createHealthApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function checkHealth() {
    return await requestResult(
      responseContracts.health,
      () => rpcClient.health.$get(),
    );
  }

  return { checkHealth };
}

export type HealthApiClient = ReturnType<typeof createHealthApiClient>;
