import { describe, test } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, stub } from "@std/testing/mock";
import { testClient } from "@hono/hono/testing";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";
import type { Lane } from "../db/schema.ts";
import { RecordNotFoundError } from "../errors.ts";

describe("routes/matches.ts", () => {
  const client = testClient(app);

  describe("POST /matches/rank-snapshots/pending", () => {
    test("Active Game検知時のbeforeスナップショットを受け取ったとき、204を返す", async () => {
      // Arrange
      using upsertStub = stub(
        dbActions,
        "upsertPendingRankSnapshots",
        () => Promise.resolve(),
      );
      const payload = {
        platform: "jp1" as const,
        gameId: "12345",
        puuid: "puuid-1",
        snapshots: [{
          queueType: "RANKED_SOLO_5x5" as const,
          tier: "EMERALD",
          rank: "IV",
          leaguePoints: 2,
          wins: 10,
          losses: 8,
        }],
      };

      // Act
      const res = await app.request("/matches/rank-snapshots/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Assert
      assertEquals(res.status, 204);
      assertSpyCall(upsertStub, 0, {
        args: [payload],
      });
    });

    test("不正なbeforeスナップショットが指定されたとき、400を返す", async () => {
      // Arrange / Act
      const res = await app.request("/matches/rank-snapshots/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "jp1",
          gameId: "12345",
          puuid: "puuid-1",
          snapshots: [],
        }),
      });

      // Assert
      assertEquals(res.status, 400);
    });
  });

  describe("POST /matches/:matchId/rank-snapshots/finalize", () => {
    test("Match-v5確定後のafterスナップショットを受け取ったとき、保存済みbefore/afterを返す", async () => {
      // Arrange
      const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
      using finalizeStub = stub(
        dbActions,
        "finalizeMatchRankSnapshots",
        () =>
          Promise.resolve({
            before: [{
              id: 1,
              matchId: "JP1_12345",
              platform: "jp1" as const,
              puuid: "puuid-1",
              queueType: "RANKED_SOLO_5x5" as const,
              phase: "before" as const,
              tier: "EMERALD",
              rank: "IV",
              leaguePoints: 2,
              wins: 10,
              losses: 8,
              fetchedAt,
            }],
            after: [{
              id: 2,
              matchId: "JP1_12345",
              platform: "jp1" as const,
              puuid: "puuid-1",
              queueType: "RANKED_SOLO_5x5" as const,
              phase: "after" as const,
              tier: "EMERALD",
              rank: "IV",
              leaguePoints: 19,
              wins: 11,
              losses: 8,
              fetchedAt,
            }],
          }),
      );
      const payload = {
        platform: "jp1" as const,
        gameId: "12345",
        puuid: "puuid-1",
        snapshots: [{
          queueType: "RANKED_SOLO_5x5" as const,
          tier: "EMERALD",
          rank: "IV",
          leaguePoints: 19,
          wins: 11,
          losses: 8,
        }],
      };

      // Act
      const res = await app.request(
        "/matches/JP1_12345/rank-snapshots/finalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.snapshots.before[0].leaguePoints, 2);
      assertEquals(body.snapshots.after[0].leaguePoints, 19);
      assertSpyCall(finalizeStub, 0, {
        args: [{ ...payload, matchId: "JP1_12345" }],
      });
    });
  });

  describe("POST /matches/:matchId/external-details", () => {
    test("OP.GG詳細が指定されたとき、外部試合詳細として保存し204を返す", async () => {
      // Arrange
      using upsertStub = stub(
        dbActions,
        "upsertExternalMatchDetail",
        () => Promise.resolve(),
      );
      const payload = {
        provider: "opgg" as const,
        providerRegion: "jp",
        providerMatchId: "opgg-match-1",
        detailUrl:
          "https://op.gg/ja/lol/summoners/jp/Teemo-JP1/matches/opgg-match-1/1780000000000",
        providerCreatedAt: "2026-06-19T00:00:00.000Z",
        averageTier: "Emerald",
        participant: {
          puuid: "puuid-1",
          participantId: 3,
          laneScore: 7.2,
        },
      };

      // Act
      const res = await app.request("/matches/JP1_12345/external-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Assert
      assertEquals(res.status, 204);
      assertSpyCall(upsertStub, 0, {
        args: [{
          ...payload,
          matchId: "JP1_12345",
          providerCreatedAt: new Date(payload.providerCreatedAt),
        }],
      });
    });

    test("未対応providerが指定されたとき、400を返す", async () => {
      // Arrange / Act
      const res = await app.request("/matches/JP1_12345/external-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "unknown",
          providerRegion: "jp",
          providerMatchId: "opgg-match-1",
          detailUrl: "https://example.com",
          providerCreatedAt: "2026-06-19T00:00:00.000Z",
        }),
      });

      // Assert
      assertEquals(res.status, 400);
    });
  });

  describe("POST /matches/:matchId/participants", () => {
    const matchId = "test-match-id";
    const participantData: {
      userId: string;
      team: "BLUE" | "RED";
      win: boolean;
      lane: Lane;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      gold: number;
    } = {
      userId: "test-user-id",
      team: "BLUE",
      win: true,
      lane: "Middle",
      kills: 10,
      deaths: 2,
      assists: 8,
      cs: 250,
      gold: 15000,
    };

    describe("正常系", () => {
      test("有効な参加者データが指定されたとき、参加者の戦績が記録され、201 CreatedとIDを返す", async () => {
        // Arrange
        using createParticipantStub = stub(
          dbActions,
          "createMatchParticipant",
          () => Promise.resolve({ id: 1 }),
        );

        // Act
        const res = await client.matches[":matchId"].participants.$post({
          param: { matchId },
          json: participantData,
        });

        // Assert
        assert(res.status === 201);
        const body = await res.json();
        assertEquals(body, { id: 1 });
        assertSpyCall(createParticipantStub, 0, {
          args: [{ ...participantData, matchId }],
        });
      });
    });

    describe("異常系", () => {
      test("無効なデータ（必須項目不足）が指定されたとき、400エラーを返す", async () => {
        // Arrange
        const invalidData = {
          userId: "test-user-id",
          kills: 10,
        };
        const req = new Request(
          `http://localhost/matches/${matchId}/participants`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invalidData),
          },
        );

        // Act
        const res = await app.request(req);

        // Assert
        assertEquals(res.status, 400);
      });

      test("存在しないIDが指定されたとき、404とエラーメッセージを返す", async () => {
        // Arrange
        using _createParticipantStub = stub(
          dbActions,
          "createMatchParticipant",
          () => Promise.reject(new RecordNotFoundError("Not found")),
        );

        // Act
        const res = await client.matches[":matchId"].participants.$post({
          param: { matchId },
          json: participantData,
        });

        // Assert
        assert(res.status === 404);
        const body = await res.json();
        assertEquals(body, { error: "Not found" });
      });

      test("予期せぬDBエラーが発生したとき、500エラーを返す", async () => {
        // Arrange
        using _createParticipantStub = stub(
          dbActions,
          "createMatchParticipant",
          () => Promise.reject(new Error("Generic DB error")),
        );

        // Act
        const res = await client.matches[":matchId"].participants.$post({
          param: { matchId },
          json: participantData,
        });

        // Assert
        assertEquals(res.status, 500);
      });
    });
  });
});
