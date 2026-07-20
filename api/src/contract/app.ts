import { type Context, Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  callbackQuerySchema,
  createEventSchema,
  createMatchWatcherSchema,
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  inspectMatchWatcherActiveGameSchema,
  inspectMatchWatcherResultSchema,
  linkByRiotIdSchema,
  loginUrlQuerySchema,
  platformAndPuuidSchema,
  regionAndMatchIdSchema,
  resolveOpggMatchDetailSchema,
  riotStaticDataResolveSchema,
  roleSchema,
  updateMatchWatcherStateSchema,
  upsertPendingRankSnapshotsSchema,
} from "./schemas.ts";
import type {
  ActiveGame,
  Event,
  LeagueEntry,
  MatchRankSnapshot,
  MatchTrackingNotificationIntent,
  MatchTrackingRankSummary,
  MatchTrackingStateTransition,
  MatchWatcher,
  OpggMatchDetail,
  RiotAccount,
  RiotMatch,
  RiotStaticDataResolveData,
} from "./models.ts";
import {
  type ApiErrorCode,
  type ApiErrorResponse,
  DEFAULT_API_ERROR_MESSAGE,
} from "./errors.ts";

function hasContractError(): boolean {
  return false;
}

function errorResponse(code: ApiErrorCode): ApiErrorResponse {
  return { code, message: DEFAULT_API_ERROR_MESSAGE[code] };
}

function contractValidationHook(
  result: { success: boolean },
  c: Context,
) {
  if (!result.success) {
    return c.json(errorResponse("VALIDATION_ERROR"), 422);
  }
}

const usersContractRoutes = new Hono()
  .patch(
    "/link-by-riot-id",
    zValidator("json", linkByRiotIdSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
      }
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.body(null, 204);
    },
  )
  .get("/:userId/riot-account", (c) => {
    if (hasContractError()) {
      return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
    }
    return c.json({ account: {} as RiotAccount }, 200);
  })
  .put(
    "/:userId/main-role",
    zValidator("json", roleSchema, contractValidationHook),
    (c) => c.body(null, 204),
  );

const eventsContractRoutes = new Hono()
  .post(
    "/",
    zValidator("json", createEventSchema, contractValidationHook),
    (c) => c.body(null, 201),
  )
  .get("/by-creator/:creatorId", (c) => c.json({ events: [] as Event[] }, 200))
  .get("/today/by-creator/:creatorId", (c) => {
    if (hasContractError()) {
      return c.json(errorResponse("EVENT_NOT_FOUND"), 404);
    }
    return c.json({ event: {} as Event }, 200);
  })
  .delete("/:discordEventId", (c) => c.body(null, 204));

const matchesContractRoutes = new Hono()
  .post(
    "/rank-snapshots/pending",
    zValidator(
      "json",
      upsertPendingRankSnapshotsSchema,
      contractValidationHook,
    ),
    (c) => c.body(null, 204),
  )
  .post(
    "/:matchId/rank-snapshots/finalize",
    zValidator("json", finalizeRankSnapshotsSchema, contractValidationHook),
    (c) =>
      c.json({
        snapshots: {
          before: [] as MatchRankSnapshot[],
          after: [] as MatchRankSnapshot[],
        },
      }, 200),
  )
  .post(
    "/:matchId/external-details/opgg/resolve",
    zValidator(
      "json",
      resolveOpggMatchDetailSchema,
      contractValidationHook,
    ),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("OPGG_PARTICIPANT_MISMATCH"), 400);
      }
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
      }
      if (hasContractError()) {
        return c.json(errorResponse("INTERNAL_ERROR"), 500);
      }
      return c.json({ detail: null as OpggMatchDetail | null }, 200);
    },
  )
  .post(
    "/:matchId/participants",
    zValidator("json", createParticipantSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RESOURCE_NOT_FOUND"), 404);
      }
      return c.json({ id: 0 }, 201);
    },
  );

