import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";

import { apiError, createRpcClientStub, response } from "./test_utils.ts";

describe("setMainRole", () => {
  test("API呼び出しが成功した場合にメインロールを設定すると、成功ステータスが返される", async () => {
    using rpc = createRpcClientStub([
      { contract: responseContracts.mainRole, result: response(null, 204) },
    ]);
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

  test("APIがvalidation errorを返す場合にメインロールを設定すると、型付きstatus/codeを保持する", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.mainRole,
        result: response(apiError("VALIDATION_ERROR"), 422),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.setMainRole("test-user", "test-guild", "Top");

    assertEquals(result, {
      success: false,
      error: "Request validation failed",
      code: "VALIDATION_ERROR",
      status: 422,
    });
    assertEquals(rpc.calls.length, 1);
  });

  test("RPC clientが失敗した場合にメインロールを設定すると、通信失敗のエラーが返される", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.mainRole,
        result: new Error("Network error"),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.setMainRole("test-user", "test-guild", "Top");

    assertEquals(result, {
      success: false,
      error: "Failed to communicate with API",
    });
    assertEquals(rpc.calls.length, 1);
  });
});

const account = {
  discordId: "user-1",
  puuid: "puuid-1",
  gameName: "Teemo",
  tagLine: "JP1",
  platform: "jp1",
  region: "asia",
  isMain: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
};
for (
  const patch of [
    { createdAt: "not-a-date" },
    { createdAt: null },
    { createdAt: 123 },
    { platform: "invalid" },
    { updatedAt: undefined },
  ]
) {
  test(`Riot accountの${Object.keys(patch)[0]}が不正なとき、データなしにせず契約エラーを返す (${JSON.stringify(patch)})`, async () => {
    using rpc = createRpcClientStub([{
      contract: responseContracts.riotAccount,
      result: response({ account: { ...account, ...patch } }),
    }]);
    const result = await createApiClient({ rpcClient: rpc.rpcClient })
      .getRiotAccount("user-1");
    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.contractError?.kind, "contract_error");
    }
  });
}

test("本文不要のrole endpointが200 JSONを返すと、204との契約不一致を検出する", async () => {
  using rpc = createRpcClientStub([{
    contract: responseContracts.mainRole,
    result: response({}),
  }]);
  const result = await createApiClient({ rpcClient: rpc.rpcClient })
    .setMainRole("user-1", "guild-1", "Top");
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.contractError?.validationPaths, ["status"]);
  }
});
