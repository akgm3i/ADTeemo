import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { stub } from "jsr:@std/testing/mock";
import * as apiClient from "./api_client.ts";
import { hc } from "hono/client";

// Hono's client internally uses `fetch`, so we need to stub `fetch`
// to mock the API responses.

describe("apiClient.checkHealth", () => {
  it("APIが正常な場合にヘルスチェックを実行すると、成功ステータスとメッセージが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, message: "Healthy" }), {
            status: 200,
          }),
        ),
    );

    try {
      const result = await apiClient.checkHealth();
      assertEquals(result.success, true);
      assertEquals(result.message, "Healthy");
      assertEquals(result.error, null);
    } finally {
      fetchStub.restore();
    }
  });

  it("APIが200以外のステータスを返す場合にヘルスチェックを実行すると、エラーステータスが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response("Internal Server Error", {
            status: 500,
          }),
        ),
    );

    try {
      const result = await apiClient.checkHealth();
      assertEquals(result.success, false);
      assertEquals(result.error, "API returned status 500");
    } finally {
      fetchStub.restore();
    }
  });

  it("fetchに失敗した場合にヘルスチェックを実行すると、通信失敗のエラーが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("Network error")),
    );

    try {
      const result = await apiClient.checkHealth();
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
    } finally {
      fetchStub.restore();
    }
  });
});

describe("apiClient.setMainRole", () => {
  const userId = "test-user";
  const role = "Top";

  it("API呼び出しが成功した場合にメインロールを設定すると、成功ステータスが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        ),
    );

    try {
      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, true);
      assertEquals(result.error, null);
    } finally {
      fetchStub.restore();
    }
  });

  it("APIが200以外のステータスを返す場合にメインロールを設定すると、エラーステータスが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response("Bad Request", {
            status: 400,
          }),
        ),
    );

    try {
      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, false);
      assertEquals(result.error, "API returned status 400");
    } finally {
      fetchStub.restore();
    }
  });

  it("fetchに失敗した場合にメインロールを設定すると、通信失敗のエラーが返される", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("Network error")),
    );

    try {
      const result = await apiClient.setMainRole(userId, role);
      assertEquals(result.success, false);
      assertEquals(result.error, "Failed to communicate with API");
    } finally {
      fetchStub.restore();
    }
  });
});
