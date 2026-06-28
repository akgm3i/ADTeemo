import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import { createTestDependencies } from "../test_utils.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { z } from "zod";
import type { Lane } from "../db/schema.ts";

describe("routes/users.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions, riotApi } = deps;
  const client = testClient(app);
  const errorResponseSchema = z.object({ error: z.string() });
  const discordId = "test-discord-id";
  const gameName = "TestUser";
  const tagLine = "JP1";
  const puuid = "test-puuid";

  describe("POST /users/link-by-riot-id", () => {
    describe("正常系", () => {
      test(
        "未登録のDiscord IDでRiot ID連携を実行するとリンク用アクションを呼び出し、204 No Contentを返す",
        async () => {
          // Arrange
          using getAccountStub = stub(
            riotApi,
            "getAccountByRiotId",
            () => Promise.resolve({ puuid, gameName, tagLine }),
          );
          using upsertRiotAccountStub = stub(
            dbActions,
            "upsertRiotAccount",
            () => Promise.resolve(),
          );

          // Act
          const res = await client.users["link-by-riot-id"].$patch({
            json: { discordId, gameName, tagLine },
          });

          // Assert
          assert(res.status === 204);
          assertEquals(await res.text(), "");
          assertSpyCall(getAccountStub, 0, {
            args: ["asia", gameName, tagLine],
          });
          assertSpyCall(upsertRiotAccountStub, 0, {
            args: [{
              discordId,
              puuid,
              gameName,
              tagLine,
              platform: "jp1",
              region: "asia",
            }],
          });
        },
      );

      test("platformとregionを指定してRiot ID連携すると、指定regionでAccount-v1を呼び出して保存する", async () => {
        // Arrange
        using getAccountStub = stub(
          riotApi,
          "getAccountByRiotId",
          () => Promise.resolve({ puuid, gameName, tagLine }),
        );
        using upsertRiotAccountStub = stub(
          dbActions,
          "upsertRiotAccount",
          () => Promise.resolve(),
        );

        // Act
        const res = await client.users["link-by-riot-id"].$patch({
          json: {
            discordId,
            gameName,
            tagLine,
            platform: "euw1",
            region: "europe",
          },
        });

        // Assert
        assert(res.status === 204);
        assertEquals(await res.text(), "");
        assertSpyCall(getAccountStub, 0, {
          args: ["europe", gameName, tagLine],
        });
        assertSpyCall(upsertRiotAccountStub, 0, {
          args: [{
            discordId,
            puuid,
            gameName,
            tagLine,
            platform: "euw1",
            region: "europe",
          }],
        });
      });
    });

    describe("異常系", () => {
      test("Riotアカウントが見つからない場合、404とエラーメッセージを返す", async () => {
        // Arrange
        using getAccountStub = stub(
          riotApi,
          "getAccountByRiotId",
          () => Promise.resolve(null),
        );
        using upsertRiotAccountSpy = stub(
          dbActions,
          "upsertRiotAccount",
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
        const { error } = errorResponseSchema.parse(await res.json());
        assertSpyCalls(mockFormatMessage, 1);
        assertSpyCall(mockFormatMessage, 0, {
          args: [messageKeys.riotAccount.set.error.summonerNotFound],
        });
        assertSpyCall(getAccountStub, 0, {
          args: ["asia", gameName, tagLine],
        });
        assertEquals(error, "error message");
        assertEquals(upsertRiotAccountSpy.calls.length, 0);
      });
    });
  });

  describe("GET /users/:userId/riot-account", () => {
    test("Riotアカウントが存在するとき、アカウント情報を返す", async () => {
      const account = {
        discordId,
        puuid,
        gameName,
        tagLine,
        platform: "jp1" as const,
        region: "asia" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      using getRiotAccountStub = stub(
        dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(account),
      );

      const res = await client.users[":userId"]["riot-account"].$get({
        param: { userId: discordId },
      });

      assert(res.status === 200);
      const body = await res.json();
      assertEquals(body.account.puuid, puuid);
      assertSpyCall(getRiotAccountStub, 0, { args: [discordId] });
    });

    test("Riotアカウントが存在しないとき、404を返す", async () => {
      using _getRiotAccountStub = stub(
        dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(undefined),
      );

      const res = await client.users[":userId"]["riot-account"].$get({
        param: { userId: discordId },
      });

      assertEquals(res.status, 404);
    });
  });

  describe("PUT /users/:userId/main-role", () => {
    const userId = "test-user-id";
    const guildId = "test-guild-id";

    describe("正常系", () => {
      test(
        "有効なロールとギルドIDが指定されたとき、ユーザーのメインロールを設定して204 No Contentを返す",
        async () => {
          // Arrange
          const role: Lane = "Jungle";
          using setMainRoleStub = stub(
            dbActions,
            "setMainRole",
            () => Promise.resolve(),
          );

          // Act
          const res = await client.users[":userId"]["main-role"].$put({
            param: { userId },
            json: { guildId, role },
          });

          // Assert
          assert(res.status === 204);
          assertSpyCalls(setMainRoleStub, 1);
          assertSpyCall(setMainRoleStub, 0, {
            args: [userId, guildId, role],
          });
        },
      );
    });

    describe("異常系", () => {
      test(
        "ギルドIDが指定されていないとき、400エラーを返す",
        async () => {
          // Arrange
          const role = "Jungle";
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
        },
      );

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
