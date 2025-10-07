import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { type InferSelectModel, relations } from "drizzle-orm";

export const lanes = ["Top", "Jungle", "Middle", "Bottom", "Support"] as const;
export type Lane = (typeof lanes)[number];

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

export type Event = InferSelectModel<typeof customGameEvents>;

// --- RELATIONS ---

export const usersRelations = relations(users, ({ many }) => ({
  matchParticipations: many(matchParticipants),
  createdCustomGameEvents: many(customGameEvents),
  guildProfiles: many(userGuildProfiles),
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
}));
