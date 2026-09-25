import { ApiContractError } from "./transport.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";
import { ApiResponseError, CONTRACT_ERROR } from "./transport.ts";

import {
  apiError,
  createRpcClientStub,
  invalidJsonResponse,
  response,
} from "./test_utils.ts";

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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.activeGame,
        result: response({ activeGame }),
      },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.riotMatch,
        result: response({ match: null }),
      },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.leagueEntries,
        result: response({ entries }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.getLeagueEntriesByPuuid("jp1", "puuid-1");

    assertEquals(result[0].queueType, entries[0].queueType);
    assertEquals(result[0].leaguePoints, entries[0].leaguePoints);
    assertEquals(rpc.calls[0].path, "/riot/league-entries/:platform/:puuid");
  });

  test("Riot API呼び出しが失敗したとき、公開用messageと型付きstatus/codeを持つエラーを返す", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.activeGame,
        result: response(apiError("RIOT_API_UNAVAILABLE"), 502),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const error = await assertRejects(
      () => client.getActiveGameByPuuid("jp1", "puuid-1"),
      ApiResponseError,
      "Riot API request failed",
    );
    assertEquals(error.code, "RIOT_API_UNAVAILABLE");
    assertEquals(error.status, 502);
    assertEquals(rpc.calls.length, 1);
  });

  test("Riot APIがJSONではないエラーを返すとき、契約不整合として拒否する", async () => {
    using rpc = createRpcClientStub([
      { contract: responseContracts.activeGame, result: invalidJsonResponse() },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    await assertRejects(
      () => client.getActiveGameByPuuid("jp1", "puuid-1"),
      Error,
      CONTRACT_ERROR,
    );
  });

  test("試合結果APIがnull bodyを返すとき、契約不整合として拒否する", async () => {
    using rpc = createRpcClientStub([
      { contract: responseContracts.riotMatch, result: response(null) },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    await assertRejects(
      () => client.getMatchById("asia", "JP1_12345"),
      Error,
      CONTRACT_ERROR,
    );
  });

  test("ランク情報APIがnull bodyを返すとき、契約不整合として拒否する", async () => {
    using rpc = createRpcClientStub([
      { contract: responseContracts.leagueEntries, result: response(null) },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    await assertRejects(
      () => client.getLeagueEntriesByPuuid("jp1", "puuid-1"),
      Error,
      CONTRACT_ERROR,
    );
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
    using rpc = createRpcClientStub([
      { contract: responseContracts.staticData, result: response(data) },
    ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.staticData,
        result: response(apiError("RIOT_STATIC_DATA_UNAVAILABLE", error), 502),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.resolveRiotStaticData({ championIds: [17] });

    assertEquals(result, {
      success: false,
      error,
      code: "RIOT_STATIC_DATA_UNAVAILABLE",
      status: 502,
    });
  });
});

test("明示的なentries空配列を取得すると、正常な空配列として返す", async () => {
  using rpc = createRpcClientStub([{
    contract: responseContracts.leagueEntries,
    result: response({ entries: [] }),
  }]);
  assertEquals(
    await createApiClient({ rpcClient: rpc.rpcClient }).getLeagueEntriesByPuuid(
      "jp1",
      "puuid-1",
    ),
    [],
  );
});

test("match endpointが204を返すと、未反映にせず契約エラーを投げる", async () => {
  using rpc = createRpcClientStub([{
    contract: responseContracts.riotMatch,
    result: response(null, 204),
  }]);
  const error = await assertRejects(
    () =>
      createApiClient({ rpcClient: rpc.rpcClient }).getMatchById(
        "asia",
        "JP1_1",
      ),
    ApiContractError,
  );
  assertEquals(error.status, 204);
  assertEquals(error.validationPaths, ["status"]);
});
