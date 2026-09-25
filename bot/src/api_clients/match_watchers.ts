import { responseContracts } from "@adteemo/api/contract";
import type {
  ActiveGame,
  MatchTrackingNotificationIntent,
  MatchTrackingRankSummary,
  MatchTrackingStateTransition,
  MatchWatcherState,
  OpggMatchDetail,
  RiotAccount,
  RiotMatch,
} from "@adteemo/api/contract";
export type InspectMatchWatcherActiveGameResult = {
  success: true;
  account: RiotAccount;
  activeGame: ActiveGame | null;
  notificationIntent: MatchTrackingNotificationIntent | null;
  stateTransition: MatchTrackingStateTransition | null;
} | FailureResult;
export type InspectMatchWatcherResultResult = {
  success: true;
  account: RiotAccount;
  match: RiotMatch | null;
  rankSummary: MatchTrackingRankSummary | null;
  opggDetail: OpggMatchDetail | null;
  notificationIntent: MatchTrackingNotificationIntent | null;
  stateTransition: MatchTrackingStateTransition | null;
} | FailureResult;
import {
  type ApiRpcClient,
  type FailureResult,
  requestResult,
} from "./transport.ts";

export function createMatchWatchersApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function watchMatch(watcher: {
    guildId: string;
    targetDiscordId: string;
    requesterId: string;
    channelId: string;
  }) {
    return await requestResult(
      responseContracts.watchMatch,
      () => rpcClient["match-watchers"].$post({ json: watcher }),
    );
  }

  async function unwatchMatch(guildId: string, targetDiscordId: string) {
    return await requestResult(
      responseContracts.unwatchMatch,
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].$delete({
          param: { guildId, targetDiscordId },
        }),
    );
  }

  async function getEnabledMatchWatchers() {
    return await requestResult(
      responseContracts.watchers,
      () => rpcClient["match-watchers"].enabled.$get(),
    );
  }

  async function getEnabledMatchWatchersByGuild(guildId: string) {
    return await requestResult(
      responseContracts.guildWatchers,
      () =>
        rpcClient["match-watchers"].enabled[":guildId"].$get({
          param: { guildId },
        }),
    );
  }

  async function updateMatchWatcherState(
    guildId: string,
    targetDiscordId: string,
    state: {
      riotAccountPuuid?: string;
      lastState: MatchWatcherState;
      currentGameId?: string | null;
      currentMatchId?: string | null;
      currentNotificationMessageId?: string | null;
      pendingResultMatchId?: string | null;
      pendingResultNotificationMessageId?: string | null;
      pendingResultStartedAt?: Date | null;
      gameStartedAt?: Date | null;
      lastCheckedAt?: Date | null;
      lastInGameNotifiedAt?: Date | null;
    },
  ) {
    return await requestResult(
      responseContracts.watcherState,
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].state
          .$patch({
            param: { guildId, targetDiscordId },
            json: state,
          }),
    );
  }

  async function inspectMatchWatcherActiveGame(
    guildId: string,
    targetDiscordId: string,
    state: {
      inspectionBatchId?: string;
      riotAccountPuuid?: string;
      lastState: MatchWatcherState;
      currentGameId: string | null;
      currentNotificationMessageId?: string | null;
      gameStartedAt?: Date | null;
      lastInGameNotifiedAt?: Date | null;
      notificationLastInGameNotifiedAt?: Date | null;
      inGameNotifyIntervalMs?: number;
    },
  ): Promise<InspectMatchWatcherActiveGameResult> {
    return await requestResult(
      responseContracts.inspectActiveGame,
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].tracking[
          "active-game"
        ].$post({
          param: { guildId, targetDiscordId },
          json: state,
        }),
    );
  }

  async function inspectMatchWatcherResult(
    guildId: string,
    targetDiscordId: string,
    payload: {
      inspectionBatchId?: string;
      riotAccountPuuid?: string;
      matchId: string;
      messageId?: string | null;
      startedAt?: Date | null;
      resultFetchTimeoutMs?: number;
    },
  ): Promise<InspectMatchWatcherResultResult> {
    return await requestResult(
      responseContracts.inspectResult,
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].tracking
          .result.$post({
            param: { guildId, targetDiscordId },
            json: payload,
          }),
    );
  }

  return {
    watchMatch,
    unwatchMatch,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    inspectMatchWatcherActiveGame,
    inspectMatchWatcherResult,
    updateMatchWatcherState,
  };
}

export type MatchWatchersApiClient = ReturnType<
  typeof createMatchWatchersApiClient
>;
