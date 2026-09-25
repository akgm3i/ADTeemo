import {
  type CustomGameSettings,
  responseContracts,
} from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";
export function createGuildSettingsApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  const resource = rpcClient["guild-settings"][":guildId"]["custom-game"];
  return {
    getCustomGameSettings: (guildId: string) =>
      requestResult(
        responseContracts.getCustomGameSettings,
        () => resource.$get({ param: { guildId } }),
      ),
    setCustomGameSettings: (guildId: string, json: CustomGameSettings) =>
      requestResult(
        responseContracts.setCustomGameSettings,
        () => resource.$put({ param: { guildId }, json }),
      ),
  };
}
export type GuildSettingsApiClient = ReturnType<
  typeof createGuildSettingsApiClient
>;
