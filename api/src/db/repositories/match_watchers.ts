import { and, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { MatchWatcherLimitError, RecordNotFoundError } from "../../errors.ts";
import type { DbActionsConfig } from "../actions.ts";
import type { Database } from "../index.ts";
import {
  guilds,
  matchWatchers,
  type MatchWatcherState,
  riotAccounts,
  users,
} from "../schema.ts";

const matchWatcherInsertSchema = createInsertSchema(matchWatchers);

export function createMatchWatchersRepository(
  database: Database,
  config: Pick<DbActionsConfig, "matchWatcherMaxEnabledPerGuild">,
) {
  async function upsertMatchWatcher(watcher: {
    guildId: string;
    targetDiscordId: string;
    requesterId: string;
    channelId: string;
  }) {
    const maxEnabledPerGuild = config.matchWatcherMaxEnabledPerGuild;

    await database.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: watcher.guildId })
        .onConflictDoNothing()
        .execute();
      await tx.insert(users).values({ discordId: watcher.requesterId })
        .onConflictDoNothing().execute();

      const targetAccount = await tx.query.riotAccounts.findFirst({
        where: eq(riotAccounts.discordId, watcher.targetDiscordId),
      });
      if (!targetAccount) {
        throw new RecordNotFoundError(
          `Riot account for ${watcher.targetDiscordId} not found`,
        );
      }

      const enabledWatchers = await tx.query.matchWatchers.findMany({
        where: and(
          eq(matchWatchers.guildId, watcher.guildId),
          eq(matchWatchers.enabled, true),
        ),
      });
      const isAlreadyEnabledTarget = enabledWatchers.some((enabledWatcher) =>
        enabledWatcher.targetDiscordId === watcher.targetDiscordId
      );
      if (
        !isAlreadyEnabledTarget && enabledWatchers.length >= maxEnabledPerGuild
      ) {
        throw new MatchWatcherLimitError(
          `Enabled match watchers limit exceeded for guild ${watcher.guildId}`,
        );
      }

      const payload = matchWatcherInsertSchema.parse({
        ...watcher,
        enabled: true,
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        pendingResultMatchId: null,
        pendingResultNotificationMessageId: null,
        pendingResultStartedAt: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
      });
      await tx.insert(matchWatchers).values(payload).onConflictDoUpdate({
        target: [matchWatchers.guildId, matchWatchers.targetDiscordId],
        set: {
          requesterId: watcher.requesterId,
          channelId: watcher.channelId,
          enabled: true,
          updatedAt: new Date(),
        },
      }).execute();
    });
  }

  async function getEnabledMatchWatchers() {
    return await database.query.matchWatchers.findMany({
      where: eq(matchWatchers.enabled, true),
    });
  }

  async function getEnabledMatchWatchersByGuild(guildId: string) {
    return await database.query.matchWatchers.findMany({
      where: and(
        eq(matchWatchers.guildId, guildId),
        eq(matchWatchers.enabled, true),
      ),
    });
  }

  async function updateMatchWatcherState(
    guildId: string,
    targetDiscordId: string,
    state: {
      lastState: MatchWatcherState;
      currentGameId?: string | null;
      currentMatchId?: string | null;
      currentNotificationMessageId?: string | null;
      pendingResultMatchId?: string | null;
      pendingResultNotificationMessageId?: string | null;
      pendingResultStartedAt?: Date | null;
      gameStartedAt?: Date | null;
      lastCheckedAt?: Date | null;
      lastInGameNotifiedAt?: Date | null;
    },
  ) {
    await database.update(matchWatchers).set({
      ...state,
      updatedAt: new Date(),
    }).where(
      and(
        eq(matchWatchers.guildId, guildId),
        eq(matchWatchers.targetDiscordId, targetDiscordId),
      ),
    ).execute();
  }

  async function disableMatchWatcher(guildId: string, targetDiscordId: string) {
    await database.update(matchWatchers).set({
      enabled: false,
      updatedAt: new Date(),
    }).where(
      and(
        eq(matchWatchers.guildId, guildId),
        eq(matchWatchers.targetDiscordId, targetDiscordId),
      ),
    ).execute();
  }

  return {
    upsertMatchWatcher,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    updateMatchWatcherState,
    disableMatchWatcher,
  };
}

export type MatchWatchersRepository = ReturnType<
  typeof createMatchWatchersRepository
>;
