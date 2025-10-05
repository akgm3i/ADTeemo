import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { apiClient } from "./api_client.ts";
import { type Client } from "@adteemo/api/hc";
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
            new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
            }),
          ),
      );

      // Act
      const result = await apiClient.checkHealth();

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "API Error: 500 ");
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

  describe("setMainRole", () => {
    const userId = "test-user";
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
      const result = await apiClient.setMainRole(userId, role);

      // Assert
      assertEquals(result.success, true);
      assertEquals(result.error, null);
      assertSpyCalls(fetchStub, 1);
    });

    test("APIが200以外のステータスを返す場合にメインロールを設定すると、エラーステータスが返される", async () => {
      // Arrange
      using fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response("Bad Request", {
              status: 400,
            }),
          ),
      );

      // Act
      const result = await apiClient.setMainRole(userId, role);

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "API returned status 400");
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
      const result = await apiClient.setMainRole(userId, role);

      // Assert
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
      assertSpyCalls(fetchStub, 1);
    });
  });
});
