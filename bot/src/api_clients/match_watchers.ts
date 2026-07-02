import type {
  ActiveGame,
  MatchWatcher,
  MatchWatcherState,
  RiotAccount,
} from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  dateOrNull,
  readErrorMessage,
  resultFromRequest,
  successOnly,
  unexpectedResponseError,
} from "./transport.ts";

function parseMatchWatcher(
  watcher:
    & {
      createdAt: string | Date;
      updatedAt: string | Date | null;
      gameStartedAt: string | Date | null;
      lastCheckedAt: string | Date | null;
      lastInGameNotifiedAt: string | Date | null;
      pendingResultStartedAt: string | Date | null;
    }
    & Omit<
      MatchWatcher,
      | "createdAt"
      | "updatedAt"
      | "gameStartedAt"
      | "lastCheckedAt"
      | "lastInGameNotifiedAt"
      | "pendingResultStartedAt"
    >,
): MatchWatcher {
  return {
    ...watcher,
    createdAt: new Date(watcher.createdAt),
    updatedAt: dateOrNull(watcher.updatedAt),
    gameStartedAt: dateOrNull(watcher.gameStartedAt),
    lastCheckedAt: dateOrNull(watcher.lastCheckedAt),
    lastInGameNotifiedAt: dateOrNull(watcher.lastInGameNotifiedAt),
    pendingResultStartedAt: dateOrNull(watcher.pendingResultStartedAt),
  };
}

function parseRiotAccount(
  account:
    & {
      createdAt: string | Date;
      updatedAt: string | Date | null;
    }
    & Omit<RiotAccount, "createdAt" | "updatedAt">,
): RiotAccount {
  return {
    ...account,
    createdAt: new Date(account.createdAt),
    updatedAt: dateOrNull(account.updatedAt),
  };
}

export type InspectMatchWatcherActiveGameResult =
  | { success: true; account: RiotAccount; activeGame: ActiveGame | null }
  | { success: false; error: string };

export function createMatchWatchersApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function watchMatch(watcher: {
    guildId: string;
    targetDiscordId: string;
    requesterId: string;
    channelId: string;
  }) {
    return await resultFromRequest(
      () => rpcClient["match-watchers"].$post({ json: watcher }),
      successOnly,
      async (res) => {
        if (res.status === 404 || res.status === 409) {
          return {
            success: false,
            error: await readErrorMessage(res),
            status: res.status,
          };
        }

        throw unexpectedResponseError(res);
      },
    );
  }

  async function unwatchMatch(guildId: string, targetDiscordId: string) {
    return await resultFromRequest(
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].$delete({
          param: { guildId, targetDiscordId },
        }),
      successOnly,
    );
  }

  async function getEnabledMatchWatchers() {
    return await resultFromRequest(
      () => rpcClient["match-watchers"].enabled.$get(),
      async (res) => {
        const body = await res.json() as {
          watchers: Parameters<typeof parseMatchWatcher>[0][];
        };
        return {
          watchers: body.watchers.map(parseMatchWatcher),
        };
      },
    );
  }

  async function getEnabledMatchWatchersByGuild(guildId: string) {
    return await resultFromRequest(
      () =>
        rpcClient["match-watchers"].enabled[":guildId"].$get({
          param: { guildId },
        }),
      async (res) => {
        const body = await res.json() as {
          watchers: Parameters<typeof parseMatchWatcher>[0][];
        };
        return {
          watchers: body.watchers.map(parseMatchWatcher),
        };
      },
    );
  }

  async function updateMatchWatcherState(
    guildId: string,
    targetDiscordId: string,
    state: {
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
    return await resultFromRequest(
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].state
          .$patch({
            param: { guildId, targetDiscordId },
            json: state,
          }),
      successOnly,
    );
  }

  async function inspectMatchWatcherActiveGame(
    guildId: string,
    targetDiscordId: string,
    state: {
      lastState: MatchWatcherState;
      currentGameId: string | null;
    },
  ): Promise<InspectMatchWatcherActiveGameResult> {
    return await resultFromRequest(
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].tracking[
          "active-game"
        ].$post({
          param: { guildId, targetDiscordId },
          json: state,
        }),
      async (res) => {
        const body = await res.json() as {
          account: Parameters<typeof parseRiotAccount>[0];
          activeGame: ActiveGame | null;
        };
        return {
          account: parseRiotAccount(body.account),
          activeGame: body.activeGame,
        };
      },
      async (res) => {
        if (res.status === 404 || res.status === 502) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      },
    );
  }

  return {
    watchMatch,
    unwatchMatch,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    inspectMatchWatcherActiveGame,
    updateMatchWatcherState,
  };
}

export type MatchWatchersApiClient = ReturnType<
  typeof createMatchWatchersApiClient
>;
