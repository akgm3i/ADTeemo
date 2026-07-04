import type {
  ActiveGame,
  MatchRankSnapshot,
  MatchTrackingNotificationIntent,
  MatchTrackingRankSummary,
  MatchTrackingStateTransition,
  MatchWatcher,
  MatchWatcherState,
  MatchWatcherStatePatch,
  OpggMatchDetail,
  RiotAccount,
  RiotMatch,
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
  | {
    success: true;
    account: RiotAccount;
    activeGame: ActiveGame | null;
    notificationIntent: MatchTrackingNotificationIntent | null;
    stateTransition: MatchTrackingStateTransition | null;
  }
  | { success: false; error: string };
export type InspectMatchWatcherResultResult =
  | {
    success: true;
    account: RiotAccount;
    match: RiotMatch | null;
    rankSummary: MatchTrackingRankSummary | null;
    opggDetail: OpggMatchDetail | null;
    notificationIntent: MatchTrackingNotificationIntent | null;
    stateTransition: MatchTrackingStateTransition | null;
  }
  | { success: false; error: string };

function parseMatchRankSnapshot(
  snapshot: Omit<MatchRankSnapshot, "fetchedAt"> & {
    fetchedAt: string | Date;
  },
): MatchRankSnapshot {
  return {
    ...snapshot,
    fetchedAt: new Date(snapshot.fetchedAt),
  };
}

function parseMatchTrackingRankSummary(
  rankSummary:
    | (Omit<MatchTrackingRankSummary, "before" | "after"> & {
      before: Parameters<typeof parseMatchRankSnapshot>[0] | null;
      after: Parameters<typeof parseMatchRankSnapshot>[0] | null;
    })
    | null,
): MatchTrackingRankSummary | null {
  if (!rankSummary) return null;
  return {
    ...rankSummary,
    before: rankSummary.before
      ? parseMatchRankSnapshot(rankSummary.before)
      : null,
    after: rankSummary.after ? parseMatchRankSnapshot(rankSummary.after) : null,
  };
}

function parseOpggMatchDetail(
  detail:
    | (Omit<OpggMatchDetail, "providerCreatedAt"> & {
      providerCreatedAt: string | Date;
    })
    | null,
): OpggMatchDetail | null {
  if (!detail) return null;
  return {
    ...detail,
    providerCreatedAt: new Date(detail.providerCreatedAt),
  };
}

function parseMatchWatcherStatePatch(
  state: MatchWatcherStatePatch,
): MatchWatcherStatePatch {
  const parsed: MatchWatcherStatePatch = { ...state };
  if ("pendingResultStartedAt" in state) {
    parsed.pendingResultStartedAt = dateOrNull(state.pendingResultStartedAt);
  }
  if ("gameStartedAt" in state) {
    parsed.gameStartedAt = dateOrNull(state.gameStartedAt);
  }
  if ("lastCheckedAt" in state) {
    parsed.lastCheckedAt = dateOrNull(state.lastCheckedAt);
  }
  if ("lastInGameNotifiedAt" in state) {
    parsed.lastInGameNotifiedAt = dateOrNull(state.lastInGameNotifiedAt);
  }
  return parsed;
}

function parseMatchTrackingStateTransition(
  transition:
    | (Omit<MatchTrackingStateTransition, "state"> & {
      state: MatchWatcherStatePatch;
    })
    | null,
): MatchTrackingStateTransition | null {
  if (!transition) return null;
  return {
    ...transition,
    state: parseMatchWatcherStatePatch(transition.state),
  };
}

function parseMatchTrackingNotificationIntent(
  intent: MatchTrackingNotificationIntent | null,
  parsed: {
    match?: RiotMatch | null;
    rankSummary?: MatchTrackingRankSummary | null;
    opggDetail?: OpggMatchDetail | null;
  } = {},
): MatchTrackingNotificationIntent | null {
  if (!intent) return null;
  if (intent.kind !== "result") return intent;
  if (!parsed.match) return intent;
  return {
    kind: "result",
    match: parsed.match,
    rankSummary: parsed.rankSummary ?? null,
    opggDetail: parsed.opggDetail ?? null,
  };
}

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
      currentNotificationMessageId?: string | null;
      gameStartedAt?: Date | null;
      lastInGameNotifiedAt?: Date | null;
      notificationLastInGameNotifiedAt?: Date | null;
      inGameNotifyIntervalMs?: number;
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
          notificationIntent: MatchTrackingNotificationIntent | null;
          stateTransition: Parameters<
            typeof parseMatchTrackingStateTransition
          >[0];
        };
        return {
          account: parseRiotAccount(body.account),
          activeGame: body.activeGame,
          notificationIntent: parseMatchTrackingNotificationIntent(
            body.notificationIntent,
          ),
          stateTransition: parseMatchTrackingStateTransition(
            body.stateTransition,
          ),
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

  async function inspectMatchWatcherResult(
    guildId: string,
    targetDiscordId: string,
    payload: {
      matchId: string;
      messageId?: string | null;
      startedAt?: Date | null;
      resultFetchTimeoutMs?: number;
    },
  ): Promise<InspectMatchWatcherResultResult> {
    return await resultFromRequest(
      () =>
        rpcClient["match-watchers"][":guildId"][":targetDiscordId"].tracking
          .result.$post({
            param: { guildId, targetDiscordId },
            json: payload,
          }),
      async (res) => {
        const body = await res.json() as {
          account: Parameters<typeof parseRiotAccount>[0];
          match: RiotMatch | null;
          rankSummary: Parameters<typeof parseMatchTrackingRankSummary>[0];
          opggDetail: Parameters<typeof parseOpggMatchDetail>[0];
          notificationIntent: MatchTrackingNotificationIntent | null;
          stateTransition: Parameters<
            typeof parseMatchTrackingStateTransition
          >[0];
        };
        const rankSummary = parseMatchTrackingRankSummary(body.rankSummary);
        const opggDetail = parseOpggMatchDetail(body.opggDetail);
        return {
          account: parseRiotAccount(body.account),
          match: body.match,
          rankSummary,
          opggDetail,
          notificationIntent: parseMatchTrackingNotificationIntent(
            body.notificationIntent,
            { match: body.match, rankSummary, opggDetail },
          ),
          stateTransition: parseMatchTrackingStateTransition(
            body.stateTransition,
          ),
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
    inspectMatchWatcherResult,
    updateMatchWatcherState,
  };
}

export type MatchWatchersApiClient = ReturnType<
  typeof createMatchWatchersApiClient
>;
