import { z } from "zod";
import {
  lanes,
  matchWatcherStates,
  rankedQueueTypes,
  riotPlatforms,
  riotRegions,
} from "./domain.ts";

export const roleSchema = z.object({
  guildId: z.string(),
  role: z.enum(lanes),
});

export const linkByRiotIdSchema = z.object({
  discordId: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
  platform: z.enum(riotPlatforms).optional(),
  region: z.enum(riotRegions).optional(),
});

export const createEventSchema = z.object({
  name: z.string(),
  guildId: z.string(),
  creatorId: z.string(),
  discordScheduledEventId: z.string(),
  recruitmentMessageId: z.string(),
  scheduledStartAt: z.coerce.date(),
});

export const createParticipantSchema = z.object({
  userId: z.string(),
  team: z.enum(["BLUE", "RED"]),
  win: z.boolean(),
  lane: z.enum(lanes),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  cs: z.number().int().min(0),
  gold: z.number().int().min(0),
});

const rankSnapshotPayloadSchema = z.object({
  queueType: z.enum(rankedQueueTypes),
  tier: z.string().nullable(),
  rank: z.string().nullable(),
  leaguePoints: z.number().int().min(0).nullable(),
  wins: z.number().int().min(0).nullable(),
  losses: z.number().int().min(0).nullable(),
  fetchedAt: z.coerce.date().optional(),
});

export const upsertPendingRankSnapshotsSchema = z.object({
  platform: z.enum(riotPlatforms),
  gameId: z.string(),
  puuid: z.string(),
  snapshots: z.array(rankSnapshotPayloadSchema).min(1),
});

export const finalizeRankSnapshotsSchema = z.object({
  platform: z.enum(riotPlatforms),
  gameId: z.string(),
  puuid: z.string(),
  snapshots: z.array(rankSnapshotPayloadSchema).min(1),
});

export const resolveOpggMatchDetailSchema = z.object({
  targetDiscordId: z.string().min(1),
  match: z.object({
    gameCreation: z.number().int().nonnegative(),
    gameDuration: z.number().int().nonnegative(),
    queueId: z.number().int().nonnegative(),
    participant: z.object({
      puuid: z.string().min(1),
      championId: z.number().int().nonnegative().optional(),
      championName: z.string().min(1).optional(),
    }),
  }),
});

export const createMatchWatcherSchema = z.object({
  guildId: z.string(),
  targetDiscordId: z.string(),
  requesterId: z.string(),
  channelId: z.string(),
});

export const updateMatchWatcherStateSchema = z.object({
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

export const inspectMatchWatcherActiveGameSchema = z.object({
  lastState: z.enum(matchWatcherStates),
  currentGameId: z.string().nullable(),
  currentNotificationMessageId: z.string().nullable().optional(),
  gameStartedAt: z.coerce.date().nullable().optional(),
  lastInGameNotifiedAt: z.coerce.date().nullable().optional(),
  notificationLastInGameNotifiedAt: z.coerce.date().nullable().optional(),
  inGameNotifyIntervalMs: z.number().int().nonnegative().optional(),
});

export const inspectMatchWatcherResultSchema = z.object({
  matchId: z.string().min(1),
  messageId: z.string().nullable().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  resultFetchTimeoutMs: z.number().int().nonnegative().optional(),
});

export const platformAndPuuidSchema = z.object({
  platform: z.enum(riotPlatforms),
  puuid: z.string().min(1),
});

export const regionAndMatchIdSchema = z.object({
  region: z.enum(riotRegions),
  matchId: z.string().min(1),
});

export const riotStaticDataResolveSchema = z.object({
  locale: z.string().trim().min(1).max(32).optional(),
  championIds: z.array(z.number().int().nonnegative()).max(20).default([]),
  queueIds: z.array(z.number().int().nonnegative()).max(10).default([]),
  mapIds: z.array(z.number().int().nonnegative()).max(10).default([]),
  gameModes: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
});

export const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const loginUrlQuerySchema = z.object({
  discordId: z.string().min(1),
});

export type MatchParticipant = z.infer<typeof createParticipantSchema>;
export type RankSnapshotPayload = z.infer<
  typeof upsertPendingRankSnapshotsSchema
>["snapshots"][number];
export type ResolveOpggMatchDetailPayload = z.infer<
  typeof resolveOpggMatchDetailSchema
>;
export type RiotStaticDataResolveInput = z.infer<
  typeof riotStaticDataResolveSchema
>;
