import { eq } from "drizzle-orm";
import {
  type CustomGameSettings,
  customGameSettingsSchema,
} from "../../contract/custom_game_settings.ts";
import { createInsertSchema } from "drizzle-zod";
import type { Database } from "../index.ts";
import { customGameSettings, guilds } from "../schema.ts";

const guildInsertSchema = createInsertSchema(guilds);

export function createGuildsRepository(database: Database) {
  async function ensureGuild(guildId: string) {
    const payload = guildInsertSchema.parse({ id: guildId });
    await database.insert(guilds).values(payload).onConflictDoNothing()
      .execute();
  }

  async function getCustomGameSettings(guildId: string) {
    const row = await database.query.customGameSettings.findFirst({
      where: eq(customGameSettings.guildId, guildId),
    });
    if (!row) return undefined;
    const { guildId: _guildId, ...settings } = row;
    return settings;
  }

  async function setCustomGameSettings(
    guildId: string,
    input: CustomGameSettings,
  ) {
    const settings = customGameSettingsSchema.parse(input);
    await ensureGuild(guildId);
    await database.insert(customGameSettings).values({ guildId, ...settings })
      .onConflictDoUpdate({ target: customGameSettings.guildId, set: settings })
      .execute();
    return settings;
  }

  return {
    getCustomGameSettings,
    setCustomGameSettings,
    ensureGuild,
  };
}

export type GuildsRepository = ReturnType<typeof createGuildsRepository>;
