import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  DEFAULT_API_ERROR_MESSAGE,
  responseContracts,
} from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";
import {
  COMMUNICATION_ERROR,
  CONTRACT_ERROR,
  failureKind,
} from "./transport.ts";

import { apiError, createRpcClientStub, response } from "./test_utils.ts";

describe("matches", () => {
  const recordInput = {
    guildId: "guild-1",
    recruitmentChannelId: "channel-1",
    eventId: 1,
    gameSequence: 2,
    winner: "BLUE" as const,
    stats: Array.from({ length: 10 }, (_, index) => ({
      userId: `user-${index + 1}`,
      kills: index,
      deaths: 1,
      assists: 2,
      cs: 100 + index,
      gold: 10_000 + index,
    })),
  };

  test("10人分の戦績を記録すると、イベントscopeを含む一括payloadをcustom match APIへ渡す", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.recordMatch,
        result: response({
          created: true,
          matchId: "custom:1:2",
          participantCount: 10,
        }, 201),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.recordCustomMatch(recordInput);

    // Assert
    assertEquals(result, {
      success: true,
      created: true,
      matchId: "custom:1:2",
      participantCount: 10,
    });
    assertEquals(rpc.calls[0], {
      method: "$post",
      path: "/matches/custom",
      args: [{ json: recordInput }],
    });
  });

  test("一括戦績APIが不正な2xx bodyを返すと、契約不整合として分類する", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      { contract: responseContracts.recordMatch, result: response({}) },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.recordCustomMatch(recordInput);

    // Assert
    assertEquals(result, {
      success: false,
      error: CONTRACT_ERROR,
    });
    if (result.success) return;
    assertEquals(failureKind(result), "contract");
  });

  test("一括戦績APIとの通信に失敗すると、通信失敗として分類する", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.recordMatch,
        result: new Error("Network error"),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.recordCustomMatch(recordInput);

    // Assert
    assertEquals(result, { success: false, error: COMMUNICATION_ERROR });
    if (result.success) return;
    assertEquals(failureKind(result), "communication");
  });

  test("一括戦績APIが409を返すと、HTTP失敗としてcodeとstatusを保持する", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.recordMatch,
        result: response(apiError("CONFLICT"), 409),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.recordCustomMatch(recordInput);

    // Assert
    assertEquals(result, {
      success: false,
      error: DEFAULT_API_ERROR_MESSAGE.CONFLICT,
      code: "CONFLICT",
      status: 409,
    });
    if (result.success) return;
    assertEquals(failureKind(result), "http");
  });
});

describe("rank snapshots", () => {
  test("beforeスナップショット保存APIが204を返すと、成功ステータスを返す", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.pendingRankSnapshots,
        result: response(null, 204),
      },
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.finalizeRankSnapshots,
        result: response({
          snapshots: {
            before: [{
              id: 1,
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
              id: 2,
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
      },
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
    using rpc = createRpcClientStub([
      { contract: responseContracts.opggDetail, result: response({ detail }) },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.opggDetail,
        result: response({ detail: null }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.resolveOpggMatchDetail(matchId, payload);

    assertEquals(result, { success: true, detail: null });
  });

  test("OP.GG試合詳細レスポンスにdetailがないとき、契約不整合を返す", async () => {
    using rpc = createRpcClientStub([
      { contract: responseContracts.opggDetail, result: response({}) },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.resolveOpggMatchDetail(matchId, payload);

    assertEquals(result, { success: false, error: CONTRACT_ERROR });
  });

  test("Backend APIがOP.GG試合詳細を解決できないとき、失敗結果とエラーを返す", async () => {
    const error = "Internal server error";
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.opggDetail,
        result: response(apiError("INTERNAL_ERROR", error), 500),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.resolveOpggMatchDetail(matchId, payload);

    assertEquals(result, {
      success: false,
      error,
      code: "INTERNAL_ERROR",
      status: 500,
    });
  });

  test("Backend APIへの通信に失敗したとき、通信失敗の結果を返す", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.opggDetail,
        result: new Error("Network error"),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.resolveOpggMatchDetail(matchId, payload);

    assertEquals(result, {
      success: false,
      error: "Failed to communicate with API",
    });
  });
});
