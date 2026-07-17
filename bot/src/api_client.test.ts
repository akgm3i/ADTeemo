import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { type Client } from "@adteemo/api/contract";
import {
  createApiClient,
  createApiResourceClients,
  createApiRpcClients,
} from "./api_client.ts";
import { dateOrNull } from "./api_clients/transport.ts";

type RpcCall = {
  method: string;
  path: string;
  args: unknown[];
};

type RpcResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

type QueuedRpcResult = RpcResponse | Error;

function response(body: unknown, status = 200): RpcResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  };
}

function invalidJsonResponse(status = 502, statusText = "Bad Gateway") {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new SyntaxError("Unexpected token <")),
  };
}

function createRpcClientStub(results: QueuedRpcResult[]) {
  const calls: RpcCall[] = [];

  function build(pathParts: string[]): unknown {
    return new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }

        if (prop.startsWith("$")) {
          return (...args: unknown[]) => {
            calls.push({
              method: prop,
              path: `/${pathParts.join("/")}`,
              args,
            });

            const result = results.shift();
            if (result === undefined) {
              return Promise.reject(new Error("RPC result is not queued"));
            }
            if (result instanceof Error) {
              return Promise.reject(result);
            }

            return Promise.resolve(result);
          };
        }

        return build([...pathParts, prop]);
      },
    });
  }

  return {
    calls,
    rpcClient: build([]) as Client,
  };
}

