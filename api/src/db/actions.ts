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
  matchWatchers,
  type MatchWatcherState,
  riotAccounts,
  type RiotPlatform,
  type RiotRegion,
  riotStaticDataCache,
  userGuildProfiles,
  users,
} from "./schema.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const riotAccountInsertSchema = createInsertSchema(riotAccounts);
const riotStaticDataCacheInsertSchema = createInsertSchema(riotStaticDataCache);
const userGuildProfileInsertSchema = createInsertSchema(userGuildProfiles);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);
const matchParticipantInsertSchema = createInsertSchema(matchParticipants);
const matchWatcherInsertSchema = createInsertSchema(matchWatchers);

const DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD = 20;

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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
  await db.transaction(async (tx) => {
    // ユーザーが存在しない場合は作成する
    const userPayload = userInsertSchema.parse({ discordId: userId });
    await tx.insert(users).values(userPayload).onConflictDoNothing().execute();

    // ギルドが存在しない場合は作成する
    const guildPayload = guildInsertSchema.parse({ id: guildId });
    await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
      .execute();

    // ユーザーのギルドプロファイル（メインロール）を更新または作成する
    const profilePayload = userGuildProfileInsertSchema.parse({
      userId,
      guildId,
      mainRole: role,
    });

    await tx.insert(userGuildProfiles).values(profilePayload)
      .onConflictDoUpdate(
        {
          target: [userGuildProfiles.userId, userGuildProfiles.guildId],
          set: {
            mainRole: role,
            updatedAt: new Date(),
          },
        },
      ).execute();
  });
}

