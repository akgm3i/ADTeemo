import { guildMatchWatchSettingsSchema } from "./watch_policy.ts";
import { customGameSettingsSchema } from "./custom_game_settings.ts";
import { notificationDeliverySchema } from "./notification_delivery.ts";
import { z } from "zod";
import {
  customGameEventPhases,
  customGameEventSyncStates,
  customGameTeams,
  lanes,
  matchWatcherStates,
  rankedQueueTypes,
  rankSnapshotPhases,
  riotPlatforms,
  riotRegions,
} from "./domain.ts";

// HTTP dates must be explicit ISO strings; null, numbers and missing fields are not dates.
export const responseDateSchema = z.iso.datetime({ offset: true }).transform((
  value,
) => new Date(value));
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const nullableDate = responseDateSchema.nullable();
export const eventResponseModelSchema = z.object({
  id: z.number().int().positive(),
  operationKey: id.nullable(),
  name: z.string(),
  guildId: id,
  creatorId: id,
  recruitmentChannelId: id.nullable(),
  voiceChannelId: id.nullable(),
  discordScheduledEventId: id.nullable(),
  recruitmentMessageId: id.nullable(),
  phase: z.enum(customGameEventPhases),
  syncState: z.enum(customGameEventSyncStates),
  revision: count,
  discordEventDeleted: z.boolean(),
  recruitmentMessageDeleted: z.boolean(),
  lastFailureCode: z.string().nullable(),
  scheduledStartAt: responseDateSchema,
  createdAt: responseDateSchema,
  updatedAt: nullableDate,
}).strict();
export const participantSchema = z.object({
  eventId: z.number().int().positive(),
  userId: id,
  team: z.enum(customGameTeams),
  lane: z.enum(lanes),
  createdAt: responseDateSchema,
}).strict();
export const riotAccountResponseSchema = z.object({
  discordId: id,
  isMain: z.boolean(),
  puuid: id,
  gameName: id,
  tagLine: id,
  platform: z.enum(riotPlatforms),
  region: z.enum(riotRegions),
  createdAt: responseDateSchema,
  updatedAt: nullableDate,
}).strict();
const watcherStateFields = {
  lastState: z.enum(matchWatcherStates),
  currentGameId: id.nullable(),
  currentMatchId: id.nullable(),
  currentNotificationMessageId: id.nullable(),
  pendingResultMatchId: id.nullable(),
  pendingResultNotificationMessageId: id.nullable(),
  pendingResultStartedAt: nullableDate,
  gameStartedAt: nullableDate,
  lastCheckedAt: nullableDate,
  lastInGameNotifiedAt: nullableDate,
};
export const watcherSchema = z.object({
  guildId: id,
  riotAccountPuuid: id,
  targetDiscordId: id,
  requesterId: id,
  channelId: id,
  enabled: z.boolean(),
  ...watcherStateFields,
  createdAt: responseDateSchema,
  updatedAt: nullableDate,
}).strict();
export const watcherStatePatchSchema = z.object(watcherStateFields).partial()
  .strict();
export const rankSnapshotResponseSchema = z.object({
  id: z.number().int().positive(),
  matchId: id,
  puuid: id,
  platform: z.enum(riotPlatforms),
  queueType: z.enum(rankedQueueTypes),
  phase: z.enum(rankSnapshotPhases),
  tier: z.string().nullable(),
  rank: z.string().nullable(),
  leaguePoints: count.nullable(),
  wins: count.nullable(),
  losses: count.nullable(),
  fetchedAt: responseDateSchema,
}).strict();
export const rankSummarySchema = z.object({
  queueType: z.enum(rankedQueueTypes),
  before: rankSnapshotResponseSchema.nullable(),
  after: rankSnapshotResponseSchema.nullable(),
}).strict();
export const opggDetailResponseSchema = z.object({
  provider: z.literal("opgg"),
  providerRegion: id,
  providerMatchId: id,
  detailUrl: z.url(),
  providerCreatedAt: responseDateSchema,
  averageTier: z.string().nullable(),
  participant: z.object({
    puuid: id,
    participantId: count.nullable(),
    laneScore: z.number().nullable(),
  }).strict().optional(),
}).strict();
// Riot adds fields independently. Validate the consumed subset without rejecting upstream additions.
export const activeGameResponseSchema = z.object({
  gameId: count,
  gameType: id,
  gameStartTime: count,
  mapId: count,
  gameLength: count.optional(),
  gameMode: id,
  gameQueueConfigId: count.optional(),
  participants: z.array(
    z.object({
      puuid: id.optional(),
      summonerName: z.string().optional(),
      riotId: z.string().optional(),
      championId: count,
      teamId: count,
    }),
  ),
});
export const riotMatchResponseSchema = z.object({
  metadata: z.object({ matchId: id, participants: z.array(id) }),
  info: z.object({
    gameId: count,
    gameCreation: count,
    gameDuration: count,
    gameEndTimestamp: count.optional(),
    gameMode: id,
    gameType: id,
    mapId: count,
    queueId: count,
    participants: z.array(z.object({
      puuid: id,
      riotIdGameName: z.string().optional(),
      riotIdTagline: z.string().optional(),
      summonerName: z.string().optional(),
      championId: count.optional(),
      championName: id,
      teamId: count,
      win: z.boolean(),
      kills: count,
      deaths: count,
      assists: count,
      totalMinionsKilled: count,
      neutralMinionsKilled: count,
      goldEarned: count,
      totalDamageDealtToChampions: count.optional(),
      visionScore: count.optional(),
      totalAllyJungleMinionsKilled: count.optional(),
      totalEnemyJungleMinionsKilled: count.optional(),
      teamPosition: z.string().optional(),
      individualPosition: z.string().optional(),
    })),
  }),
});
export const leagueEntrySchema = z.object({
  queueType: id,
  tier: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: count,
  wins: count,
  losses: count,
});
export const staticDataSchema = z.object({
  champions: z.record(
    z.string(),
    z.object({ name: z.string().nullable(), iconUrl: z.url().nullable() })
      .strict(),
  ),
  queues: z.record(z.string(), z.string().nullable()),
  maps: z.record(z.string(), z.string().nullable()),
  gameModes: z.record(z.string(), z.string().nullable()),
}).strict();
export const notificationIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["started", "progress"]),
    activeGame: activeGameResponseSchema,
  }).strict(),
  z.object({ kind: z.literal("resultPending"), matchId: id }).strict(),
  z.object({ kind: z.literal("timeout"), matchId: id }).strict(),
  z.object({
    kind: z.literal("result"),
    match: riotMatchResponseSchema,
    rankSummary: rankSummarySchema.nullable(),
    opggDetail: opggDetailResponseSchema.nullable(),
  }).strict(),
]);
export const stateTransitionSchema = z.object({
  state: watcherStatePatchSchema,
  messageIdField: z.enum([
    "currentNotificationMessageId",
    "pendingResultNotificationMessageId",
  ]).nullable(),
}).strict();

