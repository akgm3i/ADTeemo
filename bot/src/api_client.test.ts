import { assertEquals } from "jsr:@std/assert";
import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import { restore, stub } from "jsr:@std/testing/mock";
import { apiClient } from "./api_client.ts";

describe("apiClient", () => {
  afterEach(() => {
    restore();
  });

  describe("checkHealth", () => {
    it("APIが正常な場合にヘルスチェックを実行すると、成功ステータスとメッセージが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ ok: true, message: "Healthy" }), {
              status: 200,
            }),
          ),
      );

      const result = await apiClient.checkHealth();
      assertEquals(result.success, true);
      assertEquals(result.message, "Healthy");
      assertEquals(result.error, null);
    });

    it("APIが200以外のステータスを返す場合にヘルスチェックを実行すると、エラーステータスが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response("Internal Server Error", {
              status: 500,
            }),
          ),
      );

      const result = await apiClient.checkHealth();
      assertEquals(result.success, false);
      assertEquals(result.error, "API returned status 500");
    });

    it("fetchに失敗した場合にヘルスチェックを実行すると、通信失敗のエラーが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      const result = await apiClient.checkHealth();
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
    });
  });

  describe("setMainRole", () => {
    const userId = "test-user";
    const role = "Top";

    it("API呼び出しが成功した場合にメインロールを設定すると、成功ステータスが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ success: true }), { status: 200 }),
          ),
      );

      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, true);
      assertEquals(result.error, null);
    });

    it("APIが200以外のステータスを返す場合にメインロールを設定すると、エラーステータスが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response("Bad Request", {
              status: 400,
            }),
          ),
      );

      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, false);
      assertEquals(result.error, "API returned status 400");
    });

    it("fetchに失敗した場合にメインロールを設定すると、通信失敗のエラーが返される", async () => {
      stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
    });
  });
});
