import { testClient } from "@hono/hono/testing";
import { Hono } from "@hono/hono";
import { assertEquals, assertMatch } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import app, { requestLoggingMiddleware } from "./app.ts";

describe("app.ts", () => {
  const client = testClient(app);

  describe("GET /health", () => {
    describe("正常系", () => {
      test("リクエストを送信したとき、status 200と正常なbodyが返される", async () => {
        // Act
        const res = await client.health.$get();

        // Assert
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.message, "This API is healthy!");
      });

      test("リクエストを送信したとき、HTTPメソッドとパス、ステータスを含む構造化ログを出力する", async () => {
        // Arrange
        using consoleLogStub = stub(console, "log");

        // Act
        await client.health.$get();

        // Assert
        assertSpyCalls(consoleLogStub, 1);
        const [firstCall] = consoleLogStub.calls;
        const [logPayload] = firstCall.args;
        assertEquals(typeof logPayload, "string");
        const parsed = JSON.parse(logPayload as string);
        assertEquals(parsed.component, "api");
        assertEquals(parsed.level, "INFO");
        assertEquals(parsed.message, "request.completed");
        assertEquals(parsed.http.method, "GET");
        assertEquals(parsed.http.path, "/health");
        assertEquals(parsed.http.status, 200);
        assertMatch(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T/);
      });

      test("ハンドラ例外で500が返るとき、失敗リクエストとしてERRORログを出力する", async () => {
        // Arrange
        using consoleLogStub = stub(console, "log");
        const failingApp = new Hono()
          .use("*", requestLoggingMiddleware)
          .get("/error", () => {
            throw new Error("Unexpected failure");
          });

        // Act
        const res = await failingApp.request("/error");

        // Assert
        assertEquals(res.status, 500);
        assertSpyCalls(consoleLogStub, 1);
        const [firstCall] = consoleLogStub.calls;
        const [logPayload] = firstCall.args;
        assertEquals(typeof logPayload, "string");
        const parsed = JSON.parse(logPayload as string);
        assertEquals(parsed.component, "api");
        assertEquals(parsed.level, "ERROR");
        assertEquals(parsed.message, "request.failed");
        assertEquals(parsed.http.method, "GET");
        assertEquals(parsed.http.path, "/error");
        assertEquals(parsed.http.status, 500);
      });
    });
  });
});
