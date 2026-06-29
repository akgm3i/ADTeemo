import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { createEventSchema } from "../contract/schemas.ts";
import type { AppDependencies } from "../dependencies.ts";

type EventsDbActions = Pick<
  AppDependencies["dbActions"],
  | "createCustomGameEvent"
  | "getCustomGameEventsByCreatorId"
  | "getEventStartingTodayByCreatorId"
  | "deleteCustomGameEventByDiscordEventId"
>;

export function eventsRoutes(deps: { dbActions: EventsDbActions }) {
  const { dbActions } = deps;
  return new Hono()
    .post("/", zValidator("json", createEventSchema), async (c) => {
      const event = c.req.valid("json");
      await dbActions.createCustomGameEvent(event);
      return c.body(null, 201);
    })
    .get("/by-creator/:creatorId", async (c) => {
      const { creatorId } = c.req.param();
      const events = await dbActions.getCustomGameEventsByCreatorId(creatorId);
      return c.json({ events });
    })
    .get("/today/by-creator/:creatorId", async (c) => {
      const { creatorId } = c.req.param();
      const event = await dbActions.getEventStartingTodayByCreatorId(
        creatorId,
      );
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }
      return c.json({ event }, 200);
    })
    .delete("/:discordEventId", async (c) => {
      const { discordEventId } = c.req.param();
      await dbActions.deleteCustomGameEventByDiscordEventId(discordEventId);
      return c.body(null, 204);
    });
}

export type EventsRoutes = ReturnType<typeof eventsRoutes>;