export type ResponseContract<T = unknown> = {
  method: string;
  path: string;
  statuses: readonly number[];
  schema: z.ZodType<T>;
};
function contract<S extends z.ZodType>(
  method: string,
  path: string,
  statuses: readonly number[],
  schema: S,
) {
  return { method, path, statuses, schema };
}
const empty = z.undefined().transform(() => ({}));
const event = z.object({ event: eventResponseModelSchema }).strict();
const participants = z.object({ participants: z.array(participantSchema) })
  .strict();
export const responseContracts = {
  watchSettings: contract(
    "GET",
    "/watch-policy/:guildId/settings",
    [200],
    z.object({ settings: guildMatchWatchSettingsSchema }).strict(),
  ),
  configureWatchSettings: contract(
    "PUT",
    "/watch-policy/:guildId/settings",
    [200],
    z.object({
      settings: guildMatchWatchSettingsSchema,
      limitedAccountCount: count,
    }).strict(),
  ),
  watchMembers: contract(
    "PUT",
    "/watch-policy/:guildId/members",
    [200],
    z.object({ limitedAccountCount: count }).strict(),
  ),
  watchPreference: contract(
    "PUT",
    "/watch-policy/:guildId/preferences/:discordId",
    [204],
    empty,
  ),
  getNextCustomGameSequence: contract("GET", "/events/:eventId/next-game", [
    200,
  ], z.object({ gameSequence: z.number().int().positive() }).strict()),
  getCustomGameSettings: contract(
    "GET",
    "/guild-settings/:guildId/custom-game",
    [200],
    z.object({ settings: customGameSettingsSchema.nullable() }).strict(),
  ),
  setCustomGameSettings: contract(
    "PUT",
    "/guild-settings/:guildId/custom-game",
    [200],
    z.object({ settings: customGameSettingsSchema }).strict(),
  ),
  prepareNotificationDelivery: contract(
    "PUT",
    "/notification-deliveries/:key",
    [200],
    z.object({ delivery: notificationDeliverySchema }).strict(),
  ),
  claimNotificationDelivery: contract(
    "POST",
    "/notification-deliveries/:key/claim",
    [200],
    z.object({ delivery: notificationDeliverySchema.nullable() }).strict(),
  ),
  completeNotificationDelivery: contract(
    "POST",
    "/notification-deliveries/:key/complete",
    [200],
    z.object({ delivery: notificationDeliverySchema }).strict(),
  ),
  failNotificationDelivery: contract(
    "POST",
    "/notification-deliveries/:key/fail",
    [200],
    z.object({ delivery: notificationDeliverySchema }).strict(),
  ),
  pendingNotificationDeliveries: contract(
    "GET",
    "/notification-deliveries/pending",
    [200],
    z.object({ deliveries: z.array(notificationDeliverySchema) }).strict(),
  ),
  health: contract(
    "GET",
    "/health",
    [200],
    z.object({ message: z.string() }).strict(),
  ),
  loginUrl: contract(
    "GET",
    "/auth/rso/login-url",
    [200],
    z.object({ url: z.url() }).strict(),
  ),
  linkAccount: contract("PATCH", "/users/link-by-riot-id", [204], empty),
  riotAccount: contract(
    "GET",
    "/users/:userId/riot-account",
    [200],
    z.object({ account: riotAccountResponseSchema }).strict(),
  ),
  riotAccounts: contract(
    "GET",
    "/users/:userId/riot-accounts",
    [200],
    z.object({ accounts: z.array(riotAccountResponseSchema) }).strict(),
  ),
  mainRiotAccount: contract("PUT", "/users/:userId/riot-accounts/:puuid/main", [
    204,
  ], empty),
  deleteRiotAccount: contract("DELETE", "/users/:userId/riot-accounts/:puuid", [
    204,
  ], empty),
  mainRole: contract("PUT", "/users/:userId/main-role", [204], empty),
  prepareEvent: contract(
    "POST",
    "/events",
    [200, 201],
    z.object({ created: z.boolean(), event: eventResponseModelSchema })
      .strict(),
  ),
  eventCreation: contract("PATCH", "/events/:eventId/creation", [200], event),
  activateEvent: contract("POST", "/events/:eventId/activate", [200], event),
  eventCreationFailure: contract("POST", "/events/:eventId/creation-failure", [
    200,
  ], event),
  eventsByCreator: contract(
    "GET",
    "/events/by-creator/:guildId/:channelId/:creatorId",
    [200],
    z.object({ events: z.array(eventResponseModelSchema) }).strict(),
  ),
  eventToday: contract(
    "GET",
    "/events/today/:guildId/:channelId/by-creator/:creatorId",
    [200],
    event,
  ),
  cancelEvent: contract("POST", "/events/:eventId/cancel", [200], event),
  eventCancellation: contract("PATCH", "/events/:eventId/cancel", [200], event),
  confirmParticipants: contract(
    "POST",
    "/events/:eventId/participants/confirm",
    [200],
    participants,
  ),
  saveParticipants: contract(
    "PUT",
    "/events/:eventId/participants",
    [200],
    participants,
  ),
  getParticipants: contract(
    "GET",
    "/events/:eventId/participants",
    [200],
    participants,
  ),
  recordMatch: contract(
    "POST",
    "/matches/custom",
    [200, 201],
    z.object({
      created: z.boolean(),
      matchId: id,
      participantCount: z.literal(10),
    }).strict(),
  ),
  pendingRankSnapshots: contract("POST", "/matches/rank-snapshots/pending", [
    204,
  ], empty),
  finalizeRankSnapshots: contract(
    "POST",
    "/matches/:matchId/rank-snapshots/finalize",
    [200],
    z.object({
      snapshots: z.object({
        before: z.array(rankSnapshotResponseSchema),
        after: z.array(rankSnapshotResponseSchema),
      }).strict(),
    }).strict(),
  ),
  opggDetail: contract(
    "POST",
    "/matches/:matchId/external-details/opgg/resolve",
    [200],
    z.object({ detail: opggDetailResponseSchema.nullable() }).strict(),
  ),
  watchMatch: contract("POST", "/match-watchers", [204], empty),
  unwatchMatch: contract(
    "DELETE",
    "/match-watchers/:guildId/:targetDiscordId",
    [204],
    empty,
  ),
  watchers: contract(
    "GET",
    "/match-watchers/enabled",
    [200],
    z.object({ watchers: z.array(watcherSchema) }).strict(),
  ),
  guildWatchers: contract(
    "GET",
    "/match-watchers/enabled/:guildId",
    [200],
    z.object({ watchers: z.array(watcherSchema) }).strict(),
  ),
  watcherState: contract(
    "PATCH",
    "/match-watchers/:guildId/:targetDiscordId/state",
    [204],
    empty,
  ),
  inspectActiveGame: contract(
    "POST",
    "/match-watchers/:guildId/:targetDiscordId/tracking/active-game",
    [200],
    z.object({
      account: riotAccountResponseSchema,
      activeGame: activeGameResponseSchema.nullable(),
      notificationIntent: notificationIntentSchema.nullable(),
      stateTransition: stateTransitionSchema.nullable(),
    }).strict(),
  ),
  inspectResult: contract(
    "POST",
    "/match-watchers/:guildId/:targetDiscordId/tracking/result",
    [200],
    z.object({
      account: riotAccountResponseSchema,
      match: riotMatchResponseSchema.nullable(),
      rankSummary: rankSummarySchema.nullable(),
      opggDetail: opggDetailResponseSchema.nullable(),
      notificationIntent: notificationIntentSchema.nullable(),
      stateTransition: stateTransitionSchema.nullable(),
    }).strict(),
  ),
  activeGame: contract(
    "GET",
    "/riot/active-games/:platform/:puuid",
    [200],
    z.object({ activeGame: activeGameResponseSchema.nullable() }).strict(),
  ),
  riotMatch: contract(
    "GET",
    "/riot/matches/:region/:matchId",
    [200],
    z.object({ match: riotMatchResponseSchema.nullable() }).strict(),
  ),
  leagueEntries: contract(
    "GET",
    "/riot/league-entries/:platform/:puuid",
    [200],
    z.object({ entries: z.array(leagueEntrySchema) }).strict(),
  ),
  staticData: contract(
    "POST",
    "/riot/static-data/resolve",
    [200],
    staticDataSchema,
  ),
};
