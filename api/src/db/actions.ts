import { and, eq, gte, lte } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { Database } from "./index.ts";
import {
  authStates,
  customGameEvents,
  externalMatchDetails,
  externalMatchParticipantDetails,
  guilds,
  type Lane,
  matches,
  matchParticipants,
  matchRankSnapshots,
  matchWatchers,
  type MatchWatcherState,
  pendingMatchRankSnapshots,
  type RankedQueueType,
  riotAccounts,
  type RiotPlatform,
  type RiotRegion,
  riotStaticDataCache,
  userGuildProfiles,
  users,
} from "./schema.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const riotAccountInsertSchema = createInsertSchema(riotAccounts);
const riotStaticDataCacheInsertSchema = createInsertSchema(riotStaticDataCache);
const userGuildProfileInsertSchema = createInsertSchema(userGuildProfiles);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);
const matchParticipantInsertSchema = createInsertSchema(matchParticipants);
const externalMatchDetailInsertSchema = createInsertSchema(
  externalMatchDetails,
);
const externalMatchParticipantDetailInsertSchema = createInsertSchema(
  externalMatchParticipantDetails,
);
const matchWatcherInsertSchema = createInsertSchema(matchWatchers);
const pendingMatchRankSnapshotInsertSchema = createInsertSchema(
  pendingMatchRankSnapshots,
);
const matchRankSnapshotInsertSchema = createInsertSchema(matchRankSnapshots);

const DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD = 20;
const DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

export type DbActionsConfig = {
  matchWatcherMaxEnabledPerGuild: number;
  pendingRankSnapshotTtlMs: number;
};

type EnvReader = {
  get(name: string): string | undefined;
};

