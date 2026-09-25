import { and, eq, inArray, lte } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  DomainConflictError,
  EventNotFoundError,
  RecordNotFoundError,
  RiotAccountNotFoundError,
} from "../../errors.ts";
import type { DbActionsConfig } from "../actions.ts";
import type { Database } from "../index.ts";
import {
  customGameEventParticipants,
  customGameEvents,
  customGameTeams,
  externalMatchDetails,
  externalMatchParticipantDetails,
  type ExternalMatchProvider,
  lanes,
  matches,
  matchParticipants,
  matchRankSnapshots,
  pendingMatchRankSnapshots,
  type RankedQueueType,
  riotAccounts,
  type RiotPlatform,
  users,
} from "../schema.ts";

const matchParticipantInsertSchema = z.object({
  id: z.number().int().positive().optional(),
  matchId: z.string().min(1),
  userId: z.string().min(1),
  riotPuuid: z.string().min(1).nullable().optional(),
  team: z.enum(customGameTeams),
  win: z.boolean(),
  lane: z.enum(lanes),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  cs: z.number().int().min(0),
  gold: z.number().int().min(0),
});
const matchParticipantPayloadSchema = matchParticipantInsertSchema.omit({
  id: true,
  matchId: true,
});
const matchParticipantsPayloadSchema = z.array(matchParticipantPayloadSchema)
  .superRefine((participants, context) => {
    const userIds = new Set<string>();
    participants.forEach((participant, index) => {
      if (userIds.has(participant.userId)) {
        context.addIssue({
          code: "custom",
          message: "Participant userId must be unique within a match",
          path: [index, "userId"],
        });
      }
      userIds.add(participant.userId);
    });
  });
const externalMatchDetailInsertSchema = createInsertSchema(
  externalMatchDetails,
);
const externalMatchParticipantDetailInsertSchema = createInsertSchema(
  externalMatchParticipantDetails,
);
const pendingMatchRankSnapshotInsertSchema = createInsertSchema(
  pendingMatchRankSnapshots,
);
const matchRankSnapshotInsertSchema = createInsertSchema(matchRankSnapshots);
const customMatchStatsSchema = z.array(z.object({
  userId: z.string().min(1),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  cs: z.number().int().min(0),
  gold: z.number().int().min(0),
})).length(10).superRefine((stats, context) => {
  const userIds = new Set<string>();
  stats.forEach((entry, index) => {
    if (userIds.has(entry.userId)) {
      context.addIssue({
        code: "custom",
        message: "Stat userId must be unique within a match",
        path: [index, "userId"],
      });
    }
    userIds.add(entry.userId);
  });
});

type RankSnapshotPayload = {
  queueType: RankedQueueType;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt?: Date;
};

type MatchParticipantPayload = z.infer<typeof matchParticipantPayloadSchema>;

function normalizedRecordedParticipants(
  participants: Array<{
    userId: string;
    team: string;
    win: boolean;
    lane: string;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    gold: number;
  }>,
) {
  return participants.map((participant) => ({
    userId: participant.userId,
    team: participant.team,
    win: participant.win,
    lane: participant.lane,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.cs,
    gold: participant.gold,
  })).toSorted((left, right) => left.userId.localeCompare(right.userId));
}

