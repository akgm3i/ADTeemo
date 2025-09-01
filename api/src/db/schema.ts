import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const lanes = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export type Lane = (typeof lanes)[number];

export const users = sqliteTable("users", {
  discordId: text("discord_id").primaryKey(),
  riotId: text("riot_id"),
  mainRole: text("main_role", { enum: lanes }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(() =>
    new Date()
  ),
});

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
});

// --- RELATIONS ---

export const usersRelations = relations(users, ({ many }) => ({
  matchParticipations: many(matchParticipants),
}));

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
