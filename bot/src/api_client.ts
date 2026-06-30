import type { Lane } from "@adteemo/api/contract";
import type {
  Event,
  MatchWatcher,
  MatchWatcherState,
  RiotAccount,
  RiotPlatform,
  RiotRegion,
} from "@adteemo/api/contract";
import type { Client } from "@adteemo/api/contract";
import { z } from "zod";
import {
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  resolveOpggMatchDetailSchema,
  upsertPendingRankSnapshotsSchema,
} from "@adteemo/api/contract";

const COMMUNICATION_ERROR = "Failed to communicate with API";

type ApiRpcClient = Client;
type FailureResult = { success: false; error: string };
type ApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<T>;
};

function dateOrNull(value: string | Date | null) {
  return value === null ? null : new Date(value);
}

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

function parseEvent(
  event: {
    scheduledStartAt: string | Date;
    createdAt: string | Date;
  } & Omit<Event, "scheduledStartAt" | "createdAt">,
): Event {
  return {
    ...event,
    scheduledStartAt: new Date(event.scheduledStartAt),
    createdAt: new Date(event.createdAt),
  };
}

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

export type MatchParticipant = z.infer<typeof createParticipantSchema>;
export type RankSnapshotPayload = z.infer<
  typeof upsertPendingRankSnapshotsSchema
>["snapshots"][number];
export type FinalizedRankSnapshot = {
  matchId: string;
  puuid: string;
  platform: RiotPlatform;
  queueType: RankSnapshotPayload["queueType"];
  phase: "before" | "after";
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
};
export type RiotStaticDataResolveInput = {
  locale?: string;
  championIds?: number[];
  queueIds?: number[];
  mapIds?: number[];
  gameModes?: string[];
};
export type RiotStaticDataResolveData = {
  champions: Record<
    string,
    { name: string | null; iconUrl: string | null }
  >;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};
export type RiotStaticDataResolveResult =
  | { success: true; data: RiotStaticDataResolveData }
  | { success: false; error: string };
export type ResolveOpggMatchDetailPayload = z.infer<
  typeof resolveOpggMatchDetailSchema
>;
export type OpggMatchDetail = {
  provider: "opgg";
  providerRegion: string;
  providerMatchId: string;
  detailUrl: string;
  providerCreatedAt: Date;
  averageTier: string | null;
  participant?: {
    puuid: string;
    participantId: number | null;
    laneScore: number | null;
  };
};
export type ResolveOpggMatchDetailResult =
  | { success: true; detail: OpggMatchDetail | null }
  | { success: false; error: string };

function parseRankSnapshot(
  snapshot: Omit<FinalizedRankSnapshot, "fetchedAt"> & {
    fetchedAt: string | Date;
  },
): FinalizedRankSnapshot {
  return {
    ...snapshot,
    fetchedAt: new Date(snapshot.fetchedAt),
  };
}

async function readErrorMessage(res: ApiResponse): Promise<string> {
  const body = await res.json() as { error?: string };
  return body.error ?? COMMUNICATION_ERROR;
}

function logCommunicationError(error: unknown) {
  console.error(COMMUNICATION_ERROR, error);
}

function unexpectedResponseError(res: ApiResponse): Error {
  return new Error(`Unexpected response: ${res.status} ${res.statusText}`);
}

async function resultFromRequest<
  T extends Record<string, unknown>,
  F extends FailureResult = FailureResult,
>(
  request: () => Promise<ApiResponse>,
  parseSuccess: (res: ApiResponse) => Promise<T> | T,
  handleHttpError?: (
    res: ApiResponse,
  ) => Promise<F> | F,
): Promise<({ success: true } & T) | F | FailureResult> {
  try {
    const res = await request();

    if (!res.ok) {
      if (handleHttpError) {
        return await handleHttpError(res);
      }

      throw unexpectedResponseError(res);
    }

    return { success: true, ...await parseSuccess(res) };
  } catch (error) {
    logCommunicationError(error);
    return { success: false, error: COMMUNICATION_ERROR };
  }
}

function successOnly() {
  return {};
}