async function createCustomGameEvent(event: {
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  scheduledStartAt: Date;
}) {
  await db.transaction(async (tx) => {
    // ユーザーが存在しない場合は作成する
    const userPayload = userInsertSchema.parse({ discordId: event.creatorId });
    await tx.insert(users).values(userPayload).onConflictDoNothing().execute();

    // ギルドが存在しない場合は作成する
    const guildPayload = guildInsertSchema.parse({ id: event.guildId });
    await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
      .execute();

    // カスタムゲームイベントを作成する
    const parsedEvent = customGameEventInsertSchema.parse(event);
    await tx.insert(customGameEvents).values(parsedEvent).execute();
  });
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

async function upsertRiotAccount(account: {
  discordId: string;
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: RiotPlatform;
  region: RiotRegion;
}) {
  await db.transaction(async (tx) => {
    const userPayload = userInsertSchema.parse({
      discordId: account.discordId,
      riotId: account.puuid,
    });
    await tx.insert(users).values(userPayload).onConflictDoUpdate({
      target: users.discordId,
      set: { riotId: account.puuid },
    }).execute();

    const payload = riotAccountInsertSchema.parse(account);
    await tx.insert(riotAccounts).values(payload).onConflictDoUpdate({
      target: riotAccounts.discordId,
      set: {
        puuid: account.puuid,
        gameName: account.gameName,
        tagLine: account.tagLine,
        platform: account.platform,
        region: account.region,
        updatedAt: new Date(),
      },
    }).execute();
  });
}

async function getRiotAccountByDiscordId(discordId: string) {
  return await db.query.riotAccounts.findFirst({
    where: eq(riotAccounts.discordId, discordId),
  });
}

async function getRiotStaticDataCache(key: string) {
  return await db.query.riotStaticDataCache.findFirst({
    where: eq(riotStaticDataCache.key, key),
  });
}

async function upsertRiotStaticDataCache(cache: {
  key: string;
  version: string;
  value: string;
}) {
  const payload = riotStaticDataCacheInsertSchema.parse(cache);
  await db.insert(riotStaticDataCache).values(payload).onConflictDoUpdate({
    target: riotStaticDataCache.key,
    set: {
      version: cache.version,
      value: cache.value,
      updatedAt: new Date(),
    },
  }).execute();
}

async function upsertMatchWatcher(watcher: {
  guildId: string;
  targetDiscordId: string;
  requesterId: string;
  channelId: string;
}) {
  const maxEnabledPerGuild = numberEnv(
    "MATCH_WATCH_MAX_ENABLED_PER_GUILD",
    DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD,
  );

  await db.transaction(async (tx) => {
    await tx.insert(guilds).values({ id: watcher.guildId })
      .onConflictDoNothing()
      .execute();
    await tx.insert(users).values({ discordId: watcher.requesterId })
      .onConflictDoNothing().execute();

    const targetAccount = await tx.query.riotAccounts.findFirst({
      where: eq(riotAccounts.discordId, watcher.targetDiscordId),
    });
    if (!targetAccount) {
      throw new RecordNotFoundError(
        `Riot account for ${watcher.targetDiscordId} not found`,
      );
    }

    const enabledWatchers = await tx.query.matchWatchers.findMany({
      where: and(
        eq(matchWatchers.guildId, watcher.guildId),
        eq(matchWatchers.enabled, true),
      ),
    });
    const isAlreadyEnabledTarget = enabledWatchers.some((enabledWatcher) =>
      enabledWatcher.targetDiscordId === watcher.targetDiscordId
    );
    if (
      !isAlreadyEnabledTarget && enabledWatchers.length >= maxEnabledPerGuild
    ) {
      throw new MatchWatcherLimitError(
        `Enabled match watchers limit exceeded for guild ${watcher.guildId}`,
      );
    }

    const payload = matchWatcherInsertSchema.parse({
      ...watcher,
      enabled: true,
      lastState: "IDLE",
      currentGameId: null,
      currentMatchId: null,
      currentNotificationMessageId: null,
      pendingResultMatchId: null,
      pendingResultNotificationMessageId: null,
      pendingResultStartedAt: null,
      gameStartedAt: null,
      lastInGameNotifiedAt: null,
    });
    await tx.insert(matchWatchers).values(payload).onConflictDoUpdate({
      target: [matchWatchers.guildId, matchWatchers.targetDiscordId],
      set: {
        requesterId: watcher.requesterId,
        channelId: watcher.channelId,
        enabled: true,
        updatedAt: new Date(),
      },
    }).execute();
  });
}

async function getEnabledMatchWatchers() {
  return await db.query.matchWatchers.findMany({
    where: eq(matchWatchers.enabled, true),
  });
}

async function getEnabledMatchWatchersByGuild(guildId: string) {
  return await db.query.matchWatchers.findMany({
    where: and(
      eq(matchWatchers.guildId, guildId),
      eq(matchWatchers.enabled, true),
    ),
  });
}

async function updateMatchWatcherState(
  guildId: string,
  targetDiscordId: string,
  state: {
    lastState: MatchWatcherState;
    currentGameId?: string | null;
    currentMatchId?: string | null;
    currentNotificationMessageId?: string | null;
    pendingResultMatchId?: string | null;
    pendingResultNotificationMessageId?: string | null;
    pendingResultStartedAt?: Date | null;
    gameStartedAt?: Date | null;
    lastCheckedAt?: Date | null;
    lastInGameNotifiedAt?: Date | null;
  },
) {
  await db.update(matchWatchers).set({
    ...state,
    updatedAt: new Date(),
  }).where(
    and(
      eq(matchWatchers.guildId, guildId),
      eq(matchWatchers.targetDiscordId, targetDiscordId),
    ),
  ).execute();
}

async function disableMatchWatcher(guildId: string, targetDiscordId: string) {
  await db.update(matchWatchers).set({
    enabled: false,
    updatedAt: new Date(),
  }).where(
    and(
      eq(matchWatchers.guildId, guildId),
      eq(matchWatchers.targetDiscordId, targetDiscordId),
    ),
  ).execute();
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
  upsertRiotAccount,
  getRiotAccountByDiscordId,
  getRiotStaticDataCache,
  upsertRiotStaticDataCache,
  upsertMatchWatcher,
  getEnabledMatchWatchers,
  getEnabledMatchWatchersByGuild,
  updateMatchWatcherState,
  disableMatchWatcher,
  createAuthState,
};
