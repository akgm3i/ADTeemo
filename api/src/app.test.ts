import { testClient } from "@hono/hono/testing";
import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createApp, createRequestLoggingMiddleware } from "./app.ts";
import { createTestDependencies } from "./test_utils.ts";

describe("app.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
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

      test("リクエストを送信したとき、HTTPメソッドとパス、ステータスを含むログを注入loggerへ出力する", async () => {
        // Arrange
        using infoStub = stub(deps.logger, "info", () => {});

        // Act
        await client.health.$get();

        // Assert
        assertSpyCalls(infoStub, 1);
        const [message, context] = infoStub.calls[0].args;
        assertEquals(message, "request.completed");
        assertEquals(context?.http, {
          method: "GET",
          path: "/health",
          status: 200,
        });
        assertEquals(typeof context?.durationMs, "number");
      });

      test("ハンドラ例外で500が返るとき、失敗リクエストとして注入loggerへERRORログを出力する", async () => {
        // Arrange
        const logger = createTestDependencies().logger;
        using errorStub = stub(logger, "error", () => {});
        const failingApp = new Hono()
          .use("*", createRequestLoggingMiddleware(logger))
          .get("/error", () => {
            throw new Error("Unexpected failure");
          });

        // Act
        const res = await failingApp.request("/error");

        // Assert
        assertEquals(res.status, 500);
        assertSpyCalls(errorStub, 1);
        const [message, context] = errorStub.calls[0].args;
        assertEquals(message, "request.failed");
        assertEquals(context?.http, {
          method: "GET",
          path: "/error",
          status: 500,
        });
        assertEquals(typeof context?.durationMs, "number");
        assertEquals(errorStub.calls[0].args.length, 2);
      });
    });
  });
});