const matchWatchersContractRoutes = new Hono()
  .post(
    "/",
    zValidator("json", createMatchWatcherSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
      }
      if (hasContractError()) {
        return c.json(errorResponse("MATCH_WATCHER_LIMIT_REACHED"), 409);
      }
      return c.body(null, 204);
    },
  )
  .get("/enabled", (c) => c.json({ watchers: [] as MatchWatcher[] }, 200))
  .get(
    "/enabled/:guildId",
    (c) => c.json({ watchers: [] as MatchWatcher[] }, 200),
  )
  .patch(
    "/:guildId/:targetDiscordId/state",
    zValidator(
      "json",
      updateMatchWatcherStateSchema,
      contractValidationHook,
    ),
    (c) => c.body(null, 204),
  )
  .post(
    "/:guildId/:targetDiscordId/tracking/active-game",
    zValidator(
      "json",
      inspectMatchWatcherActiveGameSchema,
      contractValidationHook,
    ),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
      }
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.json({
        account: {} as RiotAccount,
        activeGame: null as ActiveGame | null,
        notificationIntent: null as MatchTrackingNotificationIntent | null,
        stateTransition: null as MatchTrackingStateTransition | null,
      }, 200);
    },
  )
  .post(
    "/:guildId/:targetDiscordId/tracking/result",
    zValidator(
      "json",
      inspectMatchWatcherResultSchema,
      contractValidationHook,
    ),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_ACCOUNT_NOT_FOUND"), 404);
      }
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.json({
        account: {} as RiotAccount,
        match: null as RiotMatch | null,
        rankSummary: null as MatchTrackingRankSummary | null,
        opggDetail: null as OpggMatchDetail | null,
        notificationIntent: null as MatchTrackingNotificationIntent | null,
        stateTransition: null as MatchTrackingStateTransition | null,
      }, 200);
    },
  )
  .delete("/:guildId/:targetDiscordId", (c) => c.body(null, 204));

const riotStaticDataContractRoutes = new Hono().post(
  "/resolve",
  zValidator("json", riotStaticDataResolveSchema, contractValidationHook),
  (c) => {
    if (hasContractError()) {
      return c.json(errorResponse("VALIDATION_ERROR"), 422);
    }
    if (hasContractError()) {
      return c.json(errorResponse("RIOT_STATIC_DATA_UNAVAILABLE"), 502);
    }
    return c.json({} as RiotStaticDataResolveData, 200);
  },
);

const riotContractRoutes = new Hono()
  .get(
    "/active-games/:platform/:puuid",
    zValidator("param", platformAndPuuidSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.json({ activeGame: null as ActiveGame | null }, 200);
    },
  )
  .get(
    "/matches/:region/:matchId",
    zValidator("param", regionAndMatchIdSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.json({ match: null as RiotMatch | null }, 200);
    },
  )
  .get(
    "/league-entries/:platform/:puuid",
    zValidator("param", platformAndPuuidSchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("RIOT_API_UNAVAILABLE"), 502);
      }
      return c.json({ entries: [] as LeagueEntry[] }, 200);
    },
  )
  .route("/static-data", riotStaticDataContractRoutes);

const authContractRoutes = new Hono()
  .get(
    "/rso/login-url",
    zValidator("query", loginUrlQuerySchema, contractValidationHook),
    (c) => c.json({ url: "" }, 200),
  )
  .get(
    "/rso/callback",
    zValidator("query", callbackQuerySchema, contractValidationHook),
    (c) => {
      if (hasContractError()) {
        return c.json(errorResponse("INVALID_REQUEST"), 400);
      }
      if (hasContractError()) {
        return c.json(errorResponse("INTERNAL_ERROR"), 500);
      }
      return c.html("", 200);
    },
  );

export const contractApp = new Hono()
  .get("/health", (c) => c.json({ message: "" }, 200))
  .route("/users", usersContractRoutes)
  .route("/events", eventsContractRoutes)
  .route("/matches", matchesContractRoutes)
  .route("/match-watchers", matchWatchersContractRoutes)
  .route("/riot", riotContractRoutes)
  .route("/auth", authContractRoutes);

export type AppType = typeof contractApp;
