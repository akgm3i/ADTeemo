import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiResourceClients, createApiRpcClients } from "./api_client.ts";

import { createRpcClientStub, response } from "./api_clients/test_utils.ts";

describe("createApiClient", () => {
  test("API_URLが未設定でもmodule importとclient生成ができ、環境変数を要求しない", async () => {
    // Arrange
    const originalApiUrl = Deno.env.get("API_URL");
    Deno.env.delete("API_URL");
    try {
      const imported = await import(
        `./api_client.ts?api_url_import_test=${Date.now()}`
      );
      using rpc = createRpcClientStub([
        {
          contract: responseContracts.health,
          result: response({ message: "Healthy" }),
        },
      ]);
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
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: response({ message: "Healthy" }),
      },
      { contract: responseContracts.mainRole, result: response(null, 204) },
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
    using publicRpc = createRpcClientStub([
      {
        contract: responseContracts.health,
        result: response({ message: "Healthy" }),
      },
    ]);
    using serviceRpc = createRpcClientStub([
      { contract: responseContracts.mainRole, result: response(null, 204) },
    ]);
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
