import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { type InferSelectModel, relations } from "drizzle-orm";

export const lanes = ["Top", "Jungle", "Middle", "Bottom", "Support"] as const;
export type Lane = (typeof lanes)[number];
export const riotPlatforms = [
  "br1",
  "eun1",
  "euw1",
  "jp1",
  "kr",
  "la1",
  "la2",
  "na1",
  "oc1",
  "tr1",
  "ru",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
] as const;
export type RiotPlatform = (typeof riotPlatforms)[number];
export const riotRegions = ["americas", "asia", "europe", "sea"] as const;
export type RiotRegion = (typeof riotRegions)[number];
export const matchWatcherStates = [
  "IDLE",
  "IN_GAME",
  "FETCHING_RESULT",
] as const;
export type MatchWatcherState = (typeof matchWatcherStates)[number];
export const rankedQueueTypes = [
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
] as const;
export type RankedQueueType = (typeof rankedQueueTypes)[number];
export const rankSnapshotPhases = ["before", "after"] as const;
export type RankSnapshotPhase = (typeof rankSnapshotPhases)[number];

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
  discordId: text("discord_id").primaryKey().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  puuid: text("puuid").notNull(),
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
});

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

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), // Riot Match ID
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
});

export const matchParticipants = sqliteTable("match_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id").notNull().references(() => matches.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  team: text("team").notNull(), // 'BLUE' or 'RED'
  win: integer("win", { mode: "boolean" }).notNull(),
  lane: text("lane", { enum: lanes }).notNull(),
  kills: integer("kills").notNull(),
  deaths: integer("deaths").notNull(),
  assists: integer("assists").notNull(),
  cs: integer("cs").notNull(),
  gold: integer("gold").notNull(),
});

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

export const customGameEvents = sqliteTable("custom_game_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
  creatorId: text("creator_id").notNull().references(() => users.discordId, {
    onDelete: "cascade",
  }),
  discordScheduledEventId: text("discord_scheduled_event_id").notNull()
    .unique(),
  recruitmentMessageId: text("recruitment_message_id").notNull(),
  scheduledStartAt: integer("scheduled_start_at", { mode: "timestamp" })
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
});

export const matchWatchers = sqliteTable("match_watchers", {
  guildId: text("guild_id").notNull().references(() => guilds.id, {
    onDelete: "cascade",
  }),
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
  pk: primaryKey({ columns: [table.guildId, table.targetDiscordId] }),
}));

export type Event = InferSelectModel<typeof customGameEvents>;
export type RiotAccount = InferSelectModel<typeof riotAccounts>;
export type RiotStaticDataCache = InferSelectModel<typeof riotStaticDataCache>;
export type MatchWatcher = InferSelectModel<typeof matchWatchers>;
export type PendingMatchRankSnapshot = InferSelectModel<
  typeof pendingMatchRankSnapshots
>;
export type MatchRankSnapshot = InferSelectModel<typeof matchRankSnapshots>;

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

export const matchesRelations = relations(matches, ({ many }) => ({
  participants: many(matchParticipants),
  rankSnapshots: many(matchRankSnapshots),
}));

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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
});

export const customGameEventsRelations = relations(
  customGameEvents,
  ({ one }) => ({
    creator: one(users, {
      fields: [customGameEvents.creatorId],
      references: [users.discordId],
    }),
    guild: one(guilds, {
      fields: [customGameEvents.guildId],
      references: [guilds.id],
    }),
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