export function createApiClient({ rpcClient }: { rpcClient: ApiRpcClient }) {
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
      async (res) => {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      },
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
          account: Parameters<
            typeof parseRiotAccount
          >[0];
        };
        return { account: parseRiotAccount(body.account) };
      },
      async (res) => {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      },
    );
  }

  async function getActiveGameByPuuid(
    platform: RiotPlatform,
    puuid: string,
  ) {
    const res = await rpcClient.riot["active-games"][":platform"][":puuid"]
      .$get({
        param: { platform, puuid },
      });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.activeGame;
  }

  async function getMatchById(region: RiotRegion, matchId: string) {
    const res = await rpcClient.riot.matches[":region"][":matchId"].$get({
      param: { region, matchId },
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.match;
  }

  async function getLeagueEntriesByPuuid(
    platform: RiotPlatform,
    puuid: string,
  ) {
    const res = await rpcClient.riot["league-entries"][":platform"][":puuid"]
      .$get({
        param: { platform, puuid },
      });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error);
    }
    const body = await res.json();
    return body.entries;
  }

  async function checkHealth() {
    return await resultFromRequest(
      () => rpcClient.health.$get(),
      async (res) => {
        const body = await res.json() as { message: string };
        return { message: body.message };
      },
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

  async function createCustomGameEvent(event: {
    name: string;
    guildId: string;
    creatorId: string;
    discordScheduledEventId: string;
    recruitmentMessageId: string;
    scheduledStartAt: Date;
  }) {
    return await resultFromRequest(
      () => rpcClient.events.$post({ json: event }),
      successOnly,
    );
  }

  async function getCustomGameEventsByCreatorId(creatorId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events["by-creator"][":creatorId"].$get({
          param: { creatorId },
        }),
      async (res) => {
        const body = await res.json() as {
          events: Parameters<typeof parseEvent>[0][];
        };
        return { events: body.events.map(parseEvent) };
      },
    );
  }

  async function deleteCustomGameEvent(discordEventId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events[":discordEventId"].$delete({
          param: { discordEventId },
        }),
      successOnly,
    );
  }

  async function getEventStartingTodayByCreatorId(creatorId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId },
        }),
      async (res) => {
        const data = await res.json() as {
          event: Parameters<
            typeof parseEvent
          >[0];
        };
        return { event: parseEvent(data.event) };
      },
      async (res) => {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      },
    );
  }

  async function createMatchParticipant(
    matchId: string,
    participant: MatchParticipant,
  ) {
    try {
      const res = await rpcClient.matches[":matchId"].participants.$post({
        param: { matchId },
        json: participant,
      });

      if (!res.ok) {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      }

      const data = await res.json() as { id?: unknown };
      if (typeof data.id !== "number") {
        console.error("API response missing participant id", data);
        return {
          success: false,
          error: "API response missing participant id",
        };
      }

      return { success: true, id: data.id };
    } catch (error) {
      logCommunicationError(error);
      return { success: false, error: COMMUNICATION_ERROR };
    }
  }

  async function upsertPendingRankSnapshots(
    payload: z.infer<typeof upsertPendingRankSnapshotsSchema>,
  ) {
    return await resultFromRequest(
      () =>
        rpcClient.matches["rank-snapshots"].pending.$post({
          json: payload,
        }),
      successOnly,
    );
  }

  async function finalizeRankSnapshots(
    matchId: string,
    payload: z.infer<typeof finalizeRankSnapshotsSchema>,
  ) {
    return await resultFromRequest(
      () =>
        rpcClient.matches[":matchId"]["rank-snapshots"].finalize.$post({
          param: { matchId },
          json: payload,
        }),
      async (res) => {
        const body = await res.json() as {
          snapshots: {
            before: Parameters<typeof parseRankSnapshot>[0][];
            after: Parameters<typeof parseRankSnapshot>[0][];
          };
        };
        return {
          snapshots: {
            before: body.snapshots.before.map(parseRankSnapshot),
            after: body.snapshots.after.map(parseRankSnapshot),
          },
        };
      },
    );
  }

  async function resolveRiotStaticData(
    payload: RiotStaticDataResolveInput,
  ): Promise<RiotStaticDataResolveResult> {
    return await resultFromRequest(
      () =>
        rpcClient.riot["static-data"].resolve.$post({
          json: payload,
        }),
      async (res) => {
        const data = await res.json() as RiotStaticDataResolveData;
        return { data };
      },
      async (res) => ({
        success: false,
        error: await readErrorMessage(res),
      }),
    );
  }

  async function resolveOpggMatchDetail(
    matchId: string,
    payload: ResolveOpggMatchDetailPayload,
  ): Promise<ResolveOpggMatchDetailResult> {
    return await resultFromRequest(
      () =>
        rpcClient.matches[":matchId"]["external-details"].opgg.resolve.$post({
          param: { matchId },
          json: payload,
        }),
      async (res) => {
        const body = await res.json() as {
          detail?:
            | (Omit<OpggMatchDetail, "providerCreatedAt"> & {
              providerCreatedAt: string | Date;
            })
            | null;
        };
        return {
          detail: body.detail == null ? null : {
            ...body.detail,
            providerCreatedAt: new Date(body.detail.providerCreatedAt),
          },
        };
      },
      async (res) => ({
        success: false,
        error: await readErrorMessage(res),
      }),
    );
  }

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

  return {
    linkAccountByRiotId,
    getRiotAccount,
    getActiveGameByPuuid,
    getMatchById,
    getLeagueEntriesByPuuid,
    checkHealth,
    setMainRole,
    createCustomGameEvent,
    getCustomGameEventsByCreatorId,
    deleteCustomGameEvent,
    getEventStartingTodayByCreatorId,
    createMatchParticipant,
    upsertPendingRankSnapshots,
    finalizeRankSnapshots,
    resolveRiotStaticData,
    resolveOpggMatchDetail,
    getLoginUrl,
    watchMatch,
    unwatchMatch,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    updateMatchWatcherState,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let configuredApiClient: ApiClient | null = null;

export function configureApiClient(apiClientInstance: ApiClient) {
  configuredApiClient = apiClientInstance;
}

function getConfiguredApiClient(): ApiClient {
  if (configuredApiClient === null) {
    throw new Error("apiClient is not configured");
  }

  return configuredApiClient;
}

export const apiClient: ApiClient = {
  linkAccountByRiotId(...args) {
    return getConfiguredApiClient().linkAccountByRiotId(...args);
  },
  getRiotAccount(...args) {
    return getConfiguredApiClient().getRiotAccount(...args);
  },
  getActiveGameByPuuid(...args) {
    return getConfiguredApiClient().getActiveGameByPuuid(...args);
  },
  getMatchById(...args) {
    return getConfiguredApiClient().getMatchById(...args);
  },
  getLeagueEntriesByPuuid(...args) {
    return getConfiguredApiClient().getLeagueEntriesByPuuid(...args);
  },
  checkHealth(...args) {
    return getConfiguredApiClient().checkHealth(...args);
  },
  setMainRole(...args) {
    return getConfiguredApiClient().setMainRole(...args);
  },
  createCustomGameEvent(...args) {
    return getConfiguredApiClient().createCustomGameEvent(...args);
  },
  getCustomGameEventsByCreatorId(...args) {
    return getConfiguredApiClient().getCustomGameEventsByCreatorId(...args);
  },
  deleteCustomGameEvent(...args) {
    return getConfiguredApiClient().deleteCustomGameEvent(...args);
  },
  getEventStartingTodayByCreatorId(...args) {
    return getConfiguredApiClient().getEventStartingTodayByCreatorId(...args);
  },
  createMatchParticipant(...args) {
    return getConfiguredApiClient().createMatchParticipant(...args);
  },
  upsertPendingRankSnapshots(...args) {
    return getConfiguredApiClient().upsertPendingRankSnapshots(...args);
  },
  finalizeRankSnapshots(...args) {
    return getConfiguredApiClient().finalizeRankSnapshots(...args);
  },
  resolveRiotStaticData(...args) {
    return getConfiguredApiClient().resolveRiotStaticData(...args);
  },
  resolveOpggMatchDetail(...args) {
    return getConfiguredApiClient().resolveOpggMatchDetail(...args);
  },
  getLoginUrl(...args) {
    return getConfiguredApiClient().getLoginUrl(...args);
  },
  watchMatch(...args) {
    return getConfiguredApiClient().watchMatch(...args);
  },
  unwatchMatch(...args) {
    return getConfiguredApiClient().unwatchMatch(...args);
  },
  getEnabledMatchWatchers(...args) {
    return getConfiguredApiClient().getEnabledMatchWatchers(...args);
  },
  getEnabledMatchWatchersByGuild(...args) {
    return getConfiguredApiClient().getEnabledMatchWatchersByGuild(...args);
  },
  updateMatchWatcherState(...args) {
    return getConfiguredApiClient().updateMatchWatcherState(...args);
  },
};
