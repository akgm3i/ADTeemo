import { describe, test } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { dbActions } from "./actions.ts";
import { db } from "./index.ts";
import type { MatchRankSnapshot } from "./schema.ts";

function stubTransaction(fakeTx: unknown) {
  const transaction =
    (async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback(fakeTx)) as typeof db.transaction;
  return stub(db, "transaction", transaction);
}

describe("db/actions.ts", () => {
  describe("upsertPendingRankSnapshots", () => {
    test("beforeスナップショットを一時保存するとき、期限切れのpendingスナップショットを先に削除する", async () => {
      // Arrange
      const events: string[] = [];
      const fakeTx = {
        delete: () => ({
          where: () => ({
            execute: () => {
              events.push("delete-expired");
              return Promise.resolve();
            },
          }),
        }),
        insert: () => ({
          values: () => {
            events.push("insert-pending");
            return {
              onConflictDoUpdate: () => ({
                execute: () => Promise.resolve(),
              }),
            };
          },
        }),
      };
      using _transactionStub = stubTransaction(fakeTx);

      // Act
      await dbActions.upsertPendingRankSnapshots({
        platform: "jp1",
        gameId: "12345",
        puuid: "puuid-1",
        snapshots: [{
          queueType: "RANKED_SOLO_5x5",
          tier: "EMERALD",
          rank: "IV",
          leaguePoints: 2,
          wins: 10,
          losses: 8,
          fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
        }],
      });

      // Assert
      assertEquals(events, ["delete-expired", "insert-pending"]);
    });
  });

  describe("finalizeMatchRankSnapshots", () => {
    test("pendingスナップショットが消費済みの試合を再確定するとき、保存済みbeforeスナップショットを返す", async () => {
      // Arrange
      const existingBefore: MatchRankSnapshot = {
        id: 1,
        matchId: "JP1_12345",
        platform: "jp1",
        puuid: "puuid-1",
        queueType: "RANKED_SOLO_5x5",
        phase: "before",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 2,
        wins: 10,
        losses: 8,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      const fakeTx = {
        query: {
          pendingMatchRankSnapshots: {
            findMany: () => Promise.resolve([]),
          },
          matchRankSnapshots: {
            findMany: () => Promise.resolve([existingBefore]),
          },
        },
        insert: () => ({
          values: (payload: unknown) => ({
            onConflictDoNothing: () => ({
              execute: () => Promise.resolve(),
            }),
            onConflictDoUpdate: () => ({
              returning: () =>
                Promise.resolve([{
                  id: 2,
                  ...(payload as Omit<MatchRankSnapshot, "id">),
                }]),
            }),
          }),
        }),
        delete: () => ({
          where: () => ({
            execute: () => Promise.resolve(),
          }),
        }),
      };
      using _transactionStub = stubTransaction(fakeTx);

      // Act
      const result = await dbActions.finalizeMatchRankSnapshots({
        matchId: "JP1_12345",
        platform: "jp1",
        gameId: "12345",
        puuid: "puuid-1",
        snapshots: [{
          queueType: "RANKED_SOLO_5x5",
          tier: "EMERALD",
          rank: "IV",
          leaguePoints: 19,
          wins: 11,
          losses: 8,
          fetchedAt: new Date("2026-01-01T00:10:00.000Z"),
        }],
      });

      // Assert
      assertEquals(result.before, [existingBefore]);
      assertEquals(result.after[0].phase, "after");
      assertEquals(result.after[0].leaguePoints, 19);
    });
  });
});
