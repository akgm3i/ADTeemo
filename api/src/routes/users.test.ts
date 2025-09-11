import { testClient } from "@hono/hono/testing";
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import app from "../app.ts";

describe("Routes: Users", () => {
  const client = testClient(app);

  describe("PUT /users/:userId/main-role", () => {
    it("有効なロールを送信してメインロールを設定すると、成功レスポンスが返される", async () => {
      const userId = `test-user-${Date.now()}`;
      const role = "Jungle";

      const res = await client.users[":userId"]["main-role"].$put(
        {
          param: { userId },
          json: { role },
        },
      );

      assertEquals(res.status, 200);
      assertEquals(await res.json(), { success: true });
    });
  });
});
