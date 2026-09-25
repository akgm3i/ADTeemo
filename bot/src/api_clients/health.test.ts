import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  DEFAULT_API_ERROR_MESSAGE,
  responseContracts,
} from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";

import { apiError, createRpcClientStub, response } from "./test_utils.ts";

describe("checkHealth", () => {
  test("APIが正常な場合にヘルスチェックを実行すると、成功ステータスとメッセージが返される", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: response({ message: "Healthy" }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.checkHealth();

    assertEquals(result.success, true);
    if (!result.success) return;
    assertEquals(result.message, "Healthy");
    assertEquals(rpc.calls.length, 1);
  });

  test("APIが200以外のステータスを返す場合にヘルスチェックを実行すると、HTTPステータスを失敗として扱う", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: response(apiError("INTERNAL_ERROR"), 500),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.checkHealth();

    assertEquals(result, {
      success: false,
      error: DEFAULT_API_ERROR_MESSAGE.INTERNAL_ERROR,
      code: "INTERNAL_ERROR",
      status: 500,
    });
    assertEquals(rpc.calls.length, 1);
  });

  test("RPC clientが失敗した場合にヘルスチェックを実行すると、通信失敗のエラーが返される", async () => {
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: new Error("Network error"),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    const result = await client.checkHealth();

    assertEquals(result, {
      success: false,
      error: "Failed to communicate with API",
    });
    assertEquals(rpc.calls.length, 1);
  });
});
