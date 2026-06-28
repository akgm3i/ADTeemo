import { createInsertSchema } from "drizzle-zod";
import type { Database } from "../index.ts";
import { guilds } from "../schema.ts";

const guildInsertSchema = createInsertSchema(guilds);

export function createGuildsRepository(database: Database) {
  async function ensureGuild(guildId: string) {
    const payload = guildInsertSchema.parse({ id: guildId });
    await database.insert(guilds).values(payload).onConflictDoNothing()
      .execute();
  }

  return {
    ensureGuild,
  };
}

export type GuildsRepository = ReturnType<typeof createGuildsRepository>;
