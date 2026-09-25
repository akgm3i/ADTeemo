import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";

import { apiError, createRpcClientStub, response } from "./test_utils.ts";

describe("match watchers", () => {
  const watcher = {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    riotAccountPuuid: "puuid-1",
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.watchers,
        result: response({ watchers: [watcher] }),
      },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.guildWatchers,
        result: response({ watchers: [watcher] }),
      },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.watchMatch,
        result: response(apiError("RIOT_ACCOUNT_NOT_FOUND"), 404),
      },
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
    assertEquals(
      "code" in result ? result.code : undefined,
      "RIOT_ACCOUNT_NOT_FOUND",
    );
    assertEquals(rpc.calls[0].path, "/match-watchers");
  });

  test("watcher検査APIが404または502を返すとき、失敗結果へ安全なHTTP statusを保持する", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.inspectActiveGame,
        result: response(apiError("RIOT_ACCOUNT_NOT_FOUND"), 404),
      },
      {
        contract: responseContracts.inspectActiveGame,
        result: response(apiError("RIOT_API_UNAVAILABLE"), 502),
      },
      {
        contract: responseContracts.inspectResult,
        result: response(apiError("RIOT_ACCOUNT_NOT_FOUND"), 404),
      },
      {
        contract: responseContracts.inspectResult,
        result: response(apiError("RIOT_API_UNAVAILABLE"), 502),
      },
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
      code: "RIOT_ACCOUNT_NOT_FOUND",
      status: 404,
    });
    assertEquals(activeGameUpstreamFailure, {
      success: false,
      error: "Riot API request failed",
      code: "RIOT_API_UNAVAILABLE",
      status: 502,
    });
    assertEquals(resultNotFound, {
      success: false,
      error: "Riot account not found",
      code: "RIOT_ACCOUNT_NOT_FOUND",
      status: 404,
    });
    assertEquals(resultUpstreamFailure, {
      success: false,
      error: "Riot API request failed",
      code: "RIOT_API_UNAVAILABLE",
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
      isMain: true,
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
    };
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.inspectResult,
        result: response({
          account,
          match,
          rankSummary: {
            queueType: "RANKED_SOLO_5x5",
            before: rankSnapshot,
            after: null,
          },
          opggDetail,
          notificationIntent: null,
          stateTransition: null,
        }),
      },
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
      isMain: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
    };
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.inspectActiveGame,
        result: response({
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
      },
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
