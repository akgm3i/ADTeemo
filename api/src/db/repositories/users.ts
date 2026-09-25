import { and, asc, desc, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { DomainConflictError, RecordNotFoundError } from "../../errors.ts";
import type { Database } from "../index.ts";
import {
  guilds,
  type Lane,
  notificationDeliveries,
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
      const existing = await tx.query.riotAccounts.findFirst({
        where: eq(riotAccounts.puuid, account.puuid),
      });
      if (existing && existing.discordId !== account.discordId) {
        throw new DomainConflictError(
          "Riot account belongs to another Discord user",
        );
      }
      await tx.insert(users).values({ discordId: account.discordId })
        .onConflictDoNothing().execute();
      const main = await tx.query.riotAccounts.findFirst({
        where: and(
          eq(riotAccounts.discordId, account.discordId),
          eq(riotAccounts.isMain, true),
        ),
      });
      const payload = riotAccountInsertSchema.parse({
        ...account,
        isMain: existing?.isMain ?? !main,
      });
      await tx.insert(riotAccounts).values(payload).onConflictDoUpdate({
        target: riotAccounts.puuid,
        set: {
          gameName: account.gameName,
          tagLine: account.tagLine,
          platform: account.platform,
          region: account.region,
          updatedAt: new Date(),
        },
      }).execute();
    });
  }

  async function getRiotAccountByDiscordId(discordId: string, puuid?: string) {
    return await database.query.riotAccounts.findFirst({
      where: and(
        eq(riotAccounts.discordId, discordId),
        puuid === undefined
          ? eq(riotAccounts.isMain, true)
          : eq(riotAccounts.puuid, puuid),
      ),
    });
  }

  async function getRiotAccountsByDiscordId(discordId: string) {
    return await database.select().from(riotAccounts).where(
      eq(riotAccounts.discordId, discordId),
    )
      .orderBy(
        desc(riotAccounts.isMain),
        asc(riotAccounts.createdAt),
        asc(riotAccounts.puuid),
      );
  }

  async function setMainRiotAccount(discordId: string, puuid: string) {
    await database.transaction(async (tx) => {
      const account = await tx.query.riotAccounts.findFirst({
        where: and(
          eq(riotAccounts.discordId, discordId),
          eq(riotAccounts.puuid, puuid),
        ),
      });
      if (!account) throw new RecordNotFoundError("Riot account not found");
      if (account.isMain) return;
      await tx.update(riotAccounts).set({ isMain: false }).where(
        eq(riotAccounts.discordId, discordId),
      ).execute();
      await tx.update(riotAccounts).set({ isMain: true }).where(
        eq(riotAccounts.puuid, puuid),
      ).execute();
    });
  }

  async function deleteRiotAccount(discordId: string, puuid: string) {
    await database.transaction(async (tx) => {
      const account = await tx.query.riotAccounts.findFirst({
        where: and(
          eq(riotAccounts.discordId, discordId),
          eq(riotAccounts.puuid, puuid),
        ),
      });
      if (!account) throw new RecordNotFoundError("Riot account not found");
      await tx.update(notificationDeliveries).set({
        status: "failed",
        reason: "watch_disabled",
        leaseUntil: null,
      }).where(
        and(
          eq(notificationDeliveries.targetDiscordId, discordId),
          eq(notificationDeliveries.riotAccountPuuid, puuid),
          eq(notificationDeliveries.status, "pending"),
        ),
      ).execute();
      await tx.delete(riotAccounts).where(eq(riotAccounts.puuid, puuid))
        .execute();
      if (account.isMain) {
        const [replacement] = await tx.select().from(riotAccounts).where(
          eq(riotAccounts.discordId, discordId),
        ).orderBy(asc(riotAccounts.createdAt), asc(riotAccounts.puuid)).limit(
          1,
        );
        if (replacement) {
          await tx.update(riotAccounts).set({ isMain: true }).where(
            eq(riotAccounts.puuid, replacement.puuid),
          ).execute();
        }
      }
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
    getRiotAccountsByDiscordId,
    setMainRiotAccount,
    deleteRiotAccount,
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
