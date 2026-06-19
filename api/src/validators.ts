import { z } from "zod";
import {
  externalMatchProviders,
  lanes,
  rankedQueueTypes,
  riotPlatforms,
} from "./db/schema.ts";

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

export const upsertExternalMatchDetailSchema = z.object({
  provider: z.enum(externalMatchProviders),
  providerRegion: z.string().min(1),
  providerMatchId: z.string().min(1),
  detailUrl: z.string().url(),
  providerCreatedAt: z.coerce.date(),
  averageTier: z.string().nullable().default(null),
  participant: z.object({
    puuid: z.string().min(1),
    participantId: z.number().int().min(0).nullable().default(null),
    laneScore: z.number().nullable().default(null),
  }).optional(),
});
