import {
  createWatchPolicyApiClient,
  type WatchPolicyApiClient,
} from "./api_clients/watch_policy.ts";
import {
  createGuildSettingsApiClient,
  type GuildSettingsApiClient,
} from "./api_clients/guild_settings.ts";
import {
  createNotificationDeliveriesApiClient,
  type NotificationDeliveriesApiClient,
} from "./api_clients/notification_deliveries.ts";
import {
  BOT_SERVICE_TOKEN_MAX_LENGTH,
  BOT_SERVICE_TOKEN_MIN_LENGTH,
  botServiceAuthorization,
  hcWithType,
} from "@adteemo/api/contract";
import { type AuthApiClient, createAuthApiClient } from "./api_clients/auth.ts";
import {
  createEventsApiClient,
  type EventsApiClient,
} from "./api_clients/events.ts";
import {
  createHealthApiClient,
  type HealthApiClient,
} from "./api_clients/health.ts";
import {
  createMatchesApiClient,
  type MatchesApiClient,
} from "./api_clients/matches.ts";
import {
  createMatchWatchersApiClient,
  type MatchWatchersApiClient,
} from "./api_clients/match_watchers.ts";
import { createRiotApiClient, type RiotApiClient } from "./api_clients/riot.ts";
import {
  createUsersApiClient,
  type UsersApiClient,
} from "./api_clients/users.ts";
import type { ApiRpcClient } from "./api_clients/transport.ts";

export type {
  FailureResult as ApiClientFailure,
  HttpFailureResult as ApiClientHttpFailure,
} from "./api_clients/transport.ts";

export type {
  CustomMatchStat,
  FinalizedRankSnapshot,
  OpggMatchDetail,
  RankSnapshotPayload,
  RecordCustomMatchInput,
  ResolveOpggMatchDetailPayload,
  ResolveOpggMatchDetailResult,
} from "./api_clients/matches.ts";
export type {
  RiotStaticDataResolveData,
  RiotStaticDataResolveInput,
  RiotStaticDataResolveResult,
} from "./api_clients/riot.ts";

export type ApiResourceClients = {
  watchPolicy: WatchPolicyApiClient;
  guildSettings: GuildSettingsApiClient;
  health: HealthApiClient;
  users: UsersApiClient;
  events: EventsApiClient;
  matches: MatchesApiClient;
  matchWatchers: MatchWatchersApiClient;
  notificationDeliveries: NotificationDeliveriesApiClient;
  riot: RiotApiClient;
  auth: AuthApiClient;
};

export type ApiRpcClientOptions = {
  headers?: Record<string, string>;
};

export type ApiRpcClientFactory = (
  apiUrl: string,
  options?: ApiRpcClientOptions,
) => ApiRpcClient;

export function createApiRpcClients(
  {
    apiUrl,
    credential,
    createRpcClient = hcWithType,
  }: {
    apiUrl: string;
    credential: string;
    createRpcClient?: ApiRpcClientFactory;
  },
) {
  if (credential.length < BOT_SERVICE_TOKEN_MIN_LENGTH) {
    throw new Error(
      `BOT_SERVICE_TOKEN must be at least ${BOT_SERVICE_TOKEN_MIN_LENGTH} characters`,
    );
  }

  if (credential.length > BOT_SERVICE_TOKEN_MAX_LENGTH) {
    throw new Error(
      `BOT_SERVICE_TOKEN must be at most ${BOT_SERVICE_TOKEN_MAX_LENGTH} characters`,
    );
  }

  const publicRpcClient = createRpcClient(apiUrl);
  const botServiceRpcClient = createRpcClient(apiUrl, {
    headers: {
      Authorization: botServiceAuthorization(credential),
    },
  });

  return { publicRpcClient, botServiceRpcClient };
}

export function createApiResourceClients(
  {
    rpcClient,
    publicRpcClient = rpcClient,
  }: {
    rpcClient: ApiRpcClient;
    publicRpcClient?: ApiRpcClient;
  },
): ApiResourceClients {
  return {
    health: createHealthApiClient({ rpcClient: publicRpcClient }),
    users: createUsersApiClient({ rpcClient }),
    events: createEventsApiClient({ rpcClient }),
    matches: createMatchesApiClient({ rpcClient }),
    watchPolicy: createWatchPolicyApiClient({ rpcClient }),
    guildSettings: createGuildSettingsApiClient({ rpcClient }),
    matchWatchers: createMatchWatchersApiClient({ rpcClient }),
    notificationDeliveries: createNotificationDeliveriesApiClient({
      rpcClient,
    }),
    riot: createRiotApiClient({ rpcClient }),
    auth: createAuthApiClient({ rpcClient }),
  };
}

