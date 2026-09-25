import { and, asc, eq, exists, notExists, notInArray } from "drizzle-orm";
import { MatchWatcherLimitError, RecordNotFoundError } from "../../errors.ts";
import type { DbActionsConfig } from "../actions.ts";
import type { Database } from "../index.ts";
import {
  guildMatchWatchSettings,
  guildMembers,
  guilds,
  matchWatcherOptOuts,
  matchWatchers,
  type MatchWatcherState,
  notificationDeliveries,
  riotAccounts,
  users,
} from "../schema.ts";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function createMatchWatchersRepository(
  database: Database,
  config: Pick<DbActionsConfig, "matchWatcherMaxEnabledPerGuild">,
) {
  async function reconcile(tx: Transaction, guildId: string) {
    const settings = await tx.query.guildMatchWatchSettings.findFirst({
      where: eq(guildMatchWatchSettings.guildId, guildId),
    });
    if (!settings) return { limitedAccountCount: 0 };
    // Correlate membership in SQL instead of expanding every server member into
    // bind parameters; large guilds may exceed SQLite's parameter limit.
    const accounts = settings.enabled && settings.notificationChannelId
      ? await tx.select().from(riotAccounts).where(and(
        exists(
          tx.select().from(guildMembers).where(and(
            eq(guildMembers.guildId, guildId),
            eq(guildMembers.discordId, riotAccounts.discordId),
          )),
        ),
        notExists(
          tx.select().from(matchWatcherOptOuts).where(and(
            eq(matchWatcherOptOuts.guildId, guildId),
            eq(matchWatcherOptOuts.targetDiscordId, riotAccounts.discordId),
          )),
        ),
      )).orderBy(asc(riotAccounts.discordId), asc(riotAccounts.puuid))
      : [];
    const eligible = accounts.slice(0, config.matchWatcherMaxEnabledPerGuild);
    const puuids = eligible.map((value) => value.puuid);
    await tx.update(matchWatchers).set({ enabled: false }).where(
      and(
        eq(matchWatchers.guildId, guildId),
        puuids.length
          ? notInArray(matchWatchers.riotAccountPuuid, puuids)
          : undefined,
      ),
    ).execute();
    for (const account of eligible) {
      await tx.insert(matchWatchers).values({
        guildId,
        riotAccountPuuid: account.puuid,
        targetDiscordId: account.discordId,
        requesterId: account.discordId,
        channelId: settings.notificationChannelId!,
        enabled: true,
      })
        .onConflictDoUpdate({
          target: [matchWatchers.guildId, matchWatchers.riotAccountPuuid],
          set: {
            enabled: true,
            channelId: settings.notificationChannelId!,
            updatedAt: new Date(),
          },
        }).execute();
    }
    // A revoked target must not reappear through the independent outbox worker.
    const active = await tx.select().from(matchWatchers).where(
      and(eq(matchWatchers.guildId, guildId), eq(matchWatchers.enabled, true)),
    );
    const enabledAccounts = new Set(
      active.map((w) =>
        `${w.targetDiscordId}:${w.riotAccountPuuid}:${w.channelId}`
      ),
    );
    const pending = await tx.select().from(notificationDeliveries).where(
      and(
        eq(notificationDeliveries.guildId, guildId),
        eq(notificationDeliveries.status, "pending"),
      ),
    );
    for (const delivery of pending) {
      if (
        enabledAccounts.has(
          `${delivery.targetDiscordId}:${delivery.riotAccountPuuid}:${delivery.channelId}`,
        )
      ) continue;
      await tx.update(notificationDeliveries).set({
        status: "failed",
        reason: "watch_disabled",
        leaseUntil: null,
      }).where(eq(notificationDeliveries.key, delivery.key)).execute();
    }
    return { limitedAccountCount: accounts.length - eligible.length };
  }

  async function reconcileConfiguredGuilds(guildId?: string) {
    const settings = await database.select().from(guildMatchWatchSettings)
      .where(
        guildId === undefined
          ? undefined
          : eq(guildMatchWatchSettings.guildId, guildId),
      );
    for (const setting of settings) {
      await database.transaction((tx) => reconcile(tx, setting.guildId));
    }
  }

  async function getGuildMatchWatchSettings(guildId: string) {
    return await database.query.guildMatchWatchSettings.findFirst({
      where: eq(guildMatchWatchSettings.guildId, guildId),
    }) ?? { guildId, enabled: false, notificationChannelId: null };
  }

  async function setGuildMatchWatchSettings(
    settings: {
      guildId: string;
      enabled: boolean;
      notificationChannelId: string | null;
    },
  ) {
    return await database.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: settings.guildId })
        .onConflictDoNothing().execute();
      await tx.insert(guildMatchWatchSettings).values(settings)
        .onConflictDoUpdate({
          target: guildMatchWatchSettings.guildId,
          set: {
            enabled: settings.enabled,
            notificationChannelId: settings.notificationChannelId,
          },
        }).execute();
      return { settings, ...await reconcile(tx, settings.guildId) };
    });
  }

  async function syncGuildMatchWatchMembers(
    guildId: string,
    memberDiscordIds: string[],
  ) {
    return await database.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: guildId }).onConflictDoNothing()
        .execute();
      await tx.delete(guildMembers).where(eq(guildMembers.guildId, guildId))
        .execute();
      const ids = [...new Set(memberDiscordIds)];
      for (let start = 0; start < ids.length; start += 200) {
        await tx.insert(guildMembers).values(
          ids.slice(start, start + 200).map((discordId) => ({
            guildId,
            discordId,
          })),
        ).execute();
      }
      return await reconcile(tx, guildId);
    });
  }

  async function setMatchWatchOptOut(
    guildId: string,
    targetDiscordId: string,
    optOut: boolean,
  ) {
    await database.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: guildId }).onConflictDoNothing()
        .execute();
      if (optOut) {
        await tx.insert(matchWatcherOptOuts).values({
          guildId,
          targetDiscordId,
        }).onConflictDoNothing().execute();
        await tx.update(matchWatchers).set({ enabled: false }).where(
          and(
            eq(matchWatchers.guildId, guildId),
            eq(matchWatchers.targetDiscordId, targetDiscordId),
          ),
        ).execute();
        await tx.update(notificationDeliveries).set({
          status: "failed",
          reason: "watch_disabled",
          leaseUntil: null,
        }).where(
          and(
            eq(notificationDeliveries.guildId, guildId),
            eq(notificationDeliveries.targetDiscordId, targetDiscordId),
            eq(notificationDeliveries.status, "pending"),
          ),
        ).execute();
      } else {
        await tx.delete(matchWatcherOptOuts).where(
          and(
            eq(matchWatcherOptOuts.guildId, guildId),
            eq(matchWatcherOptOuts.targetDiscordId, targetDiscordId),
          ),
        ).execute();
      }
      await reconcile(tx, guildId);
    });
  }

  // Retained API for migration clients. Runtime commands use settings + preference.
  async function upsertMatchWatcher(
    watcher: {
      guildId: string;
      targetDiscordId: string;
      requesterId: string;
      channelId: string;
    },
  ) {
    const accounts = await database.select().from(riotAccounts).where(
      eq(riotAccounts.discordId, watcher.targetDiscordId),
    );
    if (!accounts.length) {
      throw new RecordNotFoundError("Riot account not found");
    }
    await database.transaction(async (tx) => {
      const enabled = await tx.select().from(matchWatchers).where(
        and(
          eq(matchWatchers.guildId, watcher.guildId),
          eq(matchWatchers.enabled, true),
        ),
      );
      const existing = new Set(enabled.map((w) => w.riotAccountPuuid));
      if (
        enabled.length +
            accounts.filter((account) => !existing.has(account.puuid)).length >
          config.matchWatcherMaxEnabledPerGuild
      ) throw new MatchWatcherLimitError("Enabled account limit reached");
      await tx.insert(guilds).values({ id: watcher.guildId })
        .onConflictDoNothing().execute();
      await tx.insert(users).values({ discordId: watcher.requesterId })
        .onConflictDoNothing().execute();
      const optOut = await tx.query.matchWatcherOptOuts.findFirst({
        where: and(
          eq(matchWatcherOptOuts.guildId, watcher.guildId),
          eq(matchWatcherOptOuts.targetDiscordId, watcher.targetDiscordId),
        ),
      });
      if (optOut) return;
      for (const account of accounts) {
        await tx.insert(matchWatchers).values({
          ...watcher,
          riotAccountPuuid: account.puuid,
        }).onConflictDoUpdate({
          target: [matchWatchers.guildId, matchWatchers.riotAccountPuuid],
          set: {
            requesterId: watcher.requesterId,
            channelId: watcher.channelId,
            enabled: true,
            updatedAt: new Date(),
          },
        }).execute();
      }
    });
  }

  async function getEnabledMatchWatchers() {
    await reconcileConfiguredGuilds();
    return await database.query.matchWatchers.findMany({
      where: eq(matchWatchers.enabled, true),
    });
  }
  async function getEnabledMatchWatchersByGuild(guildId: string) {
    await reconcileConfiguredGuilds(guildId);
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
      riotAccountPuuid?: string;
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
    const { riotAccountPuuid, ...patch } = state;
    const account = await database.query.riotAccounts.findFirst({
      where: and(
        eq(riotAccounts.discordId, targetDiscordId),
        riotAccountPuuid === undefined
          ? eq(riotAccounts.isMain, true)
          : eq(riotAccounts.puuid, riotAccountPuuid),
      ),
    });
    if (!account) throw new RecordNotFoundError("Riot account not found");
    await database.update(matchWatchers).set({
      ...patch,
      updatedAt: new Date(),
    }).where(
      and(
        eq(matchWatchers.guildId, guildId),
        eq(matchWatchers.targetDiscordId, targetDiscordId),
        eq(matchWatchers.riotAccountPuuid, account.puuid),
      ),
    ).execute();
  }
  async function disableMatchWatcher(guildId: string, targetDiscordId: string) {
    await setMatchWatchOptOut(guildId, targetDiscordId, true);
  }
  return {
    upsertMatchWatcher,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    updateMatchWatcherState,
    disableMatchWatcher,
    getGuildMatchWatchSettings,
    setGuildMatchWatchSettings,
    syncGuildMatchWatchMembers,
    setMatchWatchOptOut,
  };
}
export type MatchWatchersRepository = ReturnType<
  typeof createMatchWatchersRepository
>;
