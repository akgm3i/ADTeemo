import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { apiClient } from "./api_client.ts";
import { type Client } from "@adteemo/api/contract";
import { type InferResponseType } from "@hono/hono";

type PostResponse = InferResponseType<Client["health"]["$get"]>;

describe("apiClient", () => {
  describe("checkHealth", () => {
    test("APIが正常な場合にヘルスチェックを実行すると、成功ステータスとメッセージが返される", async () => {
      // Arrange
      const mockHealthGetResponse: PostResponse = { message: "Healthy" };
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify(mockHealthGetResponse), {
              status: 200,
            }),
          ),
      );

      // Act
      const result = await apiClient.checkHealth();

      // Assert
      assertEquals(result.success, true);
      assertEquals(result.message, "Healthy");
      assertSpyCalls(fetchStub, 1);
    });

    test("APIが200以外のステータスを返す場合にヘルスチェックを実行すると、エラーステータスが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response("Internal Server Error", { status: 500 }),
          ),
      );

      // Act
      const result = await apiClient.checkHealth();

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
      assertSpyCalls(fetchStub, 1);
    });

    test("fetchに失敗した場合にヘルスチェックを実行すると、通信失敗のエラーが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      // Act
      const result = await apiClient.checkHealth();

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("getEnabledMatchWatchers", () => {
    test("監視設定の日付フィールドをDateまたはnullへ変換する", async () => {
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                watchers: [{
                  guildId: "guild-1",
                  targetDiscordId: "target-1",
                  requesterId: "requester-1",
                  channelId: "channel-1",
                  enabled: true,
                  lastState: "IN_GAME",
                  currentGameId: "12345",
                  currentMatchId: null,
                  currentNotificationMessageId: "message-1",
                  pendingResultMatchId: "JP1_12344",
                  pendingResultNotificationMessageId: "message-0",
                  pendingResultStartedAt: "2026-01-01T00:00:00.000Z",
                  gameStartedAt: "2026-01-01T00:01:00.000Z",
                  lastCheckedAt: null,
                  lastInGameNotifiedAt: "2026-01-01T00:02:00.000Z",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:03:00.000Z",
                }],
              }),
              { status: 200 },
            ),
          ),
      );

      const result = await apiClient.getEnabledMatchWatchers();

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.watchers[0].pendingResultStartedAt,
        new Date(
          "2026-01-01T00:00:00.000Z",
        ),
      );
      assertEquals(
        result.watchers[0].gameStartedAt,
        new Date(
          "2026-01-01T00:01:00.000Z",
        ),
      );
      assertEquals(result.watchers[0].lastCheckedAt, null);
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("getEnabledMatchWatchersByGuild", () => {
    test("ギルドIDを指定して監視設定を取得すると、日付フィールドをDateまたはnullへ変換する", async () => {
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                watchers: [{
                  guildId: "guild-1",
                  targetDiscordId: "target-1",
                  requesterId: "requester-1",
                  channelId: "channel-1",
                  enabled: true,
                  lastState: "IDLE",
                  currentGameId: null,
                  currentMatchId: null,
                  currentNotificationMessageId: null,
                  pendingResultMatchId: null,
                  pendingResultNotificationMessageId: null,
                  pendingResultStartedAt: null,
                  gameStartedAt: null,
                  lastCheckedAt: "2026-01-01T00:02:00.000Z",
                  lastInGameNotifiedAt: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:03:00.000Z",
                }],
              }),
              { status: 200 },
            ),
          ),
      );

      const result = await apiClient.getEnabledMatchWatchersByGuild("guild-1");

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.watchers[0].guildId, "guild-1");
      assertEquals(
        result.watchers[0].lastCheckedAt,
        new Date("2026-01-01T00:02:00.000Z"),
      );
      assertEquals(result.watchers[0].gameStartedAt, null);
      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchStub.calls[0].args[0],
        `${Deno.env.get("API_URL")}/match-watchers/enabled/guild-1`,
      );
    });
  });

  describe("Riot API facade", () => {
    test("進行中の試合を取得するとき、Backend API経由で結果を返す", async () => {
      // Arrange
      const activeGame = {
        gameId: 12345,
        gameType: "MATCHED_GAME",
        gameStartTime: 1_700_000_000_000,
        mapId: 11,
        gameMode: "CLASSIC",
        participants: [],
      };
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ activeGame }), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.getActiveGameByPuuid("jp1", "puuid-1");

      // Assert
      assertEquals(result?.gameId, activeGame.gameId);
      assertEquals(result?.participants, activeGame.participants);
      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchStub.calls[0].args[0],
        `${Deno.env.get("API_URL")}/riot/active-games/jp1/puuid-1`,
      );
    });

    test("試合結果が未反映のとき、Backend API経由でnullを返す", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ match: null }), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.getMatchById("asia", "JP1_12345");

      // Assert
      assertEquals(result, null);
      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchStub.calls[0].args[0],
        `${Deno.env.get("API_URL")}/riot/matches/asia/JP1_12345`,
      );
    });

    test("ランク情報を取得するとき、Backend API経由でentry一覧を返す", async () => {
      // Arrange
      const entries = [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
      }];
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ entries }), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.getLeagueEntriesByPuuid(
        "jp1",
        "puuid-1",
      );

      // Assert
      assertEquals(result[0].queueType, entries[0].queueType);
      assertEquals(result[0].leaguePoints, entries[0].leaguePoints);
      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchStub.calls[0].args[0],
        `${Deno.env.get("API_URL")}/riot/league-entries/jp1/puuid-1`,
      );
    });

    test("Riot APIの認証が拒否されたとき、APIサーバーの診断情報をエラーとして返す", async () => {
      // Arrange
      const errorMessage =
        "Riot API request failed: 403; authorization rejected; " +
        "verify RIOT_API_KEY and endpoint access";
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: errorMessage }), {
              status: 502,
            }),
          ),
      );

      // Act / Assert
      await assertRejects(
        () => apiClient.getActiveGameByPuuid("jp1", "puuid-1"),
        Error,
        errorMessage,
      );
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("resolveRiotStaticData", () => {
    test("静的データの解決を依頼したとき、Backend APIからバッチ解決結果を返す", async () => {
      // Arrange
      const payload = {
        locale: "ja_JP",
        championIds: [17, 18],
        queueIds: [420],
        mapIds: [11],
        gameModes: ["CLASSIC"],
      };
      const data = {
        champions: {
          "17": {
            name: "ティーモ",
            iconUrl:
              "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
          },
          "18": { name: "トリスターナ", iconUrl: null },
        },
        queues: { "420": "ランクソロ/デュオ" },
        maps: { "11": "サモナーズリフト" },
        gameModes: { CLASSIC: "クラシック" },
      };
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify(data), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.resolveRiotStaticData(payload);

      // Assert
      assertEquals(result, { success: true, data });
      assertSpyCalls(fetchStub, 1);
      const [url, init] = fetchStub.calls[0].args;
      assertEquals(
        url,
        `${Deno.env.get("API_URL")}/riot/static-data/resolve`,
      );
      assertEquals(init?.method, "POST");
      assertEquals(init?.body, JSON.stringify(payload));
    });

    test("Backend APIが静的データを解決できないとき、呼び出し側がfallbackできる失敗結果を返す", async () => {
      // Arrange
      const error = "Failed to resolve Riot static data";
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ error }), { status: 502 }),
          ),
      );

      // Act
      const result = await apiClient.resolveRiotStaticData({
        championIds: [17],
      });

      // Assert
      assertEquals(result, { success: false, error });
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("watchMatch", () => {
    test("監視登録APIが404を返す場合、呼び出し側で未連携を識別できるステータスを返す", async () => {
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: "Riot account not found" }),
              { status: 404 },
            ),
          ),
      );

      const result = await apiClient.watchMatch({
        guildId: "guild-1",
        targetDiscordId: "target-1",
        requesterId: "requester-1",
        channelId: "channel-1",
      });

      assertEquals(result.success, false);
      assertEquals(result.error, "Riot account not found");
      assertEquals("status" in result ? result.status : undefined, 404);
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("upsertPendingRankSnapshots", () => {
    test("beforeスナップショット保存APIが204を返すと、成功ステータスを返す", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(new Response(null, { status: 204 })),
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
      const result = await apiClient.upsertPendingRankSnapshots(payload);

      // Assert
      assertEquals(result.success, true);
      assertSpyCalls(fetchStub, 1);
      const [url, init] = fetchStub.calls[0].args;
      assertEquals(
        url,
        `${Deno.env.get("API_URL")}/matches/rank-snapshots/pending`,
      );
      assertEquals(init?.method, "POST");
      assertEquals(init?.body, JSON.stringify(payload));
    });
  });

  describe("finalizeRankSnapshots", () => {
    test("afterスナップショット保存APIがbefore/afterを返すと、fetchedAtをDateへ変換する", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                snapshots: {
                  before: [{
                    matchId: "JP1_12345",
                    puuid: "puuid-1",
                    platform: "jp1",
                    queueType: "RANKED_SOLO_5x5",
                    phase: "before",
                    tier: "EMERALD",
                    rank: "IV",
                    leaguePoints: 2,
                    wins: 10,
                    losses: 8,
                    fetchedAt: "2026-01-01T00:00:00.000Z",
                  }],
                  after: [{
                    matchId: "JP1_12345",
                    puuid: "puuid-1",
                    platform: "jp1",
                    queueType: "RANKED_SOLO_5x5",
                    phase: "after",
                    tier: "EMERALD",
                    rank: "IV",
                    leaguePoints: 19,
                    wins: 11,
                    losses: 8,
                    fetchedAt: "2026-01-01T00:10:00.000Z",
                  }],
                },
              }),
              { status: 200 },
            ),
          ),
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
      const result = await apiClient.finalizeRankSnapshots(
        "JP1_12345",
        payload,
      );

      // Assert
      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.snapshots.before[0].fetchedAt,
        new Date("2026-01-01T00:00:00.000Z"),
      );
      assertEquals(result.snapshots.after[0].leaguePoints, 19);
      assertSpyCalls(fetchStub, 1);
      const [url, init] = fetchStub.calls[0].args;
      assertEquals(
        url,
        `${Deno.env.get("API_URL")}/matches/JP1_12345/rank-snapshots/finalize`,
      );
      assertEquals(init?.method, "POST");
      assertEquals(init?.body, JSON.stringify(payload));
    });
  });

  describe("resolveOpggMatchDetail", () => {
    const matchId = "JP1_12345";
    const payload = {
      targetDiscordId: "discord-1",
      match: {
        gameCreation: 1_781_827_200_000,
        gameDuration: 1_800,
        queueId: 420,
        participant: {
          puuid: "puuid-1",
          championId: 17,
          championName: "Teemo",
        },
      },
    };

    test("OP.GG試合詳細が解決されたとき、providerCreatedAtをDateへ復元して返す", async () => {
      // Arrange
      const detail = {
        provider: "opgg" as const,
        providerRegion: "jp",
        providerMatchId: "opgg-match-1",
        detailUrl:
          "https://op.gg/ja/lol/summoners/jp/Teemo-JP1/matches/opgg-match-1/1781827200000",
        providerCreatedAt: "2026-06-19T00:00:00.000Z",
        averageTier: "Emerald",
        participant: {
          puuid: "puuid-1",
          participantId: 3,
          laneScore: 7.2,
        },
      };
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ detail }), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.resolveOpggMatchDetail(matchId, payload);

      // Assert
      assertEquals(result, {
        success: true,
        detail: {
          ...detail,
          providerCreatedAt: new Date(detail.providerCreatedAt),
        },
      });
      assertSpyCalls(fetchStub, 1);
      const [url, init] = fetchStub.calls[0].args;
      assertEquals(
        url,
        `${
          Deno.env.get("API_URL")
        }/matches/${matchId}/external-details/opgg/resolve`,
      );
      assertEquals(init?.method, "POST");
      assertEquals(init?.body, JSON.stringify(payload));
    });

    test("OP.GGに対応する試合がないとき、成功結果とdetail nullを返す", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ detail: null }), { status: 200 }),
          ),
      );

      // Act
      const result = await apiClient.resolveOpggMatchDetail(matchId, payload);

      // Assert
      assertEquals(result, { success: true, detail: null });
      assertSpyCalls(fetchStub, 1);
    });

    test("Backend APIがOP.GG試合詳細を解決できないとき、失敗結果とエラーを返す", async () => {
      // Arrange
      const error = "Failed to resolve OP.GG match detail";
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ error }), { status: 500 }),
          ),
      );

      // Act
      const result = await apiClient.resolveOpggMatchDetail(matchId, payload);

      // Assert
      assertEquals(result, { success: false, error });
      assertSpyCalls(fetchStub, 1);
    });

    test("Backend APIへの通信に失敗したとき、通信失敗の結果を返す", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      // Act
      const result = await apiClient.resolveOpggMatchDetail(matchId, payload);

      // Assert
      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
      assertSpyCalls(fetchStub, 1);
    });
  });

  describe("setMainRole", () => {
    const userId = "test-user";
    const guildId = "test-guild";
    const role = "Top";

    test("API呼び出しが成功した場合にメインロールを設定すると、成功ステータスが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(null, { status: 204 }),
          ),
      );
      // Act
      const result = await apiClient.setMainRole(userId, guildId, role);

      // Assert
      assertEquals(result.success, true);

      assertSpyCalls(fetchStub, 1);
      const [url, init] = fetchStub.calls[0].args;
      assertEquals(url, `${Deno.env.get("API_URL")}/users/${userId}/main-role`);
      assertEquals(init?.method, "PUT");
      assertEquals(init?.body, JSON.stringify({ guildId, role }));
    });

    test("APIが200以外のステータスを返す場合にメインロールを設定すると、エラーステータスが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.resolve(new Response("Bad Request", { status: 400 })),
      );
      // Act
      const result = await apiClient.setMainRole(userId, guildId, role);

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
      assertSpyCalls(fetchStub, 1);
    });

    test("fetchに失敗した場合にメインロールを設定すると、通信失敗のエラーが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );
      // Act
      const result = await apiClient.setMainRole(userId, guildId, role);

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
      assertSpyCalls(fetchStub, 1);
    });
  });
});
