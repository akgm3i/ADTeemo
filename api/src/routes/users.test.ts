import { testClient } from "@hono/hono/testing";
import { assert, assertEquals, assertExists } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";
import { riotApi } from "../riot_api.ts";
import { messageHandler, messageKeys } from "../messages.ts";

describe("routes/users.ts", () => {
  const client = testClient(app);

  describe("POST /users/link-by-riot-id", () => {
    const discordId = "test-discord-id";
    const gameName = "TestUser";
    const tagLine = "JP1";
    const puuid = "test-puuid";

    describe("正常系", () => {
      test(
        "未登録のDiscord IDでRiot ID連携するとリンク用アクションを呼び出し、200と{ success: true }を返す",
        async () => {
          // Arrange
          using getAccountStub = stub(
            riotApi,
            "getAccountByRiotId",
            () => Promise.resolve({ puuid, gameName, tagLine }),
          );
          using linkUserWithRiotIdStub = stub(
            dbActions,
            "linkUserWithRiotId",
            () => Promise.resolve(),
          );

          // Act
          const res = await client.users["link-by-riot-id"].$patch({
            json: { discordId, gameName, tagLine },
          });

          // Assert
          assertEquals(res.status, 200);
          const body = await res.json();
          assertEquals(body, { success: true });
          assertSpyCall(getAccountStub, 0, { args: [gameName, tagLine] });
          assertSpyCall(linkUserWithRiotIdStub, 0, {
            args: [discordId, puuid],
          });
        },
      );

      test("Riotアカウントが見つかり、リンク処理が成功した場合、成功レスポンスを返す", async () => {
        // Arrange
        using getAccountStub = stub(
          riotApi,
          "getAccountByRiotId",
          () => Promise.resolve({ puuid, gameName, tagLine }),
        );
        using linkUserWithRiotIdStub = stub(
          dbActions,
          "linkUserWithRiotId",
          () => Promise.resolve(),
        );

        // Act
        const res = await client.users["link-by-riot-id"].$patch({
          json: { discordId, gameName, tagLine },
        });

        // Assert
        assert(res.ok);
        assertSpyCall(getAccountStub, 0, { args: [gameName, tagLine] });
        assertSpyCall(linkUserWithRiotIdStub, 0, {
          args: [discordId, puuid],
        });
      });
    });

    describe("異常系", () => {
      test("Riotアカウントが見つからない場合、404エラーレスポンスを返す", async () => {
        // Arrange
        using getAccountStub = stub(
          riotApi,
          "getAccountByRiotId",
          () => Promise.resolve(null),
        );
        using linkUserWithRiotIdSpy = stub(
          dbActions,
          "linkUserWithRiotId",
        );
        using mockFormatMessage = stub(
          messageHandler,
          "formatMessage",
          () => "error message",
        );

        // Act
        const res = await client.users["link-by-riot-id"].$patch({
          json: { discordId, gameName, tagLine },
        });

        // Assert
        assert(res.status === 404);
        const body = await res.json() as { error?: string };
        assertExists(body.error);
        assertSpyCalls(mockFormatMessage, 1);
        assertSpyCall(mockFormatMessage, 0, {
          args: [messageKeys.riotAccount.set.error.summonerNotFound],
        });
        assertSpyCall(getAccountStub, 0, { args: [gameName, tagLine] });
        assertEquals(linkUserWithRiotIdSpy.calls.length, 0);
      });
    });
  });

  describe("PUT /users/:userId/main-role", () => {
    const userId = "test-user-id";

    describe("正常系", () => {
      test("有効なロールが指定されたとき、ユーザーのメインロールが設定され、成功レスポンスを返す", async () => {
        // Arrange
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
      test("無効なロールが指定されたとき、400エラーを返す", async () => {
        // Arrange
        const role = "InvalidRole";
        const req = new Request(
          `http://localhost/users/${userId}/main-role`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
          },
        );

        // Act
        const res = await app.request(req);

        // Assert
        assertEquals(res.status, 400);
      });
    });
  });
});
