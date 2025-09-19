import { testClient } from "@hono/hono/testing";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import app from "./app.ts";

describe("app.ts", () => {
  const client = testClient(app);

  describe("GET /health", () => {
    describe("正常系", () => {
      it("リクエストを送信したとき、status 200と正常なbodyが返される", async () => {
        const res = await client.health.$get();

        assertEquals(res.status, 200);
        assertEquals(await res.json(), {
          ok: true,
          message: "This API is healthy!",
        });
      });
    });
  });
});
