import { describe, test } from "@std/testing/bdd";
import { assertEquals, assertStrictEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import {
  DomainConflictError,
  EventNotFoundError,
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
  RiotAccountNotFoundError,
} from "../errors.ts";

describe("routes/matches.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions, opggMatchDetailService, logger } = deps;

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

    test("不正なbeforeスナップショットが指定されたとき、422を返す", async () => {
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
      assertEquals(res.status, 422);
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

    test("必須の試合時間が不正なとき、検証エラーを警告に記録しserviceを呼ばず422を返す", async () => {
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
      assertEquals(res.status, 422);
      assertEquals(await res.json(), {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: {
          issues: [{ code: "too_small", path: ["match", "gameDuration"] }],
        },
      });
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
        code: "RIOT_ACCOUNT_NOT_FOUND",
        message: "Riot account not found",
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
        code: "OPGG_PARTICIPANT_MISMATCH",
        message: "Match participant does not match Riot account",
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
            "X-Correlation-ID": "request-123",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      // Assert
      assertEquals(res.status, 500);
      assertEquals(await res.json(), {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
      assertSpyCalls(errorStub, 1);
      assertEquals(errorStub.calls[0].args[0], "request.failed");
      assertEquals(errorStub.calls[0].args[1]?.correlationId, "request-123");
      assertEquals(errorStub.calls[0].args[1]?.http, {
        method: "POST",
        path: "/matches/:matchId/external-details/opgg/resolve",
        status: 500,
      });
      assertStrictEquals(errorStub.calls[0].args[2], error);
    });
  });

  describe("POST /matches/custom", () => {
    const payload = {
      eventId: 1,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: Array.from({ length: 10 }, (_, index) => ({
        userId: `user-${index + 1}`,
        kills: index,
        deaths: 2,
        assists: 3,
        cs: 100,
        gold: 10_000,
      })),
    };

    function request(body: unknown = payload) {
      return app.request("/matches/custom", {
        method: "POST",
        headers: {
          ...TEST_BOT_SERVICE_AUTH_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    test("matchと全participantを一括保存できたときだけ201を返す", async () => {
      // Arrange
      using recordStub = stub(
        dbActions,
        "recordCustomMatch",
        () =>
          Promise.resolve({
            created: true as const,
            matchId: "custom:1:1",
            participantCount: 10,
          }),
      );

      // Act
      const response = await request();
      const body = await response.json();

      // Assert
      assertEquals(response.status, 201);
      assertEquals(body, {
        created: true,
        matchId: "custom:1:1",
        participantCount: 10,
      });
      assertEquals("success" in body, false);
      assertSpyCall(recordStub, 0, { args: [payload] });
    });

    test("同じeventとgame sequenceの再送が適用済みのとき、200を返す", async () => {
      // Arrange
      using _recordStub = stub(
        dbActions,
        "recordCustomMatch",
        () =>
          Promise.resolve({
            created: false as const,
            matchId: "custom:1:1",
            participantCount: 10,
          }),
      );

      // Act
      const response = await request();

      // Assert
      assertEquals(response.status, 200);
      assertEquals((await response.json()).created, false);
    });

    const failures = [
      {
        name: "event所有境界外",
        error: new EventNotFoundError("not found"),
        status: 404,
        code: "EVENT_NOT_FOUND",
      },
      {
        name: "canonical Riot account不足",
        error: new RiotAccountNotFoundError("not found"),
        status: 404,
        code: "RIOT_ACCOUNT_NOT_FOUND",
      },
      {
        name: "idempotency key競合",
        error: new DomainConflictError("conflict"),
        status: 409,
        code: "CONFLICT",
      },
    ] as const;

    for (const failure of failures) {
      test(`${failure.name}のとき、保存成功に変換せず${failure.status}を返す`, async () => {
        // Arrange
        using _recordStub = stub(
          dbActions,
          "recordCustomMatch",
          () => Promise.reject(failure.error),
        );

        // Act
        const response = await request();

        // Assert
        assertEquals(response.status, failure.status);
        assertEquals((await response.json()).code, failure.code);
      });
    }

    test("repositoryが例外を投げたとき、500を返して成功bodyを返さない", async () => {
      // Arrange
      using _recordStub = stub(
        dbActions,
        "recordCustomMatch",
        () => Promise.reject(new Error("DB unavailable")),
      );

      // Act
      const response = await request();

      // Assert
      assertEquals(response.status, 500);
      assertEquals((await response.json()).code, "INTERNAL_ERROR");
    });

    test("参加者が10人未満のとき、repositoryを呼ばず422を返す", async () => {
      // Arrange
      using recordStub = stub(
        dbActions,
        "recordCustomMatch",
        () => Promise.reject(new Error("must not be called")),
      );

      // Act
      const response = await request({ ...payload, stats: payload.stats[0] });

      // Assert
      assertEquals(response.status, 422);
      assertSpyCalls(recordStub, 0);
    });
  });
});
