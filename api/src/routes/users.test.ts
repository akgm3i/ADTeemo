import { assertEquals } from "jsr:@std/assert";
import app from "../index.ts";

Deno.test("User Routes API", async (t) => {
  const userId = `test-user-${Date.now()}`; // Use unique user ID for each test run

  await t.step(
    "PUT /users/:userId/main-role -> should set the main role",
    async () => {
      const payload = { role: "JUNGLE" };
      const res = await app.request(`/users/${userId}/main-role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.success, true);
    },
  );
});
