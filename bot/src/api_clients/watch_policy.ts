import { responseContracts } from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";
export function createWatchPolicyApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  return {
    getGuildMatchWatchSettings: (guildId: string) =>
      requestResult(
        responseContracts.watchSettings,
        () =>
          rpcClient["watch-policy"][":guildId"].settings.$get({
            param: { guildId },
          }),
      ),
    setGuildMatchWatchSettings: (
      settings: {
        guildId: string;
        enabled: boolean;
        notificationChannelId: string | null;
      },
    ) =>
      requestResult(
        responseContracts.configureWatchSettings,
        () =>
          rpcClient["watch-policy"][":guildId"].settings.$put({
            param: { guildId: settings.guildId },
            json: {
              enabled: settings.enabled,
              notificationChannelId: settings.notificationChannelId,
            },
          }),
      ),
    syncGuildMatchWatchMembers: (guildId: string, memberDiscordIds: string[]) =>
      requestResult(
        responseContracts.watchMembers,
        () =>
          rpcClient["watch-policy"][":guildId"].members.$put({
            param: { guildId },
            json: { memberDiscordIds },
          }),
      ),
    setMatchWatchOptOut: (
      guildId: string,
      discordId: string,
      optOut: boolean,
    ) =>
      requestResult(
        responseContracts.watchPreference,
        () =>
          rpcClient["watch-policy"][":guildId"].preferences[":discordId"].$put({
            param: { guildId, discordId },
            json: { optOut },
          }),
      ),
  };
}
export type WatchPolicyApiClient = ReturnType<
  typeof createWatchPolicyApiClient
>;
