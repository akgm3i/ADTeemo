import { and, eq, lte } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { RecordNotFoundError } from "../../errors.ts";
import type { DbActionsConfig } from "../actions.ts";
import type { Database } from "../index.ts";
import {
  externalMatchDetails,
  externalMatchParticipantDetails,
  type ExternalMatchProvider,
  matches,
  matchParticipants,
  matchRankSnapshots,
  pendingMatchRankSnapshots,
  type RankedQueueType,
  type RiotPlatform,
  users,
} from "../schema.ts";

const matchParticipantInsertSchema = createInsertSchema(matchParticipants);
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

type RankSnapshotPayload = {
  queueType: RankedQueueType;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt?: Date;
};

type MatchParticipantPayload = Omit<
  z.infer<typeof matchParticipantInsertSchema>,
  "id" | "matchId"
>;

export function createMatchesRepository(
  database: Database,
  config: Pick<DbActionsConfig, "pendingRankSnapshotTtlMs">,
) {
  async function createMatchWithParticipants(input: {
    matchId: string;
    participants: MatchParticipantPayload[];
  }) {
    return await database.transaction(async (tx) => {
      const [createdMatch] = await tx.insert(matches).values({
        id: input.matchId,
      }).onConflictDoNothing().returning({ id: matches.id });

      if (!createdMatch) {
        const savedParticipants = await tx.query.matchParticipants.findMany({
          where: eq(matchParticipants.matchId, input.matchId),
        });
        if (savedParticipants.length > 0 || input.participants.length === 0) {
          return {
            created: false as const,
            matchId: input.matchId,
            participants: savedParticipants,
          };
        }
      }

      const payloads = input.participants.map((participant) =>
        matchParticipantInsertSchema.parse({
          ...participant,
          matchId: input.matchId,
        })
      );
      const savedParticipants = payloads.length === 0
        ? []
        : await tx.insert(matchParticipants).values(payloads).returning();

      return {
        created: true as const,
        matchId: input.matchId,
        participants: savedParticipants,
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
    createMatchWithParticipants,
    createMatchParticipant,
    upsertPendingRankSnapshots,
    finalizeMatchRankSnapshots,
    upsertExternalMatchDetail,
  };
}

export type MatchesRepository = ReturnType<typeof createMatchesRepository>;
