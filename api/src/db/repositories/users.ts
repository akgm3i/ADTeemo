import { eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { Database } from "../index.ts";
import {
  guilds,
  type Lane,
  riotAccounts,
  type RiotPlatform,
  type RiotRegion,
  userGuildProfiles,
  users,
} from "../schema.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const riotAccountInsertSchema = createInsertSchema(riotAccounts);
const userGuildProfileInsertSchema = createInsertSchema(userGuildProfiles);

export function createUsersRepository(database: Database) {
  async function upsertUser(userId: string) {
    const user = { discordId: userId };
    const parsed = userInsertSchema.parse(user);
    await database.insert(users).values(parsed).onConflictDoNothing().execute();
    const result = await database.query.users.findFirst({
      where: eq(users.discordId, userId),
    });
    if (!result) {
      throw new Error("Failed to upsert user");
    }
    return result;
  }

  async function deleteUser(userId: string) {
    await database.delete(users).where(eq(users.discordId, userId)).execute();
  }

  async function setMainRole(userId: string, guildId: string, role: Lane) {
    await database.transaction(async (tx) => {
      const userPayload = userInsertSchema.parse({ discordId: userId });
      await tx.insert(users).values(userPayload).onConflictDoNothing()
        .execute();

      const guildPayload = guildInsertSchema.parse({ id: guildId });
      await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
        .execute();

      const profilePayload = userGuildProfileInsertSchema.parse({
        userId,
        guildId,
        mainRole: role,
      });

      await tx.insert(userGuildProfiles).values(profilePayload)
        .onConflictDoUpdate(
          {
            target: [userGuildProfiles.userId, userGuildProfiles.guildId],
            set: {
              mainRole: role,
              updatedAt: new Date(),
            },
          },
        ).execute();
    });
  }

  async function updateUserRiotId(discordId: string, riotId: string) {
    await database.update(users).set({ riotId }).where(
      eq(users.discordId, discordId),
    )
      .execute();
  }

  async function linkUserWithRiotId(discordId: string, riotId: string) {
    const payload = userInsertSchema.parse({ discordId, riotId });

    await database.insert(users).values(payload).onConflictDoUpdate({
      target: users.discordId,
      set: {
        riotId,
        updatedAt: new Date(),
      },
    }).execute();
  }

  async function upsertRiotAccount(account: {
    discordId: string;
    puuid: string;
    gameName: string;
    tagLine: string;
    platform: RiotPlatform;
    region: RiotRegion;
  }) {
    await database.transaction(async (tx) => {
      const userPayload = userInsertSchema.parse({
        discordId: account.discordId,
        riotId: account.puuid,
      });
      await tx.insert(users).values(userPayload).onConflictDoUpdate({
        target: users.discordId,
        set: {
          riotId: account.puuid,
          updatedAt: new Date(),
        },
      }).execute();

      const payload = riotAccountInsertSchema.parse(account);
      await tx.insert(riotAccounts).values(payload).onConflictDoUpdate({
        target: riotAccounts.discordId,
        set: {
          puuid: account.puuid,
          gameName: account.gameName,
          tagLine: account.tagLine,
          platform: account.platform,
          region: account.region,
          updatedAt: new Date(),
        },
      }).execute();
    });
  }

  async function getRiotAccountByDiscordId(discordId: string) {
    return await database.query.riotAccounts.findFirst({
      where: eq(riotAccounts.discordId, discordId),
    });
  }

  return {
    upsertUser,
    deleteUser,
    setMainRole,
    updateUserRiotId,
    linkUserWithRiotId,
    upsertRiotAccount,
    getRiotAccountByDiscordId,
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
