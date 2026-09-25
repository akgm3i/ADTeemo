import type { z } from "zod";
import type {
  activeGameResponseSchema,
  eventResponseModelSchema,
  leagueEntrySchema,
  notificationIntentSchema,
  opggDetailResponseSchema,
  participantSchema,
  rankSnapshotResponseSchema,
  rankSummarySchema,
  riotAccountResponseSchema,
  riotMatchResponseSchema,
  stateTransitionSchema,
  staticDataSchema,
  watcherSchema,
  watcherStatePatchSchema,
} from "./responses.ts";
import type {
  ExternalMatchProvider,
  RankedQueueType,
  RiotPlatform,
} from "./domain.ts";

export type Event = z.output<typeof eventResponseModelSchema>;

export type CustomGameEventParticipant = z.output<typeof participantSchema>;

export type RiotAccount = z.output<typeof riotAccountResponseSchema>;

export type MatchWatcher = z.output<typeof watcherSchema>;

export type MatchWatcherStatePatch = z.output<typeof watcherStatePatchSchema>;

export type PendingMatchRankSnapshot = {
  platform: RiotPlatform;
  gameId: string;
  puuid: string;
  queueType: RankedQueueType;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
  expiresAt: Date;
};

export type MatchRankSnapshot = z.output<typeof rankSnapshotResponseSchema>;

export type MatchTrackingRankSummary = z.output<typeof rankSummarySchema>;

export type ExternalMatchDetail = {
  matchId: string;
  provider: ExternalMatchProvider;
  providerRegion: string;
  providerMatchId: string;
  detailUrl: string;
  providerCreatedAt: Date;
  averageTier: string | null;
  fetchedAt: Date;
};

export type ExternalMatchParticipantDetail = {
  matchId: string;
  provider: ExternalMatchProvider;
  puuid: string;
  participantId: number | null;
  laneScore: number | null;
  fetchedAt: Date;
};

export type OpggMatchDetail = z.output<typeof opggDetailResponseSchema>;

export type RiotStaticDataResolveData = z.output<typeof staticDataSchema>;

export type ActiveGame = z.output<typeof activeGameResponseSchema>;

export type RiotMatch = z.output<typeof riotMatchResponseSchema>;

export type LeagueEntry = z.output<typeof leagueEntrySchema>;

export type MatchTrackingNotificationIntent = z.output<
  typeof notificationIntentSchema
>;

export type MatchTrackingStateTransition = z.output<
  typeof stateTransitionSchema
>;