export function createMatchesRepository(
  database: Database,
  config: Pick<DbActionsConfig, "pendingRankSnapshotTtlMs">,
) {
  // @libsql/client uses one SQLite connection for this repository. Queue custom
  // match transactions so concurrent Discord retries cannot interleave two
  // transactions on that connection and surface SQLITE_BUSY instead of the
  // idempotent result from the first commit.
  let customMatchWriteTail: Promise<void> = Promise.resolve();

  function serializeCustomMatchWrite<T>(operation: () => Promise<T>) {
    const result = customMatchWriteTail.then(operation);
    customMatchWriteTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function recordCustomMatch(input: {
    eventId: number;
    guildId: string;
    recruitmentChannelId: string;
    gameSequence: number;
    winner: "BLUE" | "RED";
    stats: z.infer<typeof customMatchStatsSchema>;
  }) {
    const stats = customMatchStatsSchema.parse(input.stats);
    if (!Number.isSafeInteger(input.gameSequence) || input.gameSequence < 1) {
      throw new DomainConflictError("Game sequence must be a positive integer");
    }

    return await serializeCustomMatchWrite(() =>
      database.transaction(async (tx) => {
        const event = await tx.query.customGameEvents.findFirst({
          where: and(
            eq(customGameEvents.id, input.eventId),
            eq(customGameEvents.guildId, input.guildId),
            eq(
              customGameEvents.recruitmentChannelId,
              input.recruitmentChannelId,
            ),
          ),
        });
        if (!event) {
          throw new EventNotFoundError("Custom game event not found in scope");
        }

        const matchId = `custom:${event.id}:${input.gameSequence}`;
        const existingMatch = await tx.query.matches.findFirst({
          where: and(
            eq(matches.customGameEventId, event.id),
            eq(matches.gameSequence, input.gameSequence),
          ),
        });
        if (
          !existingMatch &&
          (event.phase !== "RECRUITING" || event.syncState !== "CONSISTENT")
        ) {
          throw new DomainConflictError("Custom game event is not recordable");
        }

        const roster = await tx.query.customGameEventParticipants.findMany({
          where: eq(customGameEventParticipants.eventId, event.id),
        });
        if (roster.length !== 10) {
          throw new DomainConflictError(
            "Custom game event must have ten confirmed participants",
          );
        }
        const rosterUserIds = roster.map((entry) => entry.userId).toSorted();
        const statUserIds = stats.map((entry) => entry.userId).toSorted();
        if (JSON.stringify(rosterUserIds) !== JSON.stringify(statUserIds)) {
          throw new DomainConflictError(
            "Match stats must cover the confirmed event roster exactly",
          );
        }

        const statsByUser = new Map(
          stats.map((entry) => [entry.userId, entry]),
        );
        const participantInputs = roster.map((entry) => {
          const stat = statsByUser.get(entry.userId);
          if (!stat) {
            throw new DomainConflictError(
              "Custom match participant mapping is incomplete",
            );
          }
          return matchParticipantInsertSchema.omit({ id: true }).parse({
            matchId,
            userId: entry.userId,
            team: entry.team,
            win: entry.team === input.winner,
            lane: entry.lane,
            kills: stat.kills,
            deaths: stat.deaths,
            assists: stat.assists,
            cs: stat.cs,
            gold: stat.gold,
          });
        });

        if (existingMatch) {
          const existingParticipants = await tx.query.matchParticipants
            .findMany(
              { where: eq(matchParticipants.matchId, existingMatch.id) },
            );
          if (
            JSON.stringify(
              normalizedRecordedParticipants(existingParticipants),
            ) !==
              JSON.stringify(normalizedRecordedParticipants(participantInputs))
          ) {
            throw new DomainConflictError(
              "Custom match idempotency key already has different data",
            );
          }
          return {
            created: false as const,
            matchId: existingMatch.id,
            participantCount: existingParticipants.length,
          };
        }

        const accounts = await tx.query.riotAccounts.findMany({
          where: and(
            inArray(riotAccounts.discordId, rosterUserIds),
            eq(riotAccounts.isMain, true),
          ),
        });
        if (accounts.length !== roster.length) {
          throw new RiotAccountNotFoundError(
            "Every custom match participant requires a canonical Riot account",
          );
        }
        const accountsByUser = new Map(
          accounts.map((account) => [account.discordId, account]),
        );
        const participants = participantInputs.map((participant) => {
          const account = accountsByUser.get(participant.userId);
          if (!account) {
            throw new RiotAccountNotFoundError(
              "Every custom match participant requires a canonical Riot account",
            );
          }
          return { ...participant, riotPuuid: account.puuid };
        });
        await tx.insert(matches).values({
          id: matchId,
          customGameEventId: event.id,
          gameSequence: input.gameSequence,
        }).execute();
        await tx.insert(matchParticipants).values(participants).execute();
        return {
          created: true as const,
          matchId,
          participantCount: participants.length,
        };
      })
    );
  }

  async function createMatchWithParticipants(input: {
    matchId: string;
    participants: MatchParticipantPayload[];
  }) {
    const participants = matchParticipantsPayloadSchema.parse(
      input.participants,
    );

    return await database.transaction(async (tx) => {
      const [createdMatch] = await tx.insert(matches).values({
        id: input.matchId,
      }).onConflictDoNothing().returning({ id: matches.id });

      const existingParticipants = createdMatch
        ? []
        : await tx.query.matchParticipants.findMany({
          where: eq(matchParticipants.matchId, input.matchId),
        });
      const existingUserIds = new Set(
        existingParticipants.map((participant) => participant.userId),
      );

      const payloads = participants
        .filter((participant) => !existingUserIds.has(participant.userId))
        .map((participant) =>
          matchParticipantInsertSchema.parse({
            ...participant,
            matchId: input.matchId,
          })
        );
      if (!createdMatch && payloads.length === 0) {
        return {
          created: false as const,
          matchId: input.matchId,
          participants: existingParticipants,
        };
      }

      const savedParticipants = payloads.length === 0
        ? []
        : await tx.insert(matchParticipants).values(payloads).returning();

      return {
        created: true as const,
        matchId: input.matchId,
        participants: [...existingParticipants, ...savedParticipants],
      };
    });
  }

  async function createMatchParticipant(
    participantData: z.infer<typeof matchParticipantInsertSchema>,
  ) {
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

  function pendingRankSnapshotExpiresAt(fetchedAt: Date) {
    return new Date(
      fetchedAt.getTime() + config.pendingRankSnapshotTtlMs,
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
    provider: ExternalMatchProvider;
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

  return {
    recordCustomMatch,
    createMatchWithParticipants,
    createMatchParticipant,
    upsertPendingRankSnapshots,
    finalizeMatchRankSnapshots,
    upsertExternalMatchDetail,
  };
}

export type MatchesRepository = ReturnType<typeof createMatchesRepository>;
