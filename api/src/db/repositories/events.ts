import { and, eq, gte, lte } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { Database } from "../index.ts";
import { customGameEvents, guilds, users } from "../schema.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);

export function createEventsRepository(database: Database) {
  async function createCustomGameEvent(event: {
    name: string;
    guildId: string;
    creatorId: string;
    discordScheduledEventId: string;
    recruitmentMessageId: string;
    scheduledStartAt: Date;
  }) {
    await database.transaction(async (tx) => {
      const userPayload = userInsertSchema.parse({
        discordId: event.creatorId,
      });
      await tx.insert(users).values(userPayload).onConflictDoNothing()
        .execute();

      const guildPayload = guildInsertSchema.parse({ id: event.guildId });
      await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
        .execute();

      const parsedEvent = customGameEventInsertSchema.parse(event);
      await tx.insert(customGameEvents).values(parsedEvent).execute();
    });
  }

  async function getCustomGameEventsByCreatorId(creatorId: string) {
    return await database.query.customGameEvents.findMany({
      where: eq(customGameEvents.creatorId, creatorId),
    });
  }

  async function deleteCustomGameEventByDiscordEventId(discordEventId: string) {
    await database.delete(customGameEvents).where(
      eq(customGameEvents.discordScheduledEventId, discordEventId),
    ).execute();
  }

  async function getEventStartingTodayByCreatorId(creatorId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    return await database.query.customGameEvents.findFirst({
      where: and(
        eq(customGameEvents.creatorId, creatorId),
        gte(customGameEvents.scheduledStartAt, todayStart),
        lte(customGameEvents.scheduledStartAt, todayEnd),
      ),
    });
  }

  return {
    createCustomGameEvent,
    getCustomGameEventsByCreatorId,
    deleteCustomGameEventByDiscordEventId,
    getEventStartingTodayByCreatorId,
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
