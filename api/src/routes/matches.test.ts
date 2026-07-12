import { describe, test } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { testClient } from "@hono/hono/testing";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import type { Lane } from "../db/schema.ts";
import {
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
} from "../errors.ts";

describe("routes/matches.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions, opggMatchDetailService, logger } = deps;
  const client = testClient(app, {}, undefined, {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
  });

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
        headers: {
          ...TEST_BOT_SERVICE_AUTH_HEADERS,
          "Content-Type": "application/json",
        },
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
        headers: {
          ...TEST_BOT_SERVICE_AUTH_HEADERS,
          "Content-Type": "application/json",
        },
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
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
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

  describe("POST /matches/:matchId/external-details/opgg/resolve", () => {
    const payload = {
      targetDiscordId: "target-1",
      match: {
        gameCreation: 1_780_000_000_000,
        gameDuration: 1800,
        queueId: 420,
        participant: {
          puuid: "puuid-1",
          championId: 17,
          championName: "Teemo",
        },
      },
    };

    test("監視対象と試合情報が一致するとき、OP.GG詳細を解決して保存し200で返す", async () => {
      // Arrange
      const detail = {
        provider: "opgg" as const,
        providerRegion: "jp",
        providerMatchId: "opgg-match-1",
        detailUrl:
          "https://op.gg/ja/lol/summoners/jp/Teemo-JP1/matches/opgg-match-1/1780000000000",
        providerCreatedAt: new Date("2026-06-19T00:00:00.000Z"),
        averageTier: "Emerald",
        participant: {
          puuid: "puuid-1",
          participantId: 3,
          laneScore: 7.2,
        },
      };
      using resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () => Promise.resolve(detail),
      );

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 200);
      assertEquals(await res.json(), {
        detail: {
          ...detail,
          providerCreatedAt: "2026-06-19T00:00:00.000Z",
        },
      });
      assertSpyCall(resolveStub, 0, {
        args: [{ matchId: "JP1_12345", ...payload }],
      });
    });

    test("OP.GG試合候補を一意に解決できないとき、保存せず200でnullを返す", async () => {
      // Arrange
      using _resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () => Promise.resolve(null),
      );

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { detail: null });
    });

    test("必須の試合時間が不正なとき、検証エラーを警告に記録しserviceを呼ばず400を返す", async () => {
      // Arrange
      using resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () => Promise.resolve(null),
      );
      using warnStub = stub(logger, "warn", () => {});

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            match: { ...payload.match, gameDuration: -1 },
          }),
        },
      );

      // Assert
      assertEquals(res.status, 400);
      assertEquals(await res.json(), { error: "Invalid request body" });
      assertSpyCalls(resolveStub, 0);
      assertSpyCall(warnStub, 0, {
        args: ["opgg_match_detail.invalid_request", {
          validationIssues: [{
            code: "too_small",
            path: ["match", "gameDuration"],
          }],
        }],
      });
    });

    test("監視対象のRiotアカウントが存在しないとき、404を返す", async () => {
      // Arrange
      using _resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () =>
          Promise.reject(
            new RecordNotFoundError("Riot account not found: target-1"),
          ),
      );

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 404);
      assertEquals(await res.json(), {
        error: "Riot account not found: target-1",
      });
    });

    test("試合参加者のPUUIDがRiotアカウントと一致しないとき、400を返す", async () => {
      // Arrange
      using _resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () =>
          Promise.reject(
            new OpggMatchParticipantMismatchError(
              "Match participant does not match Riot account",
            ),
          ),
      );

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 400);
      assertEquals(await res.json(), {
        error: "Match participant does not match Riot account",
      });
    });

    test("OP.GG詳細の保存で予期せぬ失敗が発生したとき、エラーを記録して500を返す", async () => {
      // Arrange
      const error = new Error("DB unavailable");
      using _resolveStub = stub(
        opggMatchDetailService,
        "resolveAndSave",
        () => Promise.reject(error),
      );
      using errorStub = stub(logger, "error", () => {});

      // Act
      const res = await app.request(
        "/matches/JP1_12345/external-details/opgg/resolve",
        {
          method: "POST",
          headers: {
            ...TEST_BOT_SERVICE_AUTH_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 500);
      assertEquals(await res.json(), {
        error: "Failed to resolve OP.GG match detail",
      });
      assertSpyCall(errorStub, 0, {
        args: ["opgg_match_detail.request_failed", {
          matchId: "JP1_12345",
          targetDiscordId: "target-1",
        }, error],
      });
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
            headers: {
              ...TEST_BOT_SERVICE_AUTH_HEADERS,
              "Content-Type": "application/json",
            },
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
