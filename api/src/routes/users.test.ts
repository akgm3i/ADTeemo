import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";

describe("routes/users.ts", () => {
  const client = testClient(app);

  describe("PUT /users/:userId/main-role", () => {
    const userId = "test-user-id";

    describe("正常系", () => {
      it("有効なロールが指定されたとき、ユーザーのメインロールが設定され、成功レスポンスを返す", async () => {
        // Setup
        const role = "Jungle";
        using setMainRoleStub = stub(
          dbActions,
          "setMainRole",
          () =>
            Promise.resolve({
              rows: [],
              columns: [],
              rowsAffected: 0,
              lastInsertRowid: undefined,
              columnTypes: [],
              toJSON: () => ({}),
            }),
        );

        // Act
        const res = await client.users[":userId"]["main-role"].$put({
          param: { userId },
          json: { role },
        });

        // Assert
        assert(res.ok);
        const body = await res.json();

        assertEquals(body, { success: true });
        assertSpyCall(setMainRoleStub, 0, { args: [userId, role] });
      });
    });

    describe("異常系", () => {
      it("無効なロールが指定されたとき、400エラーを返す", async () => {
        const role = "InvalidRole";
        const req = new Request(
          `http://localhost/users/${userId}/main-role`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
          },
        );

        const res = await app.request(req);
        assertEquals(res.status, 400);
      });
    });
  });
});
