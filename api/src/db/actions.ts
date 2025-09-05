import { eq } from "npm:drizzle-orm";
import { createInsertSchema, createUpdateSchema } from "npm:drizzle-zod";
import { db } from "./index.ts";
import { type Lane, users, customGameEvents } from "./schema.ts";

const userInsertSchema = createInsertSchema(users);
const userUpdateSchema = createUpdateSchema(users);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);

async function upsertUser(userId: string) {
  const user = { discordId: userId };
  const parsed = userInsertSchema.parse(user);
  await db.insert(users).values(parsed).onConflictDoNothing().execute();
}

async function setMainRole(userId: string, role: Lane) {
  await upsertUser(userId); // Ensure user exists
  const user = { discordId: userId, mainRole: role };
  const parsed = userUpdateSchema.parse(user);
  return await db.update(users).set(parsed).where(
    eq(users.discordId, userId),
  ).execute();
}

async function createCustomGameEvent(event: {
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
}) {
  // Ensure the creator exists as a user.
  await upsertUser(event.creatorId);
  const parsed = customGameEventInsertSchema.parse(event);
  await db.insert(customGameEvents).values(parsed).execute();
}

async function getCustomGameEventsByCreatorId(creatorId: string) {
  return await db.query.customGameEvents.findMany({
    where: eq(customGameEvents.creatorId, creatorId),
  });
}

async function deleteCustomGameEventByDiscordEventId(discordEventId: string) {
  await db.delete(customGameEvents).where(
    eq(customGameEvents.discordScheduledEventId, discordEventId),
  ).execute();
}

export const dbActions = {
  upsertUser,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEventByDiscordEventId,
};
