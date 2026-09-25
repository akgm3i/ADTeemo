import { z } from "zod";
import {
  customGameTeams,
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

const nonEmptyId = z.string().trim().min(1).max(128);

export const eventIdParamSchema = z.object({
  eventId: z.coerce.number().int().positive(),
});

export const eventScopeSchema = z.object({
  guildId: nonEmptyId,
  recruitmentChannelId: nonEmptyId,
});

export const prepareEventSchema = eventScopeSchema.extend({
  // Discord message nonce is limited to 25 characters.
  operationKey: z.string().trim().min(1).max(25),
  name: z.string().trim().min(1).max(100),
  creatorId: nonEmptyId,
  voiceChannelId: nonEmptyId,
  scheduledStartAt: z.coerce.date(),
});

export const eventCreationProgressSchema = eventScopeSchema.extend({
  discordScheduledEventId: nonEmptyId.optional(),
  recruitmentMessageId: nonEmptyId.optional(),
}).refine(
  (value) =>
    value.discordScheduledEventId !== undefined ||
    value.recruitmentMessageId !== undefined,
  { message: "At least one Discord id is required" },
);

export const eventCreationFailureSchema = eventScopeSchema.extend({
  discordScheduledEventId: nonEmptyId.optional(),
  recruitmentMessageId: nonEmptyId.optional(),
  discordEventDeleted: z.boolean(),
  recruitmentMessageDeleted: z.boolean(),
  failureCode: z.string().regex(/^[A-Z0-9_]{1,64}$/),
});

export const eventCancellationProgressSchema = eventScopeSchema.extend({
  discordScheduledEventId: nonEmptyId.optional(),
  recruitmentMessageId: nonEmptyId.optional(),
  discordEventDeleted: z.boolean().optional(),
  recruitmentMessageDeleted: z.boolean().optional(),
  failureCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).nullable().optional(),
}).refine(
  (value) =>
    value.discordScheduledEventId !== undefined ||
    value.recruitmentMessageId !== undefined ||
    value.discordEventDeleted !== undefined ||
    value.recruitmentMessageDeleted !== undefined ||
    value.failureCode !== undefined,
  { message: "Cancellation progress must include a change" },
);

export const eventParticipantSchema = z.object({
  userId: nonEmptyId,
  team: z.enum(customGameTeams),
  lane: z.enum(lanes),
});

export const saveEventParticipantsSchema = eventScopeSchema.extend({
  participants: z.array(eventParticipantSchema).length(10),
}).superRefine((value, context) => {
  const userIds = new Set<string>();
  const assignments = new Set<string>();
  value.participants.forEach((participant, index) => {
    if (userIds.has(participant.userId)) {
      context.addIssue({
        code: "custom",
        message: "Participant userId must be unique within an event",
        path: ["participants", index, "userId"],
      });
    }
    userIds.add(participant.userId);

    const assignment = `${participant.team}:${participant.lane}`;
    if (assignments.has(assignment)) {
      context.addIssue({
        code: "custom",
        message: "Each team and lane assignment must be unique",
        path: ["participants", index, "lane"],
      });
    }
    assignments.add(assignment);
  });
});

export const customMatchStatSchema = z.object({
  userId: nonEmptyId,
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  cs: z.number().int().min(0),
  gold: z.number().int().min(0),
});

export const recordCustomMatchSchema = eventScopeSchema.extend({
  eventId: z.number().int().positive(),
  gameSequence: z.number().int().positive(),
  winner: z.enum(customGameTeams),
  stats: z.array(customMatchStatSchema).length(10),
}).superRefine((value, context) => {
  const userIds = new Set<string>();
  value.stats.forEach((stat, index) => {
    if (userIds.has(stat.userId)) {
      context.addIssue({
        code: "custom",
        message: "Stat userId must be unique within a match",
        path: ["stats", index, "userId"],
      });
    }
    userIds.add(stat.userId);
  });
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
  riotAccountPuuid: z.string().min(1).optional(),
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
  inspectionBatchId: z.uuid().optional(),
  riotAccountPuuid: z.string().min(1).optional(),
  lastState: z.enum(matchWatcherStates),
  currentGameId: z.string().nullable(),
  currentNotificationMessageId: z.string().nullable().optional(),
  gameStartedAt: z.coerce.date().nullable().optional(),
  lastInGameNotifiedAt: z.coerce.date().nullable().optional(),
  notificationLastInGameNotifiedAt: z.coerce.date().nullable().optional(),
  inGameNotifyIntervalMs: z.number().int().nonnegative().optional(),
});

export const inspectMatchWatcherResultSchema = z.object({
  inspectionBatchId: z.uuid().optional(),
  riotAccountPuuid: z.string().min(1).optional(),
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
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(256),
}).strict();

export const loginUrlQuerySchema = z.object({
  discordId: z.string().min(1),
  guildId: z.string().min(1),
  platform: z.enum(riotPlatforms).default("jp1"),
  region: z.enum(riotRegions).default("asia"),
}).strict();

export type MatchParticipant = z.infer<typeof createParticipantSchema>;
export type CustomMatchStat = z.infer<typeof customMatchStatSchema>;
export type RecordCustomMatchInput = z.infer<typeof recordCustomMatchSchema>;
export type RankSnapshotPayload = z.infer<
  typeof upsertPendingRankSnapshotsSchema
>["snapshots"][number];
export type ResolveOpggMatchDetailPayload = z.infer<
  typeof resolveOpggMatchDetailSchema
>;
export type RiotStaticDataResolveInput = z.infer<
  typeof riotStaticDataResolveSchema
>;
