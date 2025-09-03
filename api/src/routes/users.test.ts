import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import app from "../index.ts";

describe("PUT /users/:userId/main-role", () => {
  it("有効なロールを送信してメインロールを設定すると、成功レスポンスが返される", async () => {
    const userId = `test-user-${Date.now()}`;
    const payload = { role: "Jungle" };

    const res = await app.request(`/users/${userId}/main-role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.success, true);
  });
});
