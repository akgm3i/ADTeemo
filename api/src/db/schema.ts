import type { CustomGameSettings } from "../contract/custom_game_settings.ts";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { type InferSelectModel, relations, sql } from "drizzle-orm";
import {
  type NotificationDelivery,
  notificationFailureReasons,
} from "../contract/notification_delivery.ts";
import {
  customGameEventPhases,
  customGameEventSyncStates,
  customGameTeams,
  externalMatchProviders,
  lanes,
  matchWatcherStates,
  rankedQueueTypes,
  rankSnapshotPhases,
  riotPlatforms,
  riotRegions,
} from "../contract/domain.ts";

export {
  customGameEventPhases,
  customGameEventSyncStates,
  customGameTeams,
  externalMatchProviders,
  lanes,
  matchWatcherStates,
  rankedQueueTypes,
  rankSnapshotPhases,
  riotPlatforms,
  riotRegions,
} from "../contract/domain.ts";
export type {
  CustomGameEventPhase,
  CustomGameEventSyncState,
  CustomGameTeam,
  ExternalMatchProvider,
  Lane,
  MatchWatcherState,
  RankedQueueType,
  RankSnapshotPhase,
  RiotPlatform,
  RiotRegion,
} from "../contract/domain.ts";

export const guilds = sqliteTable("guilds", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
});

export const users = sqliteTable("users", {
  discordId: text("discord_id").primaryKey(),
  riotId: text("riot_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
});

export const riotAccounts = sqliteTable("riot_accounts", {
  discordId: text("discord_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  puuid: text("puuid").primaryKey(),
  isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  platform: text("platform", { enum: riotPlatforms }).notNull(),
  region: text("region", { enum: riotRegions }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
}, (table) => [
  index("riot_accounts_owner").on(table.discordId),
  uniqueIndex("riot_accounts_one_main").on(table.discordId).where(
    sql`${table.isMain} = 1`,
  ),
]);

export const riotStaticDataCache = sqliteTable("riot_static_data_cache", {
  key: text("key").primaryKey(),
  version: text("version").notNull(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
});

export const userGuildProfiles = sqliteTable("user_guild_profiles", {
  userId: text("user_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  mainRole: text("main_role", { enum: lanes }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.guildId] }),
}));

export const customGameEvents = sqliteTable("custom_game_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationKey: text("operation_key").unique(),
  name: text("name").notNull(),
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  creatorId: text("creator_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  recruitmentChannelId: text("recruitment_channel_id"),
  voiceChannelId: text("voice_channel_id"),
  discordScheduledEventId: text("discord_scheduled_event_id").unique(),
  recruitmentMessageId: text("recruitment_message_id").unique(),
  phase: text("phase", { enum: customGameEventPhases }).notNull().default(
    "RECRUITING",
  ),
  syncState: text("sync_state", { enum: customGameEventSyncStates }).notNull()
    .default(
      "CONSISTENT",
    ),
  revision: integer("revision").notNull().default(0),
  discordEventDeleted: integer("discord_event_deleted", { mode: "boolean" })
    .notNull().default(false),
  recruitmentMessageDeleted: integer("recruitment_message_deleted", {
    mode: "boolean",
  }).notNull().default(false),
  lastFailureCode: text("last_failure_code"),
  scheduledStartAt: integer("scheduled_start_at", { mode: "timestamp" })
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
});

export const customGameEventParticipants = sqliteTable(
  "custom_game_event_participants",
  {
    eventId: integer("event_id").notNull().references(
      () => customGameEvents.id,
      { onDelete: "cascade" },
    ),
    userId: text("user_id").notNull().references(() => users.discordId, {
      onDelete: "cascade",
    }),
    team: text("team", { enum: customGameTeams }).notNull(),
    lane: text("lane", { enum: lanes }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.userId] }),
    uniqueTeamLane: uniqueIndex(
      "custom_game_event_participants_unique_team_lane",
    ).on(table.eventId, table.team, table.lane),
  }),
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(), // Riot Match ID or custom:<eventId>:<gameSequence>
    customGameEventId: integer("custom_game_event_id").references(
      () => customGameEvents.id,
    ),
    gameSequence: integer("game_sequence"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueCustomGameSequence: uniqueIndex(
      "matches_unique_custom_game_sequence",
    ).on(table.customGameEventId, table.gameSequence),
  }),
);

