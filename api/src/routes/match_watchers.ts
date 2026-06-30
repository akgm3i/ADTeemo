import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  createMatchWatcherSchema,
  updateMatchWatcherStateSchema,
} from "../contract/schemas.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";
import type { AppDependencies } from "../dependencies.ts";

type MatchWatchersDbActions = Pick<
  AppDependencies["dbActions"],
  | "upsertMatchWatcher"
  | "getEnabledMatchWatchers"
  | "getEnabledMatchWatchersByGuild"
  | "updateMatchWatcherState"
  | "disableMatchWatcher"
>;

export function matchWatchersRoutes(
  deps: { dbActions: MatchWatchersDbActions },
) {
  const { dbActions } = deps;
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
    .delete("/:guildId/:targetDiscordId", async (c) => {
      const { guildId, targetDiscordId } = c.req.param();
      await dbActions.disableMatchWatcher(guildId, targetDiscordId);
      return c.body(null, 204);
    });
}

export type MatchWatchersRoutes = ReturnType<typeof matchWatchersRoutes>;
