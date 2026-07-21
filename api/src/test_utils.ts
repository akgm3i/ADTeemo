import type { AppDependencies } from "./dependencies.ts";

export const TEST_BOT_SERVICE_TOKEN =
  "test-bot-service-token-00000000000000000000000000000000";
export const TEST_BOT_SERVICE_AUTH_HEADERS = {
  Authorization: `Bearer ${TEST_BOT_SERVICE_TOKEN}`,
} as const;

type TestDependencyOverrides = {
  dbActions?: Partial<AppDependencies["dbActions"]>;
  riotApi?: Omit<Partial<AppDependencies["riotApi"]>, "__testing"> & {
    __testing?: Partial<AppDependencies["riotApi"]["__testing"]>;
  };
  rso?: Partial<AppDependencies["rso"]>;
  riotStaticData?: Partial<AppDependencies["riotStaticData"]>;
  opggMatchDetailService?: Partial<AppDependencies["opggMatchDetailService"]>;
  env?: Partial<AppDependencies["env"]>;
  logger?: Partial<AppDependencies["logger"]>;
};

function unexpectedDependencyCall(name: string): never {
  throw new Error(`Unexpected dependency call: ${name}`);
}

export function createTestDependencies(
  overrides: TestDependencyOverrides = {},
): AppDependencies {
  const deps = {
    dbActions: {
      upsertUser: () => unexpectedDependencyCall("dbActions.upsertUser"),
      ensureGuild: () => unexpectedDependencyCall("dbActions.ensureGuild"),
      deleteUser: () => unexpectedDependencyCall("dbActions.deleteUser"),
      setMainRole: () => unexpectedDependencyCall("dbActions.setMainRole"),
      createCustomGameEvent: () =>
        unexpectedDependencyCall("dbActions.createCustomGameEvent"),
      getCustomGameEventsByCreatorId: () =>
        unexpectedDependencyCall("dbActions.getCustomGameEventsByCreatorId"),
      deleteCustomGameEventByDiscordEventId: () =>
        unexpectedDependencyCall(
          "dbActions.deleteCustomGameEventByDiscordEventId",
        ),
      getEventStartingTodayByCreatorId: () =>
        unexpectedDependencyCall("dbActions.getEventStartingTodayByCreatorId"),
      createMatchWithParticipants: () =>
        unexpectedDependencyCall("dbActions.createMatchWithParticipants"),
      createMatchParticipant: () =>
        unexpectedDependencyCall("dbActions.createMatchParticipant"),
      upsertPendingRankSnapshots: () =>
        unexpectedDependencyCall("dbActions.upsertPendingRankSnapshots"),
      finalizeMatchRankSnapshots: () =>
        unexpectedDependencyCall("dbActions.finalizeMatchRankSnapshots"),
      upsertExternalMatchDetail: () =>
        unexpectedDependencyCall("dbActions.upsertExternalMatchDetail"),
      getAuthState: () => unexpectedDependencyCall("dbActions.getAuthState"),
      deleteAuthState: () =>
        unexpectedDependencyCall("dbActions.deleteAuthState"),
      updateUserRiotId: () =>
        unexpectedDependencyCall("dbActions.updateUserRiotId"),
      linkUserWithRiotId: () =>
        unexpectedDependencyCall("dbActions.linkUserWithRiotId"),
      upsertRiotAccount: () =>
        unexpectedDependencyCall("dbActions.upsertRiotAccount"),
      getRiotAccountByDiscordId: () =>
        unexpectedDependencyCall("dbActions.getRiotAccountByDiscordId"),
      getRiotStaticDataCache: () =>
        unexpectedDependencyCall("dbActions.getRiotStaticDataCache"),
      upsertRiotStaticDataCache: () =>
        unexpectedDependencyCall("dbActions.upsertRiotStaticDataCache"),
      upsertMatchWatcher: () =>
        unexpectedDependencyCall("dbActions.upsertMatchWatcher"),
      getEnabledMatchWatchers: () =>
        unexpectedDependencyCall("dbActions.getEnabledMatchWatchers"),
      getEnabledMatchWatchersByGuild: () =>
        unexpectedDependencyCall("dbActions.getEnabledMatchWatchersByGuild"),
      updateMatchWatcherState: () =>
        unexpectedDependencyCall("dbActions.updateMatchWatcherState"),
      disableMatchWatcher: () =>
        unexpectedDependencyCall("dbActions.disableMatchWatcher"),
      createAuthState: () =>
        unexpectedDependencyCall("dbActions.createAuthState"),
      ...overrides.dbActions,
    },
    riotApi: {
      getAccountByRiotId: () =>
        unexpectedDependencyCall("riotApi.getAccountByRiotId"),
      getActiveGameByPuuid: () =>
        unexpectedDependencyCall("riotApi.getActiveGameByPuuid"),
      getMatchById: () => unexpectedDependencyCall("riotApi.getMatchById"),
      getLeagueEntriesByPuuid: () =>
        unexpectedDependencyCall("riotApi.getLeagueEntriesByPuuid"),
      ...overrides.riotApi,
      __testing: {
        resetRateLimiter: () =>
          unexpectedDependencyCall("riotApi.__testing.resetRateLimiter"),
        rateLimiterSnapshot: () =>
          unexpectedDependencyCall("riotApi.__testing.rateLimiterSnapshot"),
        ...overrides.riotApi?.__testing,
      },
    },
    rso: {
      exchangeCodeForTokens: () =>
        unexpectedDependencyCall("rso.exchangeCodeForTokens"),
      getUserInfo: () => unexpectedDependencyCall("rso.getUserInfo"),
      getAuthorizationUrl: () =>
        unexpectedDependencyCall("rso.getAuthorizationUrl"),
      ...overrides.rso,
    },
    riotStaticData: {
      resolve: () => unexpectedDependencyCall("riotStaticData.resolve"),
      ...overrides.riotStaticData,
    },
    opggMatchDetailService: {
      resolveAndSave: () =>
        unexpectedDependencyCall("opggMatchDetailService.resolveAndSave"),
      ...overrides.opggMatchDetailService,
    },
    env: {
      get: (key: string) =>
        key === "BOT_SERVICE_TOKEN" ? TEST_BOT_SERVICE_TOKEN : undefined,
      ...overrides.env,
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      ...overrides.logger,
    },
  };

  return deps as AppDependencies;
}
