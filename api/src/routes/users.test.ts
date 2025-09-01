import { assertEquals } from "jsr:@std/assert";
import app from "../index.ts";

// Note: These are integration tests that will hit the actual database.
// For a real production app, you would mock the DB layer or use a dedicated test database.
// For this project, we will proceed with this approach and ensure the DB is clean for tests.

Deno.test("User Routes API", async (t) => {
  const userId = `test-user-${Date.now()}`; // Use unique user ID for each test run

  await t.step("POST /users/:userId/roles -> should add a role", async () => {
    const payload = { role: "TOP" };
    const res = await app.request(`/users/${userId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  });

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

  await t.step(
    "DELETE /users/:userId/roles/:role -> should remove the added role",
    async () => {
      const res = await app.request(`/users/${userId}/roles/TOP`, {
        method: "DELETE",
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.success, true);
    },
  );

  await t.step(
    "POST /users/:userId/roles -> should fail with an invalid role",
    async () => {
      const payload = { role: "INVALID_ROLE" };
      const res = await app.request(`/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assertEquals(res.status, 400);
    },
  );
});
