import { assertEquals, assertThrows } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";
import { COMMUNICATION_ERROR } from "./transport.ts";
import { createRpcClientStub, response } from "./test_utils.ts";

describe("createRpcClientStub", () => {
  test("引数不一致をclientが通信失敗へ変換しても、disposeで必ず検出する", async () => {
    // Arrange
    const rpc = createRpcClientStub([{
      contract: responseContracts.mainRole,
      args: [{
        param: { userId: "expected-user" },
        json: { guildId: "guild", role: "Top" },
      }],
      result: new Error("Network error"),
    }]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.setMainRole("wrong-user", "guild", "Top");

    // Assert
    assertEquals(result, { success: false, error: COMMUNICATION_ERROR });
    assertThrows(() => rpc[Symbol.dispose](), Error, "RPC argument mismatches");
  });

  test("正しい引数で宣言した通信失敗を返したとき、disposeは成功する", async () => {
    // Arrange
    using rpc = createRpcClientStub([{
      contract: responseContracts.mainRole,
      args: [{
        param: { userId: "expected-user" },
        json: { guildId: "guild", role: "Top" },
      }],
      result: new Error("Network error"),
    }]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.setMainRole("expected-user", "guild", "Top");

    // Assert
    assertEquals(result, { success: false, error: COMMUNICATION_ERROR });
  });

  test("異なるendpointの順序は自由でも、同じmethod/pathの応答は宣言順で消費する", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: response({ message: "first" }),
      },
      {
        contract: responseContracts.health,
        result: response({ message: "second" }),
      },
      { contract: responseContracts.mainRole, result: response(null, 204) },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const role = await client.setMainRole("user", "guild", "Top");
    const first = await client.checkHealth();
    const second = await client.checkHealth();

    // Assert
    assertEquals(role.success, true);
    assertEquals(first, { success: true, message: "first" });
    assertEquals(second, { success: true, message: "second" });
  });

  test("未消費の応答が残ったとき、disposeで検出する", () => {
    // Arrange
    const rpc = createRpcClientStub([{
      contract: responseContracts.health,
      result: response({ message: "ok" }),
    }]);

    // Act / Assert
    assertThrows(
      () => rpc[Symbol.dispose](),
      Error,
      "Unconsumed RPC responses",
    );
  });

  test("消費済みendpointへの余分な呼び出しをcatchしても、disposeで検出する", async () => {
    // Arrange
    const rpc = createRpcClientStub([{
      contract: responseContracts.health,
      result: response({ message: "ok" }),
    }]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    await client.checkHealth();
    await client.checkHealth();

    // Assert
    assertThrows(() => rpc[Symbol.dispose](), Error, "Unexpected RPC calls");
  });
});