function numberEnv(env: EnvReader, name: string, fallback: number) {
  const value = Number(env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createDbActionsConfigFromEnv(
  env: EnvReader = Deno.env,
): DbActionsConfig {
  return {
    matchWatcherMaxEnabledPerGuild: numberEnv(
      env,
      "MATCH_WATCH_MAX_ENABLED_PER_GUILD",
      DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD,
    ),
    pendingRankSnapshotTtlMs: numberEnv(
      env,
      "PENDING_RANK_SNAPSHOT_TTL_MS",
      DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS,
    ),
  };
}

const DEFAULT_DB_ACTIONS_CONFIG: DbActionsConfig = {
  matchWatcherMaxEnabledPerGuild: DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD,
  pendingRankSnapshotTtlMs: DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS,
};

export function createDbActions(
  database: Database,
  config: Partial<DbActionsConfig> = {},
) {
  const resolvedConfig = { ...DEFAULT_DB_ACTIONS_CONFIG, ...config };

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

  async function ensureGuild(guildId: string) {
    const payload = guildInsertSchema.parse({ id: guildId });
    await database.insert(guilds).values(payload).onConflictDoNothing()
      .execute();
  }

  async function deleteUser(userId: string) {
    await database.delete(users).where(eq(users.discordId, userId)).execute();
  }

  async function setMainRole(userId: string, guildId: string, role: Lane) {
    await database.transaction(async (tx) => {
      // ユーザーが存在しない場合は作成する
      const userPayload = userInsertSchema.parse({ discordId: userId });
      await tx.insert(users).values(userPayload).onConflictDoNothing()
        .execute();

      // ギルドが存在しない場合は作成する
      const guildPayload = guildInsertSchema.parse({ id: guildId });
      await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
        .execute();

      // ユーザーのギルドプロファイル（メインロール）を更新または作成する
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

  async function createCustomGameEvent(event: {
    name: string;
    guildId: string;
    creatorId: string;
    discordScheduledEventId: string;
    recruitmentMessageId: string;
    scheduledStartAt: Date;
  }) {
    await database.transaction(async (tx) => {
      // ユーザーが存在しない場合は作成する
      const userPayload = userInsertSchema.parse({
        discordId: event.creatorId,
      });
      await tx.insert(users).values(userPayload).onConflictDoNothing()
        .execute();

      // ギルドが存在しない場合は作成する
      const guildPayload = guildInsertSchema.parse({ id: event.guildId });
      await tx.insert(guilds).values(guildPayload).onConflictDoNothing()
        .execute();

      // カスタムゲームイベントを作成する
      const parsedEvent = customGameEventInsertSchema.parse(event);
      await tx.insert(customGameEvents).values(parsedEvent).execute();
    });
  }

  async function getCustomGameEventsByCreatorId(creatorId: string) {
    return await database.query.customGameEvents.findMany({
      where: eq(customGameEvents.creatorId, creatorId),
    });
  }

  async function deleteCustomGameEventByDiscordEventId(discordEventId: string) {
    await database.delete(customGameEvents).where(
      eq(customGameEvents.discordScheduledEventId, discordEventId),
    ).execute();
  }

  async function getEventStartingTodayByCreatorId(creatorId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    return await database.query.customGameEvents.findFirst({
      where: and(
        eq(customGameEvents.creatorId, creatorId),
        gte(customGameEvents.scheduledStartAt, todayStart),
        lte(customGameEvents.scheduledStartAt, todayEnd),
      ),
    });
  }

  async function createMatchParticipant(
    participantData: z.infer<typeof matchParticipantInsertSchema>,
  ) {
    // 存在チェック
    const userExists = await database.query.users.findFirst({
      where: eq(users.discordId, participantData.userId),
    });
    if (!userExists) {
      throw new RecordNotFoundError(
        `User with id ${participantData.userId} not found`,
      );
    }

    const matchExists = await database.query.matches.findFirst({
      where: eq(matches.id, participantData.matchId),
    });
    if (!matchExists) {
      throw new RecordNotFoundError(
        `Match with id ${participantData.matchId} not found`,
      );
    }

    const parsed = matchParticipantInsertSchema.parse(participantData);
    const result = await database.insert(matchParticipants).values(parsed)
      .returning({
        id: matchParticipants.id,
      });
    return result[0];
  }

  type RankSnapshotPayload = {
    queueType: RankedQueueType;
    tier: string | null;
    rank: string | null;
    leaguePoints: number | null;
    wins: number | null;
    losses: number | null;
    fetchedAt?: Date;
  };

  function pendingRankSnapshotExpiresAt(fetchedAt: Date) {
    return new Date(
      fetchedAt.getTime() + resolvedConfig.pendingRankSnapshotTtlMs,
    );
  }

  async function upsertPendingRankSnapshots(input: {
    platform: RiotPlatform;
    gameId: string;
    puuid: string;
    snapshots: RankSnapshotPayload[];
  }) {
    const now = new Date();
    await database.transaction(async (tx) => {
      await tx.delete(pendingMatchRankSnapshots).where(
        lte(pendingMatchRankSnapshots.expiresAt, now),
      ).execute();

      for (const snapshot of input.snapshots) {
        const fetchedAt = snapshot.fetchedAt ?? now;
        const payload = pendingMatchRankSnapshotInsertSchema.parse({
          platform: input.platform,
          gameId: input.gameId,
          puuid: input.puuid,
          queueType: snapshot.queueType,
          tier: snapshot.tier,
          rank: snapshot.rank,
          leaguePoints: snapshot.leaguePoints,
          wins: snapshot.wins,
          losses: snapshot.losses,
          fetchedAt,
          expiresAt: pendingRankSnapshotExpiresAt(fetchedAt),
        });
        await tx.insert(pendingMatchRankSnapshots).values(payload)
          .onConflictDoUpdate({
            target: [
              pendingMatchRankSnapshots.platform,
              pendingMatchRankSnapshots.gameId,
              pendingMatchRankSnapshots.puuid,
              pendingMatchRankSnapshots.queueType,
            ],
            set: {
              tier: payload.tier,
              rank: payload.rank,
              leaguePoints: payload.leaguePoints,
              wins: payload.wins,
              losses: payload.losses,
              fetchedAt: payload.fetchedAt,
              expiresAt: payload.expiresAt,
            },
          }).execute();
      }
    });
  }

  async function finalizeMatchRankSnapshots(input: {
    matchId: string;
    platform: RiotPlatform;
    gameId: string;
    puuid: string;
    snapshots: RankSnapshotPayload[];
  }) {
    return await database.transaction(async (tx) => {
      await tx.insert(matches).values({ id: input.matchId })
        .onConflictDoNothing()
        .execute();

      const beforeSnapshots = await tx.query.pendingMatchRankSnapshots.findMany(
        {
          where: and(
            eq(pendingMatchRankSnapshots.platform, input.platform),
            eq(pendingMatchRankSnapshots.gameId, input.gameId),
            eq(pendingMatchRankSnapshots.puuid, input.puuid),
          ),
        },
      );

      const savedBefore = [];
      for (const snapshot of beforeSnapshots) {
        const payload = matchRankSnapshotInsertSchema.parse({
          matchId: input.matchId,
          platform: snapshot.platform,
          puuid: snapshot.puuid,
          queueType: snapshot.queueType,
          phase: "before",
          tier: snapshot.tier,
          rank: snapshot.rank,
          leaguePoints: snapshot.leaguePoints,
          wins: snapshot.wins,
          losses: snapshot.losses,
          fetchedAt: snapshot.fetchedAt,
        });
        const [saved] = await tx.insert(matchRankSnapshots).values(payload)
          .onConflictDoUpdate({
            target: [
              matchRankSnapshots.matchId,
              matchRankSnapshots.puuid,
              matchRankSnapshots.queueType,
              matchRankSnapshots.phase,
            ],
            set: {
              tier: payload.tier,
              rank: payload.rank,
              leaguePoints: payload.leaguePoints,
              wins: payload.wins,
              losses: payload.losses,
              fetchedAt: payload.fetchedAt,
            },
          })
          .returning();
        savedBefore.push(saved);
      }

      const reusableBefore = savedBefore.length > 0
        ? savedBefore
        : await tx.query
          .matchRankSnapshots.findMany({
            where: and(
              eq(matchRankSnapshots.matchId, input.matchId),
              eq(matchRankSnapshots.puuid, input.puuid),
              eq(matchRankSnapshots.phase, "before"),
            ),
          });

      const savedAfter = [];
      const now = new Date();
      for (const snapshot of input.snapshots) {
        const payload = matchRankSnapshotInsertSchema.parse({
          matchId: input.matchId,
          platform: input.platform,
          puuid: input.puuid,
          queueType: snapshot.queueType,
          phase: "after",
          tier: snapshot.tier,
          rank: snapshot.rank,
          leaguePoints: snapshot.leaguePoints,
          wins: snapshot.wins,
          losses: snapshot.losses,
          fetchedAt: snapshot.fetchedAt ?? now,
        });
        const [saved] = await tx.insert(matchRankSnapshots).values(payload)
          .onConflictDoUpdate({
            target: [
              matchRankSnapshots.matchId,
              matchRankSnapshots.puuid,
              matchRankSnapshots.queueType,
              matchRankSnapshots.phase,
            ],
            set: {
              tier: payload.tier,
              rank: payload.rank,
              leaguePoints: payload.leaguePoints,
              wins: payload.wins,
              losses: payload.losses,
              fetchedAt: payload.fetchedAt,
            },
          })
          .returning();
        savedAfter.push(saved);
      }

      await tx.delete(pendingMatchRankSnapshots).where(
        and(
          eq(pendingMatchRankSnapshots.platform, input.platform),
          eq(pendingMatchRankSnapshots.gameId, input.gameId),
          eq(pendingMatchRankSnapshots.puuid, input.puuid),
        ),
      ).execute();

      return { before: reusableBefore, after: savedAfter };
    });
  }

  async function upsertExternalMatchDetail(input: {
    matchId: string;
    provider: "opgg";
    providerRegion: string;
    providerMatchId: string;
    detailUrl: string;
    providerCreatedAt: Date;
    averageTier: string | null;
    participant?: {
      puuid: string;
      participantId: number | null;
      laneScore: number | null;
    };
  }) {
    await database.transaction(async (tx) => {
      await tx.insert(matches).values({ id: input.matchId })
        .onConflictDoNothing()
        .execute();

      const now = new Date();
      const detailPayload = externalMatchDetailInsertSchema.parse({
        matchId: input.matchId,
        provider: input.provider,
        providerRegion: input.providerRegion,
        providerMatchId: input.providerMatchId,
        detailUrl: input.detailUrl,
        providerCreatedAt: input.providerCreatedAt,
        averageTier: input.averageTier,
        fetchedAt: now,
      });
      await tx.insert(externalMatchDetails).values(detailPayload)
        .onConflictDoUpdate({
          target: [externalMatchDetails.matchId, externalMatchDetails.provider],
          set: {
            providerRegion: detailPayload.providerRegion,
            providerMatchId: detailPayload.providerMatchId,
            detailUrl: detailPayload.detailUrl,
            providerCreatedAt: detailPayload.providerCreatedAt,
            averageTier: detailPayload.averageTier,
            fetchedAt: detailPayload.fetchedAt,
          },
        })
        .execute();

      if (!input.participant) return;

      const participantPayload = externalMatchParticipantDetailInsertSchema
        .parse(
          {
            matchId: input.matchId,
            provider: input.provider,
            puuid: input.participant.puuid,
            participantId: input.participant.participantId,
            laneScore: input.participant.laneScore,
            fetchedAt: now,
          },
        );
      await tx.insert(externalMatchParticipantDetails).values(
        participantPayload,
      )
        .onConflictDoUpdate({
          target: [
            externalMatchParticipantDetails.matchId,
            externalMatchParticipantDetails.provider,
            externalMatchParticipantDetails.puuid,
          ],
          set: {
            participantId: participantPayload.participantId,
            laneScore: participantPayload.laneScore,
            fetchedAt: participantPayload.fetchedAt,
          },
        })
        .execute();
    });
  }

  async function getAuthState(state: string) {
    return await database.query.authStates.findFirst({
      where: eq(authStates.state, state),
    });
  }

  async function deleteAuthState(state: string) {
    await database.delete(authStates).where(eq(authStates.state, state))
      .execute();
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
      set: { riotId },
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
        set: { riotId: account.puuid },
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

  async function getRiotStaticDataCache(key: string) {
    return await database.query.riotStaticDataCache.findFirst({
      where: eq(riotStaticDataCache.key, key),
    });
  }

  async function upsertRiotStaticDataCache(cache: {
    key: string;
    version: string;
    value: string;
  }) {
    const payload = riotStaticDataCacheInsertSchema.parse(cache);
    await database.insert(riotStaticDataCache).values(payload)
      .onConflictDoUpdate({
        target: riotStaticDataCache.key,
        set: {
          version: cache.version,
          value: cache.value,
          updatedAt: new Date(),
        },
      }).execute();
  }

  async function upsertMatchWatcher(watcher: {
    guildId: string;
    targetDiscordId: string;
    requesterId: string;
    channelId: string;
  }) {
    const maxEnabledPerGuild = resolvedConfig.matchWatcherMaxEnabledPerGuild;

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

  async function createAuthState(state: string, discordId: string) {
    await database.insert(authStates).values({ state, discordId }).execute();
  }

  return {
    upsertUser,
    ensureGuild,
    deleteUser,
    setMainRole,
    createCustomGameEvent,
    getCustomGameEventsByCreatorId,
    deleteCustomGameEventByDiscordEventId,
    getEventStartingTodayByCreatorId,
    createMatchParticipant,
    upsertPendingRankSnapshots,
    finalizeMatchRankSnapshots,
    upsertExternalMatchDetail,
    getAuthState,
    deleteAuthState,
    updateUserRiotId,
    linkUserWithRiotId,
    upsertRiotAccount,
    getRiotAccountByDiscordId,
    getRiotStaticDataCache,
    upsertRiotStaticDataCache,
    upsertMatchWatcher,
    getEnabledMatchWatchers,
    getEnabledMatchWatchersByGuild,
    updateMatchWatcherState,
    disableMatchWatcher,
    createAuthState,
  };
}

export type DbActions = ReturnType<typeof createDbActions>;