describe("apiClient", () => {
  describe("transport", () => {
    test("任意の日付フィールドがundefinedのとき、Date変換せずnullとして扱う", () => {
      assertEquals(dateOrNull(undefined), null);
    });
  });

  describe("createApiClient", () => {
    test("API_URLが未設定でもmodule importとclient生成ができ、環境変数を要求しない", async () => {
      // Arrange
      const originalApiUrl = Deno.env.get("API_URL");
      Deno.env.delete("API_URL");
      try {
        const imported = await import(
          `./api_client.ts?api_url_import_test=${Date.now()}`
        );
        const rpc = createRpcClientStub([response({ message: "Healthy" })]);
        const client = imported.createApiClient({ rpcClient: rpc.rpcClient });

        // Act
        const result = await client.checkHealth();

        // Assert
        assertEquals(result, { success: true, message: "Healthy" });
        assertEquals(rpc.calls.length, 1);
        assertEquals(rpc.calls[0].path, "/health");
        assertEquals(rpc.calls[0].method, "$get");
      } finally {
        if (originalApiUrl === undefined) {
          Deno.env.delete("API_URL");
        } else {
          Deno.env.set("API_URL", originalApiUrl);
        }
      }
    });

    test("Bot service credentialを設定すると、public clientと認証済みservice clientを分離して生成する", () => {
      // Arrange
      const apiUrl = "http://api:8000";
      const credential =
        "test-bot-service-token-00000000000000000000000000000000";
      const publicRpc = createRpcClientStub([]).rpcClient;
      const serviceRpc = createRpcClientStub([]).rpcClient;
      const queuedClients = [publicRpc, serviceRpc];
      const calls: Array<{
        apiUrl: string;
        options?: { headers?: Record<string, string> };
      }> = [];

      // Act
      const clients = createApiRpcClients({
        apiUrl,
        credential,
        createRpcClient: (calledApiUrl, options) => {
          calls.push({ apiUrl: calledApiUrl, options });
          const client = queuedClients.shift();
          if (!client) throw new Error("Unexpected client factory call");
          return client;
        },
      });

      // Assert
      assertStrictEquals(clients.publicRpcClient, publicRpc);
      assertStrictEquals(clients.botServiceRpcClient, serviceRpc);
      assertEquals(calls, [
        { apiUrl, options: undefined },
        {
          apiUrl,
          options: {
            headers: { Authorization: `Bearer ${credential}` },
          },
        },
      ]);
    });

    test("Bot service credentialが32文字未満の場合、秘密値を含まない設定エラーを返す", () => {
      // Arrange
      const credential = "too-short";

      // Act / Assert
      const error = assertThrows(
        () =>
          createApiRpcClients({
            apiUrl: "http://api:8000",
            credential,
            createRpcClient: () => createRpcClientStub([]).rpcClient,
          }),
        Error,
        "BOT_SERVICE_TOKEN must be at least 32 characters",
      );
      assertEquals(error.message.includes(credential), false);
    });

    test("Bot service credentialが256文字を超える場合、秘密値を含まない設定エラーを返す", () => {
      // Arrange
      const credential = "a".repeat(257);

      // Act / Assert
      const error = assertThrows(
        () =>
          createApiRpcClients({
            apiUrl: "http://api:8000",
            credential,
            createRpcClient: () => createRpcClientStub([]).rpcClient,
          }),
        Error,
        "BOT_SERVICE_TOKEN must be at most 256 characters",
      );
      assertEquals(error.message.includes(credential), false);
    });
  });

  describe("createApiResourceClients", () => {
    test("resource clientを生成すると、利用側は必要なresourceだけを参照して既存と同じRPC呼び出しを行える", async () => {
      const rpc = createRpcClientStub([
        response({ message: "Healthy" }),
        response(null, 204),
      ]);
      const resources = createApiResourceClients({ rpcClient: rpc.rpcClient });

      const healthResult = await resources.health.checkHealth();
      const usersResult = await resources.users.setMainRole(
        "user-1",
        "guild-1",
        "Top",
      );

      assertEquals(healthResult, { success: true, message: "Healthy" });
      assertEquals(usersResult.success, true);
      assertEquals(rpc.calls, [
        {
          method: "$get",
          path: "/health",
          args: [],
        },
        {
          method: "$put",
          path: "/users/:userId/main-role",
          args: [{
            param: { userId: "user-1" },
            json: { guildId: "guild-1", role: "Top" },
          }],
        },
      ]);
    });

    test("public health checkとBot service呼び出しに別々のRPC clientを使用する", async () => {
      // Arrange
      const publicRpc = createRpcClientStub([
        response({ message: "Healthy" }),
      ]);
      const serviceRpc = createRpcClientStub([response(null, 204)]);
      const resources = createApiResourceClients({
        rpcClient: serviceRpc.rpcClient,
        publicRpcClient: publicRpc.rpcClient,
      });

      // Act
      const healthResult = await resources.health.checkHealth();
      const usersResult = await resources.users.setMainRole(
        "user-1",
        "guild-1",
        "Top",
      );

      // Assert
      assertEquals(healthResult, { success: true, message: "Healthy" });
      assertEquals(usersResult.success, true);
      assertEquals(publicRpc.calls, [{
        method: "$get",
        path: "/health",
        args: [],
      }]);
      assertEquals(serviceRpc.calls[0].path, "/users/:userId/main-role");
    });
  });

  describe("checkHealth", () => {
    test("APIが正常な場合にヘルスチェックを実行すると、成功ステータスとメッセージが返される", async () => {
      const rpc = createRpcClientStub([response({ message: "Healthy" })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.checkHealth();

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.message, "Healthy");
      assertEquals(rpc.calls.length, 1);
    });

    test("APIが200以外のステータスを返す場合にヘルスチェックを実行すると、HTTPステータスを失敗として扱う", async () => {
      const rpc = createRpcClientStub([response("Internal Server Error", 500)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.checkHealth();

      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
      assertEquals(rpc.calls.length, 1);
    });

    test("RPC clientが失敗した場合にヘルスチェックを実行すると、通信失敗のエラーが返される", async () => {
      const rpc = createRpcClientStub([new Error("Network error")]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.checkHealth();

      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
      assertEquals(rpc.calls.length, 1);
    });
  });

  describe("events", () => {
    test("APIがイベント一覧の日付フィールドを文字列で返すとき、イベント一覧を取得するとDateへ変換して返す", async () => {
      const event = {
        id: 1,
        name: "週末カスタム",
        guildId: "guild-1",
        creatorId: "creator-1",
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        scheduledStartAt: "2026-07-04T12:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      };
      const rpc = createRpcClientStub([response({ events: [event] })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getCustomGameEventsByCreatorId("creator-1");

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.events[0].scheduledStartAt,
        new Date("2026-07-04T12:00:00.000Z"),
      );
      assertEquals(
        result.events[0].createdAt,
        new Date("2026-07-01T00:00:00.000Z"),
      );
      assertEquals(rpc.calls[0], {
        method: "$get",
        path: "/events/by-creator/:creatorId",
        args: [{ param: { creatorId: "creator-1" } }],
      });
    });

    test("APIが今日開始イベントの日付フィールドを文字列で返すとき、イベントを取得するとDateへ変換して返す", async () => {
      const event = {
        id: 2,
        name: "今日のカスタム",
        guildId: "guild-1",
        creatorId: "creator-1",
        discordScheduledEventId: "discord-event-2",
        recruitmentMessageId: "message-2",
        scheduledStartAt: "2026-07-05T11:00:00.000Z",
        createdAt: "2026-07-01T01:00:00.000Z",
      };
      const rpc = createRpcClientStub([response({ event })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getEventStartingTodayByCreatorId("creator-1");

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.event.scheduledStartAt,
        new Date("2026-07-05T11:00:00.000Z"),
      );
      assertEquals(
        result.event.createdAt,
        new Date("2026-07-01T01:00:00.000Z"),
      );
      assertEquals(rpc.calls[0].path, "/events/today/by-creator/:creatorId");
      assertEquals(rpc.calls[0].args, [{ param: { creatorId: "creator-1" } }]);
    });
  });

  describe("match watchers", () => {
    const watcher = {
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
    };

    test("監視設定の日付フィールドをDateまたはnullへ変換する", async () => {
      const rpc = createRpcClientStub([response({ watchers: [watcher] })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getEnabledMatchWatchers();

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.watchers[0].pendingResultStartedAt,
        new Date("2026-01-01T00:00:00.000Z"),
      );
      assertEquals(
        result.watchers[0].gameStartedAt,
        new Date("2026-01-01T00:01:00.000Z"),
      );
      assertEquals(result.watchers[0].lastCheckedAt, null);
      assertEquals(rpc.calls[0].path, "/match-watchers/enabled");
    });

    test("ギルドIDを指定して監視設定を取得すると、RPC clientへguildIdを渡す", async () => {
      const rpc = createRpcClientStub([response({ watchers: [watcher] })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getEnabledMatchWatchersByGuild("guild-1");

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.watchers[0].guildId, "guild-1");
      assertEquals(rpc.calls[0], {
        method: "$get",
        path: "/match-watchers/enabled/:guildId",
        args: [{ param: { guildId: "guild-1" } }],
      });
    });

    test("監視登録APIが404を返す場合、呼び出し側で未連携を識別できるステータスを返す", async () => {
      const rpc = createRpcClientStub([
        response({ error: "Riot account not found" }, 404),
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.watchMatch({
        guildId: "guild-1",
        targetDiscordId: "target-1",
        requesterId: "requester-1",
        channelId: "channel-1",
      });

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error, "Riot account not found");
      assertEquals("status" in result ? result.status : undefined, 404);
      assertEquals(rpc.calls[0].path, "/match-watchers");
    });

    test("watcher検査APIが404または502を返すとき、失敗結果へ安全なHTTP statusを保持する", async () => {
      const rpc = createRpcClientStub([
        response({ error: "Riot account not found" }, 404),
        response({ error: "Riot API request failed" }, 502),
        response({ error: "Riot account not found" }, 404),
        response({ error: "Riot API request failed" }, 502),
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const activeGameNotFound = await client.inspectMatchWatcherActiveGame(
        "guild-1",
        "target-1",
        { lastState: "IDLE", currentGameId: null },
      );
      const activeGameUpstreamFailure = await client
        .inspectMatchWatcherActiveGame(
          "guild-1",
          "target-1",
          { lastState: "IDLE", currentGameId: null },
        );
      const resultNotFound = await client.inspectMatchWatcherResult(
        "guild-1",
        "target-1",
        { matchId: "JP1_12345" },
      );
      const resultUpstreamFailure = await client.inspectMatchWatcherResult(
        "guild-1",
        "target-1",
        { matchId: "JP1_12345" },
      );

      assertEquals(activeGameNotFound, {
        success: false,
        error: "Riot account not found",
        status: 404,
      });
      assertEquals(activeGameUpstreamFailure, {
        success: false,
        error: "Riot API request failed",
        status: 502,
      });
      assertEquals(resultNotFound, {
        success: false,
        error: "Riot account not found",
        status: 404,
      });
      assertEquals(resultUpstreamFailure, {
        success: false,
        error: "Riot API request failed",
        status: 502,
      });
    });

    test("監視処理用Result検査を行うと、rank snapshotとOP.GG詳細の日付をDateへ変換する", async () => {
      const account = {
        discordId: "target-1",
        puuid: "puuid-1",
        gameName: "Teemo",
        tagLine: "JP1",
        platform: "jp1",
        region: "asia",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
      };
      const match = {
        metadata: { matchId: "JP1_12345", participants: ["puuid-1"] },
        info: {
          gameId: 12345,
          gameCreation: 1_700_000_000_000,
          gameDuration: 1800,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
          mapId: 11,
          queueId: 420,
          participants: [],
        },
      };
      const rankSnapshot = {
        id: 1,
        matchId: "JP1_12345",
        puuid: "puuid-1",
        platform: "jp1",
        queueType: "RANKED_SOLO_5x5",
        phase: "before",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
        fetchedAt: "2026-01-01T00:05:00.000Z",
      };
      const opggDetail = {
        provider: "opgg",
        providerRegion: "jp",
        providerMatchId: "12345",
        detailUrl: "https://op.gg/lol/summoners/jp/Teemo-JP1/matches/12345",
        providerCreatedAt: "2026-01-01T00:06:00.000Z",
        averageTier: "Emerald",
        participant: null,
      };
      const rpc = createRpcClientStub([
        response({
          account,
          match,
          rankSummary: {
            queueType: "RANKED_SOLO_5x5",
            before: rankSnapshot,
            after: null,
          },
          opggDetail,
        }),
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.inspectMatchWatcherResult(
        "guild-1",
        "target-1",
        { matchId: "JP1_12345" },
      );

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.account.createdAt,
        new Date("2026-01-01T00:00:00.000Z"),
      );
      assertEquals(
        result.rankSummary?.before?.fetchedAt,
        new Date("2026-01-01T00:05:00.000Z"),
      );
      assertEquals(
        result.opggDetail?.providerCreatedAt,
        new Date("2026-01-01T00:06:00.000Z"),
      );
      assertEquals(result.match?.metadata.matchId, "JP1_12345");
      assertEquals(rpc.calls[0], {
        method: "$post",
        path: "/match-watchers/:guildId/:targetDiscordId/tracking/result",
        args: [{
          param: { guildId: "guild-1", targetDiscordId: "target-1" },
          json: { matchId: "JP1_12345" },
        }],
      });
    });

    test("監視処理用Active Game検査のstate transitionを復元するとき、未指定の日付フィールドをnullに変換しない", async () => {
      const account = {
        discordId: "target-1",
        puuid: "puuid-1",
        gameName: "Teemo",
        tagLine: "JP1",
        platform: "jp1",
        region: "asia",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
      };
      const rpc = createRpcClientStub([
        response({
          account,
          activeGame: null,
          notificationIntent: null,
          stateTransition: {
            state: {
              lastState: "IN_GAME",
              currentGameId: "12345",
              lastCheckedAt: "2026-01-01T00:05:00.000Z",
            },
            messageIdField: "currentNotificationMessageId",
          },
        }),
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.inspectMatchWatcherActiveGame(
        "guild-1",
        "target-1",
        { lastState: "IDLE", currentGameId: null },
      );

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.stateTransition?.state.lastCheckedAt,
        new Date(
          "2026-01-01T00:05:00.000Z",
        ),
      );
      assertEquals(
        "gameStartedAt" in (result.stateTransition?.state ?? {}),
        false,
      );
      assertEquals(
        "lastInGameNotifiedAt" in (result.stateTransition?.state ?? {}),
        false,
      );
    });
  });

  describe("Riot API facade", () => {
    test("進行中の試合を取得するとき、Backend API経由で結果を返す", async () => {
      const activeGame = {
        gameId: 12345,
        gameType: "MATCHED_GAME",
        gameStartTime: 1_700_000_000_000,
        mapId: 11,
        gameMode: "CLASSIC",
        participants: [],
      };
      const rpc = createRpcClientStub([response({ activeGame })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getActiveGameByPuuid("jp1", "puuid-1");

      assertEquals(result?.gameId, activeGame.gameId);
      assertEquals(result?.participants, activeGame.participants);
      assertEquals(rpc.calls[0], {
        method: "$get",
        path: "/riot/active-games/:platform/:puuid",
        args: [{ param: { platform: "jp1", puuid: "puuid-1" } }],
      });
    });

    test("試合結果が未反映のとき、Backend API経由でnullを返す", async () => {
      const rpc = createRpcClientStub([response({ match: null })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getMatchById("asia", "JP1_12345");

      assertEquals(result, null);
      assertEquals(rpc.calls[0].path, "/riot/matches/:region/:matchId");
      assertEquals(rpc.calls[0].args, [{
        param: { region: "asia", matchId: "JP1_12345" },
      }]);
    });

    test("ランク情報を取得するとき、Backend API経由でentry一覧を返す", async () => {
      const entries = [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
      }];
      const rpc = createRpcClientStub([response({ entries })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getLeagueEntriesByPuuid("jp1", "puuid-1");

      assertEquals(result[0].queueType, entries[0].queueType);
      assertEquals(result[0].leaguePoints, entries[0].leaguePoints);
      assertEquals(rpc.calls[0].path, "/riot/league-entries/:platform/:puuid");
    });

    test("Riot APIの認証が拒否されたとき、APIサーバーの診断情報をエラーとして返す", async () => {
      const errorMessage =
        "Riot API request failed: 403; authorization rejected; " +
        "verify RIOT_API_KEY and endpoint access";
      const rpc = createRpcClientStub([
        response({ error: errorMessage }, 502),
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      await assertRejects(
        () => client.getActiveGameByPuuid("jp1", "puuid-1"),
        Error,
        errorMessage,
      );
      assertEquals(rpc.calls.length, 1);
    });

    test("Riot APIがJSONではないエラーを返すとき、HTTPステータスを含むエラーを返す", async () => {
      const rpc = createRpcClientStub([invalidJsonResponse()]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      await assertRejects(
        () => client.getActiveGameByPuuid("jp1", "puuid-1"),
        Error,
        "HTTP 502 Bad Gateway",
      );
    });

    test("試合結果APIがnull bodyを返すとき、未反映としてnullを返す", async () => {
      const rpc = createRpcClientStub([response(null)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getMatchById("asia", "JP1_12345");

      assertEquals(result, null);
    });

    test("ランク情報APIがnull bodyを返すとき、空配列へfallbackする", async () => {
      const rpc = createRpcClientStub([response(null)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.getLeagueEntriesByPuuid("jp1", "puuid-1");

      assertEquals(result, []);
    });
  });

  describe("matches", () => {
    test("参加者作成APIがidを返さないとき、契約不整合の失敗結果を返す", async () => {
      const rpc = createRpcClientStub([response({})]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.createMatchParticipant("JP1_12345", {
        userId: "user-1",
        team: "BLUE",
        win: true,
        lane: "Top",
        kills: 1,
        deaths: 2,
        assists: 3,
        cs: 100,
        gold: 10_000,
      });

      assertEquals(result, {
        success: false,
        error: "API response missing participant id",
      });
      assertEquals(rpc.calls[0].path, "/matches/:matchId/participants");
    });

    test("参加者作成APIがnull bodyを返すとき、契約不整合の失敗結果を返す", async () => {
      const rpc = createRpcClientStub([response(null)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.createMatchParticipant("JP1_12345", {
        userId: "user-1",
        team: "BLUE",
        win: true,
        lane: "Top",
        kills: 1,
        deaths: 2,
        assists: 3,
        cs: 100,
        gold: 10_000,
      });

      assertEquals(result, {
        success: false,
        error: "API response missing participant id",
      });
    });
  });

  describe("rank snapshots", () => {
    test("beforeスナップショット保存APIが204を返すと、成功ステータスを返す", async () => {
      const rpc = createRpcClientStub([response(null, 204)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });
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

      const result = await client.upsertPendingRankSnapshots(payload);

      assertEquals(result.success, true);
      assertEquals(rpc.calls[0], {
        method: "$post",
        path: "/matches/rank-snapshots/pending",
        args: [{ json: payload }],
      });
    });

    test("afterスナップショット保存APIがbefore/afterを返すと、fetchedAtをDateへ変換する", async () => {
      const rpc = createRpcClientStub([
        response({
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
      ]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });
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

      const result = await client.finalizeRankSnapshots("JP1_12345", payload);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(
        result.snapshots.before[0].fetchedAt,
        new Date("2026-01-01T00:00:00.000Z"),
      );
      assertEquals(result.snapshots.after[0].leaguePoints, 19);
      assertEquals(
        rpc.calls[0].path,
        "/matches/:matchId/rank-snapshots/finalize",
      );
      assertEquals(rpc.calls[0].args, [{
        param: { matchId: "JP1_12345" },
        json: payload,
      }]);
    });
  });

  describe("resolveRiotStaticData", () => {
    test("静的データの解決を依頼したとき、Backend APIからバッチ解決結果を返す", async () => {
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
      const rpc = createRpcClientStub([response(data)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveRiotStaticData(payload);

      assertEquals(result, { success: true, data });
      assertEquals(rpc.calls[0], {
        method: "$post",
        path: "/riot/static-data/resolve",
        args: [{ json: payload }],
      });
    });

    test("Backend APIが静的データを解決できないとき、呼び出し側がfallbackできる失敗結果を返す", async () => {
      const error = "Failed to resolve Riot static data";
      const rpc = createRpcClientStub([response({ error }, 502)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveRiotStaticData({ championIds: [17] });

      assertEquals(result, { success: false, error });
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
      const rpc = createRpcClientStub([response({ detail })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveOpggMatchDetail(matchId, payload);

      assertEquals(result, {
        success: true,
        detail: {
          ...detail,
          providerCreatedAt: new Date(detail.providerCreatedAt),
        },
      });
      assertEquals(
        rpc.calls[0].path,
        "/matches/:matchId/external-details/opgg/resolve",
      );
    });

    test("OP.GGに対応する試合がないとき、成功結果とdetail nullを返す", async () => {
      const rpc = createRpcClientStub([response({ detail: null })]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveOpggMatchDetail(matchId, payload);

      assertEquals(result, { success: true, detail: null });
    });

    test("OP.GG試合詳細レスポンスにdetailがないとき、成功結果とdetail nullを返す", async () => {
      const rpc = createRpcClientStub([response({})]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveOpggMatchDetail(matchId, payload);

      assertEquals(result, { success: true, detail: null });
    });

    test("Backend APIがOP.GG試合詳細を解決できないとき、失敗結果とエラーを返す", async () => {
      const error = "Failed to resolve OP.GG match detail";
      const rpc = createRpcClientStub([response({ error }, 500)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveOpggMatchDetail(matchId, payload);

      assertEquals(result, { success: false, error });
    });

    test("Backend APIへの通信に失敗したとき、通信失敗の結果を返す", async () => {
      const rpc = createRpcClientStub([new Error("Network error")]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.resolveOpggMatchDetail(matchId, payload);

      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
    });
  });

  describe("setMainRole", () => {
    test("API呼び出しが成功した場合にメインロールを設定すると、成功ステータスが返される", async () => {
      const rpc = createRpcClientStub([response(null, 204)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.setMainRole("test-user", "test-guild", "Top");

      assertEquals(result.success, true);
      assertEquals(rpc.calls[0], {
        method: "$put",
        path: "/users/:userId/main-role",
        args: [{
          param: { userId: "test-user" },
          json: { guildId: "test-guild", role: "Top" },
        }],
      });
    });

    test("APIが200以外のステータスを返す場合にメインロールを設定すると、エラーステータスが返される", async () => {
      const rpc = createRpcClientStub([response("Bad Request", 400)]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.setMainRole("test-user", "test-guild", "Top");

      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
      assertEquals(rpc.calls.length, 1);
    });

    test("RPC clientが失敗した場合にメインロールを設定すると、通信失敗のエラーが返される", async () => {
      const rpc = createRpcClientStub([new Error("Network error")]);
      const client = createApiClient({ rpcClient: rpc.rpcClient });

      const result = await client.setMainRole("test-user", "test-guild", "Top");

      assertEquals(result, {
        success: false,
        error: "Failed to communicate with API",
      });
      assertEquals(rpc.calls.length, 1);
    });
  });
});
