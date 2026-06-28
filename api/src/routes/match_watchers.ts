import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { dbActions } from "../db/default_actions.ts";
import { matchWatcherStates } from "../db/schema.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";

const createMatchWatcherSchema = z.object({
  guildId: z.string(),
  targetDiscordId: z.string(),
  requesterId: z.string(),
  channelId: z.string(),
});

const updateMatchWatcherStateSchema = z.object({
  lastState: z.enum(matchWatcherStates),
  currentGameId: z.string().nullable().optional(),
  currentMatchId: z.string().nullable().optional(),
  currentNotificationMessageId: z.string().nullable().optional(),
  pendingResultMatchId: z.string().nullable().optional(),
  pendingResultNotificationMessageId: z.string().nullable().optional(),
  pendingResultStartedAt: z.coerce.date().nullable().optional(),
  gameStartedAt: z.coerce.date().nullable().optional(),
  lastCheckedAt: z.coerce.date().nullable().optional(),
  lastInGameNotifiedAt: z.coerce.date().nullable().optional(),
});

export const matchWatchersRoutes = new Hono()
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
      await dbActions.updateMatchWatcherState(guildId, targetDiscordId, state);
      return c.body(null, 204);
    },
  )
  .delete("/:guildId/:targetDiscordId", async (c) => {
    const { guildId, targetDiscordId } = c.req.param();
    await dbActions.disableMatchWatcher(guildId, targetDiscordId);
    return c.body(null, 204);
  });

export type MatchWatchersRoutes = typeof matchWatchersRoutes;