export const matchParticipants = sqliteTable("match_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id").notNull().references(() => matches.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  riotPuuid: text("riot_puuid"),
  team: text("team", { enum: customGameTeams }).notNull(),
  win: integer("win", { mode: "boolean" }).notNull(),
  lane: text("lane", { enum: lanes }).notNull(),
  kills: integer("kills").notNull(),
  deaths: integer("deaths").notNull(),
  assists: integer("assists").notNull(),
  cs: integer("cs").notNull(),
  gold: integer("gold").notNull(),
}, (table) => ({
  uniqueMatchUser: uniqueIndex("match_participants_unique_match_user").on(
    table.matchId,
    table.userId,
  ),
}));

export const pendingMatchRankSnapshots = sqliteTable(
  "pending_match_rank_snapshots",
  {
    platform: text("platform", { enum: riotPlatforms }).notNull(),
    gameId: text("game_id").notNull(),
    puuid: text("puuid").notNull(),
    queueType: text("queue_type", { enum: rankedQueueTypes }).notNull(),
    tier: text("tier"),
    rank: text("rank"),
    leaguePoints: integer("league_points"),
    wins: integer("wins"),
    losses: integer("losses"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.platform, table.gameId, table.puuid, table.queueType],
    }),
  }),
);

export const matchRankSnapshots = sqliteTable(
  "match_rank_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: text("match_id").notNull().references(() => matches.id, {
      onDelete: "cascade",
    }),
    puuid: text("puuid").notNull(),
    platform: text("platform", { enum: riotPlatforms }).notNull(),
    queueType: text("queue_type", { enum: rankedQueueTypes }).notNull(),
    phase: text("phase", { enum: rankSnapshotPhases }).notNull(),
    tier: text("tier"),
    rank: text("rank"),
    leaguePoints: integer("league_points"),
    wins: integer("wins"),
    losses: integer("losses"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueSnapshot: uniqueIndex("match_rank_snapshots_unique_snapshot").on(
      table.matchId,
      table.puuid,
      table.queueType,
      table.phase,
    ),
  }),
);

export const externalMatchDetails = sqliteTable(
  "external_match_details",
  {
    matchId: text("match_id").notNull().references(() => matches.id, {
      onDelete: "cascade",
    }),
    provider: text("provider", { enum: externalMatchProviders }).notNull(),
    providerRegion: text("provider_region").notNull(),
    providerMatchId: text("provider_match_id").notNull(),
    detailUrl: text("detail_url").notNull(),
    providerCreatedAt: integer("provider_created_at", {
      mode: "timestamp",
    }).notNull(),
    averageTier: text("average_tier"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchId, table.provider] }),
    uniqueProviderMatch: uniqueIndex(
      "external_match_details_unique_provider_match",
    ).on(table.provider, table.providerRegion, table.providerMatchId),
  }),
);

export const externalMatchParticipantDetails = sqliteTable(
  "external_match_participant_details",
  {
    matchId: text("match_id").notNull().references(() => matches.id, {
      onDelete: "cascade",
    }),
    provider: text("provider", { enum: externalMatchProviders }).notNull(),
    puuid: text("puuid").notNull(),
    participantId: integer("participant_id"),
    laneScore: real("lane_score"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchId, table.provider, table.puuid] }),
  }),
);

