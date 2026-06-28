import { describe, test } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { createDbActions } from "./actions.ts";
import { createDb } from "./index.ts";
import type { MatchRankSnapshot } from "./schema.ts";
import { MatchWatcherLimitError } from "../errors.ts";

function createFakeDbWithTransaction(fakeTx: unknown) {
  return {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback(fakeTx),
  } as never;
}

async function createUsersTable(connection: ReturnType<typeof createDb>) {
  await connection.client.execute(`
    CREATE TABLE users (
      discord_id text PRIMARY KEY NOT NULL,
      riot_id text,
      created_at integer NOT NULL,
      updated_at integer
    )
  `);
}

describe("db/actions.ts", () => {
  describe("createDbActions", () => {
    test("DB接続先を指定してactionsを生成するとき、指定したDBだけを更新する", async () => {
      // Arrange
      const connectionA = createDb({ url: "file::memory:", logger: false });
      try {
        const connectionB = createDb({ url: "file::memory:", logger: false });
        try {
          await createUsersTable(connectionA);
          await createUsersTable(connectionB);
          const actionsA = createDbActions(connectionA.db);
          const actionsB = createDbActions(connectionB.db);

          // Act
          await actionsA.upsertUser("user-a");
          await actionsB.upsertUser("user-b");
          const resultA = await connectionA.client.execute(
            "SELECT discord_id FROM users ORDER BY discord_id",
          );
          const resultB = await connectionB.client.execute(
            "SELECT discord_id FROM users ORDER BY discord_id",
          );

          // Assert
          assertEquals(resultA.rows.map((row) => row.discord_id), ["user-a"]);
          assertEquals(resultB.rows.map((row) => row.discord_id), ["user-b"]);
        } finally {
          connectionB.close();
        }
      } finally {
        connectionA.close();
      }
    });
  });

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
      const dbActions = createDbActions(createFakeDbWithTransaction(fakeTx));

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

    test("TTLを指定してbeforeスナップショットを保存するとき、指定TTLでexpiresAtを設定する", async () => {
      // Arrange
      let expiresAt: Date | undefined;
      const fakeTx = {
        delete: () => ({
          where: () => ({
            execute: () => Promise.resolve(),
          }),
        }),
        insert: () => ({
          values: (payload: { expiresAt: Date }) => {
            expiresAt = payload.expiresAt;
            return {
              onConflictDoUpdate: () => ({
                execute: () => Promise.resolve(),
              }),
            };
          },
        }),
      };
      const dbActions = createDbActions(createFakeDbWithTransaction(fakeTx), {
        pendingRankSnapshotTtlMs: 1_000,
      });

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
      assertEquals(expiresAt, new Date("2026-01-01T00:00:01.000Z"));
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
      const dbActions = createDbActions(createFakeDbWithTransaction(fakeTx));

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

  describe("upsertMatchWatcher", () => {
    test("監視上限を指定して新規対象を追加するとき、指定上限を超える場合はエラーにする", async () => {
      // Arrange
      const fakeTx = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              execute: () => Promise.resolve(),
            }),
            onConflictDoUpdate: () => ({
              execute: () => Promise.resolve(),
            }),
          }),
        }),
        query: {
          riotAccounts: {
            findFirst: () => Promise.resolve({ discordId: "target-2" }),
          },
          matchWatchers: {
            findMany: () => Promise.resolve([{ targetDiscordId: "target-1" }]),
          },
        },
      };
      const dbActions = createDbActions(createFakeDbWithTransaction(fakeTx), {
        matchWatcherMaxEnabledPerGuild: 1,
      });

      // Act & Assert
      await assertRejects(
        () =>
          dbActions.upsertMatchWatcher({
            guildId: "guild-1",
            targetDiscordId: "target-2",
            requesterId: "requester-1",
            channelId: "channel-1",
          }),
        MatchWatcherLimitError,
      );
    });
  });
});
