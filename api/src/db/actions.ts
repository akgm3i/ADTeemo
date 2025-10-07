import { and, eq, gte, lte } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { db } from "./index.ts";
import {
  authStates,
  customGameEvents,
  guilds,
  type Lane,
  matches,
  matchParticipants,
  userGuildProfiles,
  users,
} from "./schema.ts";
import { RecordNotFoundError } from "../errors.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const userGuildProfileInsertSchema = createInsertSchema(userGuildProfiles);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);
const matchParticipantInsertSchema = createInsertSchema(matchParticipants);

async function upsertUser(userId: string) {
  const user = { discordId: userId };
  const parsed = userInsertSchema.parse(user);
  await db.insert(users).values(parsed).onConflictDoNothing().execute();
  const result = await db.query.users.findFirst({
    where: eq(users.discordId, userId),
  });
  if (!result) {
    throw new Error("Failed to upsert user");
  }
  return result;
}

async function ensureGuild(guildId: string) {
  const payload = guildInsertSchema.parse({ id: guildId });
  await db.insert(guilds).values(payload).onConflictDoNothing().execute();
}

async function deleteUser(userId: string) {
  await db.delete(users).where(eq(users.discordId, userId)).execute();
}

async function setMainRole(userId: string, guildId: string, role: Lane) {
  await upsertUser(userId);
  await ensureGuild(guildId);
  const payload = userGuildProfileInsertSchema.parse({
    userId,
    guildId,
    mainRole: role,
  });

  await db.insert(userGuildProfiles).values(payload).onConflictDoUpdate({
    target: [userGuildProfiles.userId, userGuildProfiles.guildId],
    set: {
      mainRole: role,
      updatedAt: new Date(),
    },
  }).execute();
}

async function createCustomGameEvent(event: {
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  scheduledStartAt: Date;
}) {
  // Ensure the creator exists as a user.
  await upsertUser(event.creatorId);
  await ensureGuild(event.guildId);
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

async function getEventStartingTodayByCreatorId(creatorId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return await db.query.customGameEvents.findFirst({
    where: and(
      eq(customGameEvents.creatorId, creatorId),
      gte(customGameEvents.scheduledStartAt, todayStart),
      lte(customGameEvents.scheduledStartAt, todayEnd),
    ),
  });
}

async function createMatchParticipant(
  participantData: z.infer<typeof matchParticipantInsertSchema>,
) {
  // 存在チェック
  const userExists = await db.query.users.findFirst({
    where: eq(users.discordId, participantData.userId),
  });
  if (!userExists) {
    throw new RecordNotFoundError(
      `User with id ${participantData.userId} not found`,
    );
  }

  const matchExists = await db.query.matches.findFirst({
    where: eq(matches.id, participantData.matchId),
  });
  if (!matchExists) {
    throw new RecordNotFoundError(
      `Match with id ${participantData.matchId} not found`,
    );
  }

  const parsed = matchParticipantInsertSchema.parse(participantData);
  const result = await db.insert(matchParticipants).values(parsed).returning({
    id: matchParticipants.id,
  });
  return result[0];
}

async function getAuthState(state: string) {
  return await db.query.authStates.findFirst({
    where: eq(authStates.state, state),
  });
}

async function deleteAuthState(state: string) {
  await db.delete(authStates).where(eq(authStates.state, state)).execute();
}

async function updateUserRiotId(discordId: string, riotId: string) {
  await db.update(users).set({ riotId }).where(eq(users.discordId, discordId))
    .execute();
}

async function linkUserWithRiotId(discordId: string, riotId: string) {
  const payload = userInsertSchema.parse({ discordId, riotId });

  await db.insert(users).values(payload).onConflictDoUpdate({
    target: users.discordId,
    set: { riotId },
  }).execute();
}

async function createAuthState(state: string, discordId: string) {
  await db.insert(authStates).values({ state, discordId }).execute();
}

export const dbActions = {
  upsertUser,
  ensureGuild,
  deleteUser,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEventByDiscordEventId,
  getEventStartingTodayByCreatorId,
  createMatchParticipant,
  getAuthState,
  deleteAuthState,
  updateUserRiotId,
  linkUserWithRiotId,
  createAuthState,
};
