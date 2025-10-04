import { testClient } from "@hono/hono/testing";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import app from "./app.ts";

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
    });
  });
});