export const matchWatchers = sqliteTable("match_watchers", {
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  riotAccountPuuid: text("riot_account_puuid").notNull().references(
    () => riotAccounts.puuid,
    { onDelete: "cascade" },
  ),
  targetDiscordId: text("target_discord_id").notNull().references(
    () => users.discordId,
    { onDelete: "cascade" },
  ),
  requesterId: text("requester_id").notNull().references(
    () => users.discordId,
    {
      onDelete: "cascade",
    },
  ),
  channelId: text("channel_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastState: text("last_state", { enum: matchWatcherStates }).notNull().default(
    "IDLE",
  ),
  currentGameId: text("current_game_id"),
  currentMatchId: text("current_match_id"),
  currentNotificationMessageId: text("current_notification_message_id"),
  pendingResultMatchId: text("pending_result_match_id"),
  pendingResultNotificationMessageId: text(
    "pending_result_notification_message_id",
  ),
  pendingResultStartedAt: integer("pending_result_started_at", {
    mode: "timestamp",
  }),
  gameStartedAt: integer("game_started_at", { mode: "timestamp" }),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  lastInGameNotifiedAt: integer("last_in_game_notified_at", {
    mode: "timestamp",
  }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
}, (table) => ({
  pk: primaryKey({ columns: [table.guildId, table.riotAccountPuuid] }),
}));

export type Event = InferSelectModel<typeof customGameEvents>;
export type CustomGameEventParticipant = InferSelectModel<
  typeof customGameEventParticipants
>;
export type Match = InferSelectModel<typeof matches>;
export type RiotAccount = InferSelectModel<typeof riotAccounts>;
export type RiotStaticDataCache = InferSelectModel<typeof riotStaticDataCache>;
export type MatchWatcher = InferSelectModel<typeof matchWatchers>;
export type PendingMatchRankSnapshot = InferSelectModel<
  typeof pendingMatchRankSnapshots
>;
export type MatchRankSnapshot = InferSelectModel<typeof matchRankSnapshots>;
export type ExternalMatchDetail = InferSelectModel<
  typeof externalMatchDetails
>;
export type ExternalMatchParticipantDetail = InferSelectModel<
  typeof externalMatchParticipantDetails
>;

// --- RELATIONS ---

export const usersRelations = relations(users, ({ many }) => ({
  matchParticipations: many(matchParticipants),
  createdCustomGameEvents: many(customGameEvents),
  guildProfiles: many(userGuildProfiles),
  watchedBy: many(matchWatchers),
}));

export const riotAccountsRelations = relations(riotAccounts, ({ one }) => ({
  user: one(users, {
    fields: [riotAccounts.discordId],
    references: [users.discordId],
  }),
}));

export const userGuildProfilesRelations = relations(
  userGuildProfiles,
  ({ one }) => ({
    user: one(users, {
      fields: [userGuildProfiles.userId],
      references: [users.discordId],
    }),
    guild: one(guilds, {
      fields: [userGuildProfiles.guildId],
      references: [guilds.id],
    }),
  }),
);

export const matchesRelations = relations(matches, ({ many, one }) => ({
  participants: many(matchParticipants),
  rankSnapshots: many(matchRankSnapshots),
  customGameEvent: one(customGameEvents, {
    fields: [matches.customGameEventId],
    references: [customGameEvents.id],
  }),
}));

export const customGameEventParticipantsRelations = relations(
  customGameEventParticipants,
  ({ one }) => ({
    event: one(customGameEvents, {
      fields: [customGameEventParticipants.eventId],
      references: [customGameEvents.id],
    }),
    user: one(users, {
      fields: [customGameEventParticipants.userId],
      references: [users.discordId],
    }),
  }),
);

export const matchParticipantsRelations = relations(
  matchParticipants,
  ({ one }) => ({
    match: one(matches, {
      fields: [matchParticipants.matchId],
      references: [matches.id],
    }),
    user: one(users, {
      fields: [matchParticipants.userId],
      references: [users.discordId],
    }),
  }),
);

export const matchRankSnapshotsRelations = relations(
  matchRankSnapshots,
  ({ one }) => ({
    match: one(matches, {
      fields: [matchRankSnapshots.matchId],
      references: [matches.id],
    }),
  }),
);

export const authStates = sqliteTable("auth_states", {
  state: text("state").primaryKey(),
  discordId: text("discord_id").notNull(),
  guildId: text("guild_id"),
  platform: text("platform", { enum: riotPlatforms }).notNull().default("jp1"),
  region: text("region", { enum: riotRegions }).notNull().default("asia"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
});

export const customGameEventsRelations = relations(
  customGameEvents,
  ({ many, one }) => ({
    creator: one(users, {
      fields: [customGameEvents.creatorId],
      references: [users.discordId],
    }),
    guild: one(guilds, {
      fields: [customGameEvents.guildId],
      references: [guilds.id],
    }),
    participants: many(customGameEventParticipants),
    matches: many(matches),
  }),
);

export const guildsRelations = relations(guilds, ({ many }) => ({
  userProfiles: many(userGuildProfiles),
  customGameEvents: many(customGameEvents),
  matchWatchers: many(matchWatchers),
}));

export const matchWatchersRelations = relations(matchWatchers, ({ one }) => ({
  guild: one(guilds, {
    fields: [matchWatchers.guildId],
    references: [guilds.id],
  }),
  target: one(users, {
    fields: [matchWatchers.targetDiscordId],
    references: [users.discordId],
  }),
  requester: one(users, {
    fields: [matchWatchers.requesterId],
    references: [users.discordId],
  }),
}));

// Notification intents outlive a watcher so a restart cannot lose pending work.
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    key: text("key").primaryKey(),
    guildId: text("guild_id").notNull(),
    targetDiscordId: text("target_discord_id").notNull(),
    riotAccountPuuid: text("riot_account_puuid"),
    channelId: text("channel_id").notNull(),
    embed: text("embed", { mode: "json" }).$type<
      NotificationDelivery["embed"]
    >().notNull(),
    messageId: text("message_id"),
    matchId: text("match_id"),
    stage: integer("stage"),
    revision: integer("revision"),
    status: text("status", { enum: ["pending", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    leaseId: text("lease_id"),
    leaseUntil: integer("lease_until"),
    reason: text("reason", { enum: notificationFailureReasons }),
    createdAt: integer("created_at").notNull(),
  },
  (
    table,
  ) => [
    index("notification_deliveries_due").on(table.status, table.nextAttemptAt),
    index("notification_deliveries_match").on(
      table.guildId,
      table.channelId,
      table.matchId,
    ),
    index("notification_deliveries_message").on(
      table.guildId,
      table.channelId,
      table.messageId,
    ),
  ],
);

export const customGameSettings = sqliteTable("custom_game_settings", {
  guildId: text("guild_id").primaryKey().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  recruitmentChannelId: text("recruitment_channel_id").notNull(),
  lobbyChannelId: text("lobby_channel_id").notNull(),
  redChannelId: text("red_channel_id").notNull(),
  blueChannelId: text("blue_channel_id").notNull(),
  roleIds: text("role_ids", { mode: "json" }).$type<
    CustomGameSettings["roleIds"]
  >().notNull(),
});

export const guildMatchWatchSettings = sqliteTable(
  "guild_match_watch_settings",
  {
    guildId: text("guild_id").primaryKey().references(() => guilds.id, {
      onDelete: "cascade",
    }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    notificationChannelId: text("notification_channel_id"),
  },
);

export const guildMembers = sqliteTable("guild_members", {
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  discordId: text("discord_id").notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.discordId] })]);

export const matchWatcherOptOuts = sqliteTable(
  "match_watcher_opt_outs",
  {
    guildId: text("guild_id").notNull().references(() => guilds.id, {
      onDelete: "cascade",
    }),
    targetDiscordId: text("target_discord_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.targetDiscordId] })],
);
