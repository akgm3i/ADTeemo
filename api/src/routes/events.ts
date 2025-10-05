import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { dbActions } from "../db/actions.ts";

const createEventSchema = z.object({
  name: z.string(),
  guildId: z.string(),
  creatorId: z.string(),
  discordScheduledEventId: z.string(),
  recruitmentMessageId: z.string(),
  scheduledStartAt: z.coerce.date(),
});

export const eventsRoutes = new Hono()
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

export type EventsRoutes = typeof eventsRoutes;
