import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  createMatchWatcherSchema,
  inspectMatchWatcherActiveGameSchema,
  inspectMatchWatcherResultSchema,
  updateMatchWatcherStateSchema,
} from "../contract/schemas.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";
import type { AppDependencies } from "../dependencies.ts";
import {
  createMatchTrackingInspectionService,
  MatchTrackingInspectionError,
} from "../services/match_tracking.ts";
import {
  apiErrorResponse,
  ApiHttpError,
  apiValidationHook,
  remoteApiError,
  repositoryApiError,
} from "../api_errors.ts";

type MatchWatchersDbActions = Pick<
  AppDependencies["dbActions"],
  | "upsertMatchWatcher"
  | "getEnabledMatchWatchers"
  | "getEnabledMatchWatchersByGuild"
  | "getRiotAccountByDiscordId"
  | "upsertPendingRankSnapshots"
  | "finalizeMatchRankSnapshots"
  | "updateMatchWatcherState"
  | "disableMatchWatcher"
>;

function matchTrackingApiError(error: unknown): ApiHttpError {
  if (error instanceof MatchTrackingInspectionError) {
    return error.source === "riot_api"
      ? remoteApiError("RIOT_API_UNAVAILABLE", error.cause)
      : repositoryApiError(error.cause);
  }
  return new ApiHttpError("INTERNAL_ERROR", { cause: error });
}

export function matchWatchersRoutes(
  deps: {
    dbActions: MatchWatchersDbActions;
    riotApi: Pick<
      AppDependencies["riotApi"],
      | "getActiveGameByPuuid"
      | "getLeagueEntriesByPuuid"
      | "getMatchById"
    >;
    opggMatchDetailService: AppDependencies["opggMatchDetailService"];
    logger: AppDependencies["logger"];
  },
) {
  const { dbActions } = deps;
  const matchTrackingInspection = createMatchTrackingInspectionService(deps);
  return new Hono()
    .post(
      "/",
      zValidator("json", createMatchWatcherSchema, apiValidationHook),
      async (c) => {
        const watcher = c.req.valid("json");
        try {
          await dbActions.upsertMatchWatcher(watcher);
          return c.body(null, 204);
        } catch (e) {
          if (e instanceof RecordNotFoundError) {
            return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
          }
          if (e instanceof MatchWatcherLimitError) {
            return apiErrorResponse(c, "MATCH_WATCHER_LIMIT_REACHED");
          }
          throw e;
        }
      },
    )
    .get("/enabled", async (c) => {
      const watchers = await dbActions.getEnabledMatchWatchers();
      return c.json({ watchers }, 200);
    })
    .get("/enabled/:guildId", async (c) => {
      const { guildId } = c.req.param();
      const watchers = await dbActions.getEnabledMatchWatchersByGuild(guildId);
      return c.json({ watchers }, 200);
    })
    .patch(
      "/:guildId/:targetDiscordId/state",
      zValidator("json", updateMatchWatcherStateSchema, apiValidationHook),
      async (c) => {
        const { guildId, targetDiscordId } = c.req.param();
        const state = c.req.valid("json");
        await dbActions.updateMatchWatcherState(
          guildId,
          targetDiscordId,
          state,
        );
        return c.body(null, 204);
      },
    )
    .post(
      "/:guildId/:targetDiscordId/tracking/active-game",
      zValidator(
        "json",
        inspectMatchWatcherActiveGameSchema,
        apiValidationHook,
      ),
      async (c) => {
        const { guildId, targetDiscordId } = c.req.param();
        const state = c.req.valid("json");

        try {
          const result = await matchTrackingInspection.inspectActiveGame({
            guildId,
            targetDiscordId,
            ...state,
          });
          if (result.status === "riot_account_not_found") {
            return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
          }
          return c.json({
            account: result.account,
            activeGame: result.activeGame,
            notificationIntent: result.notificationIntent,
            stateTransition: result.stateTransition,
          }, 200);
        } catch (error) {
          throw matchTrackingApiError(error);
        }
      },
    )
    .post(
      "/:guildId/:targetDiscordId/tracking/result",
      zValidator("json", inspectMatchWatcherResultSchema, apiValidationHook),
      async (c) => {
        const { guildId, targetDiscordId } = c.req.param();
        const payload = c.req.valid("json");

        try {
          const result = await matchTrackingInspection.inspectResult({
            guildId,
            targetDiscordId,
            matchId: payload.matchId,
            messageId: payload.messageId,
            startedAt: payload.startedAt,
            resultFetchTimeoutMs: payload.resultFetchTimeoutMs,
          });
          if (result.status === "riot_account_not_found") {
            return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
          }
          return c.json({
            account: result.account,
            match: result.match,
            rankSummary: result.rankSummary,
            opggDetail: result.opggDetail,
            notificationIntent: result.notificationIntent,
            stateTransition: result.stateTransition,
          }, 200);
        } catch (error) {
          throw matchTrackingApiError(error);
        }
      },
    )
    .delete("/:guildId/:targetDiscordId", async (c) => {
      const { guildId, targetDiscordId } = c.req.param();
      await dbActions.disableMatchWatcher(guildId, targetDiscordId);
      return c.body(null, 204);
    });
}

export type MatchWatchersRoutes = ReturnType<typeof matchWatchersRoutes>;
