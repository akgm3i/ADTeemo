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
import { createMatchTrackingInspectionService } from "../services/match_tracking.ts";

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
    .post("/", zValidator("json", createMatchWatcherSchema), async (c) => {
      const watcher = c.req.valid("json");
      try {
        await dbActions.upsertMatchWatcher(watcher);
        return c.body(null, 204);
      } catch (e) {
        if (e instanceof RecordNotFoundError) {
          return c.json({ error: e.message }, 404);
        }
        if (e instanceof MatchWatcherLimitError) {
          return c.json({ error: e.message }, 409);
        }
        throw e;
      }
    })
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
      zValidator("json", updateMatchWatcherStateSchema),
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
      zValidator("json", inspectMatchWatcherActiveGameSchema),
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
            return c.json({ error: result.error }, 404);
          }
          return c.json({
            account: result.account,
            activeGame: result.activeGame,
          }, 200);
        } catch (error) {
          return c.json({
            error: error instanceof Error
              ? error.message
              : "Riot API request failed",
          }, 502);
        }
      },
    )
    .post(
      "/:guildId/:targetDiscordId/tracking/result",
      zValidator("json", inspectMatchWatcherResultSchema),
      async (c) => {
        const { guildId, targetDiscordId } = c.req.param();
        const payload = c.req.valid("json");

        try {
          const result = await matchTrackingInspection.inspectResult({
            guildId,
            targetDiscordId,
            matchId: payload.matchId,
          });
          if (result.status === "riot_account_not_found") {
            return c.json({ error: result.error }, 404);
          }
          return c.json({
            account: result.account,
            match: result.match,
            rankSummary: result.rankSummary,
            opggDetail: result.opggDetail,
          }, 200);
        } catch (error) {
          return c.json({
            error: error instanceof Error
              ? error.message
              : "Riot API request failed",
          }, 502);
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
