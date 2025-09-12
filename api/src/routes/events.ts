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
});

export const eventsRoutes = new Hono()
  .post("/", zValidator("json", createEventSchema), async (c) => {
    const event = c.req.valid("json");
    try {
      await dbActions.createCustomGameEvent(event);
      return c.json({ success: true });
    } catch (e) {
      console.error(e);
      return c.json({ success: false, error: "Failed to create event" }, 500);
    }
  })
  .get("/by-creator/:creatorId", async (c) => {
    const { creatorId } = c.req.param();
    try {
      const events = await dbActions.getCustomGameEventsByCreatorId(creatorId);
      return c.json({ success: true, events });
    } catch (e) {
      console.error(e);
      return c.json({ success: false, error: "Failed to get events" }, 500);
    }
  })
  .get("/today/by-creator/:creatorId", async (c) => {
    const { creatorId } = c.req.param();
    try {
      const event = await dbActions.getTodaysCustomGameEventByCreatorId(
        creatorId,
      );
      if (!event) {
        return c.json({ success: false, error: "Event not found" }, 404);
      }
      return c.json({ success: true, event });
    } catch (e) {
      console.error(e);
      return c.json(
        { success: false, error: "Failed to get today's event" },
        500,
      );
    }
  })
  .delete("/:discordEventId", async (c) => {
    const { discordEventId } = c.req.param();
    try {
      await dbActions.deleteCustomGameEventByDiscordEventId(discordEventId);
      return c.json({ success: true });
    } catch (e) {
      console.error(e);
      return c.json({ success: false, error: "Failed to delete event" }, 500);
    }
  });

export type EventsRoutes = typeof eventsRoutes;