export function createApiClient(
  {
    rpcClient,
    publicRpcClient = rpcClient,
  }: {
    rpcClient: ApiRpcClient;
    publicRpcClient?: ApiRpcClient;
  },
) {
  const resources = createApiResourceClients({ rpcClient, publicRpcClient });

  return {
    ...resources.users,
    ...resources.riot,
    ...resources.health,
    ...resources.events,
    ...resources.matches,
    ...resources.auth,
    ...resources.guildSettings,
    ...resources.watchPolicy,
    ...resources.matchWatchers,
    ...resources.notificationDeliveries,
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
  getGuildMatchWatchSettings(...args) {
    return getConfiguredApiClient().getGuildMatchWatchSettings(...args);
  },
  setGuildMatchWatchSettings(...args) {
    return getConfiguredApiClient().setGuildMatchWatchSettings(...args);
  },
  syncGuildMatchWatchMembers(...args) {
    return getConfiguredApiClient().syncGuildMatchWatchMembers(...args);
  },
  setMatchWatchOptOut(...args) {
    return getConfiguredApiClient().setMatchWatchOptOut(...args);
  },
  getNextCustomGameSequence(...args) {
    return getConfiguredApiClient().getNextCustomGameSequence(...args);
  },
  getCustomGameSettings(...args) {
    return getConfiguredApiClient().getCustomGameSettings(...args);
  },
  setCustomGameSettings(...args) {
    return getConfiguredApiClient().setCustomGameSettings(...args);
  },
  prepareNotificationDelivery(...args) {
    return getConfiguredApiClient().prepareNotificationDelivery(...args);
  },
  claimNotificationDelivery(...args) {
    return getConfiguredApiClient().claimNotificationDelivery(...args);
  },
  completeNotificationDelivery(...args) {
    return getConfiguredApiClient().completeNotificationDelivery(...args);
  },
  failNotificationDelivery(...args) {
    return getConfiguredApiClient().failNotificationDelivery(...args);
  },
  getPendingNotificationDeliveries(...args) {
    return getConfiguredApiClient().getPendingNotificationDeliveries(...args);
  },
  linkAccountByRiotId(...args) {
    return getConfiguredApiClient().linkAccountByRiotId(...args);
  },
  getRiotAccounts(...args) {
    return getConfiguredApiClient().getRiotAccounts(...args);
  },
  setMainRiotAccount(...args) {
    return getConfiguredApiClient().setMainRiotAccount(...args);
  },
  deleteRiotAccount(...args) {
    return getConfiguredApiClient().deleteRiotAccount(...args);
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
  prepareCustomGameEvent(...args) {
    return getConfiguredApiClient().prepareCustomGameEvent(...args);
  },
  updateCustomGameEventCreationProgress(...args) {
    return getConfiguredApiClient().updateCustomGameEventCreationProgress(
      ...args,
    );
  },
  activateCustomGameEvent(...args) {
    return getConfiguredApiClient().activateCustomGameEvent(...args);
  },
  markCustomGameEventCreationFailed(...args) {
    return getConfiguredApiClient().markCustomGameEventCreationFailed(...args);
  },
  getCustomGameEventsByCreator(...args) {
    return getConfiguredApiClient().getCustomGameEventsByCreator(...args);
  },
  getEventStartingTodayByCreator(...args) {
    return getConfiguredApiClient().getEventStartingTodayByCreator(...args);
  },
  beginCustomGameEventCancellation(...args) {
    return getConfiguredApiClient().beginCustomGameEventCancellation(...args);
  },
  updateCustomGameEventCancellationProgress(...args) {
    return getConfiguredApiClient().updateCustomGameEventCancellationProgress(
      ...args,
    );
  },
  confirmCustomGameEventParticipants(...args) {
    return getConfiguredApiClient().confirmCustomGameEventParticipants(...args);
  },
  saveCustomGameEventParticipants(...args) {
    return getConfiguredApiClient().saveCustomGameEventParticipants(...args);
  },
  getCustomGameEventParticipants(...args) {
    return getConfiguredApiClient().getCustomGameEventParticipants(...args);
  },
  recordCustomMatch(...args) {
    return getConfiguredApiClient().recordCustomMatch(...args);
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
  inspectMatchWatcherActiveGame(...args) {
    return getConfiguredApiClient().inspectMatchWatcherActiveGame(...args);
  },
  inspectMatchWatcherResult(...args) {
    return getConfiguredApiClient().inspectMatchWatcherResult(...args);
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
