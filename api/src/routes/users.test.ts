import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { z } from "zod";
import type { Lane } from "../db/schema.ts";

describe("routes/users.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions, riotApi } = deps;
  const client = testClient(app, {}, undefined, {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
  });
  const errorResponseSchema = z.object({
    code: z.string(),
    message: z.string(),
  });
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
        const { code, message } = errorResponseSchema.parse(await res.json());
        assertSpyCalls(mockFormatMessage, 1);
        assertSpyCall(mockFormatMessage, 0, {
          args: [messageKeys.riotAccount.set.error.summonerNotFound],
        });
        assertSpyCall(getAccountStub, 0, {
          args: ["asia", gameName, tagLine],
        });
        assertEquals(code, "RIOT_ACCOUNT_NOT_FOUND");
        assertEquals(message, "error message");
        assertEquals(upsertRiotAccountSpy.calls.length, 0);
      });
    });
  });

  describe("GET /users/:userId/riot-account", () => {
    test("Riotアカウントが存在するとき、アカウント情報を返す", async () => {
      const account = {
        isMain: true,
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
        query: {},
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
        query: {},
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
        "ギルドIDが指定されていないとき、422エラーを返す",
        async () => {
          // Arrange
          const role = "Jungle";
          const req = new Request(
            `http://localhost/users/${userId}/main-role`,
            {
              method: "PUT",
              headers: {
                ...TEST_BOT_SERVICE_AUTH_HEADERS,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ role }),
            },
          );

          // Act
          const res = await app.request(req);

          // Assert
          assertEquals(res.status, 422);
        },
      );

      test("無効なロールが指定されたとき、422エラーを返す", async () => {
        // Arrange
        const role = "InvalidRole";
        const req = new Request(
          `http://localhost/users/${userId}/main-role`,
          {
            method: "PUT",
            headers: {
              ...TEST_BOT_SERVICE_AUTH_HEADERS,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ role }),
          },
        );

        // Act
        const res = await app.request(req);

        // Assert
        assertEquals(res.status, 422);
      });
    });
  });
});

for (const platform of ["ph2", "th2"]) {
  test(`${platform} で新規Riot ID登録すると外部照合・保存前に422で拒否する`, async () => {
    // Arrange
    const deps = createTestDependencies();
    using account = stub(
      deps.riotApi,
      "getAccountByRiotId",
      () => Promise.resolve(null),
    );
    using save = stub(
      deps.dbActions,
      "upsertRiotAccount",
      () => Promise.resolve(),
    );

    // Act
    const response = await createApp(deps).request("/users/link-by-riot-id", {
      method: "PATCH",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        discordId: "owner",
        gameName: "Teemo",
        tagLine: "SEA",
        platform,
      }),
    });

    // Assert
    assertEquals(response.status, 422);
    assertSpyCalls(account, 0);
    assertSpyCalls(save, 0);
  });
}

for (
  const scenario of [
    { platform: "sg2", defaultPlatform: "jp1", expected: "sg2", region: "sea" },
    { platform: "oc1", defaultPlatform: "jp1", expected: "oc1", region: "sea" },
    {
      platform: undefined,
      defaultPlatform: "th2",
      expected: "sg2",
      region: "sea",
    },
    {
      platform: undefined,
      defaultPlatform: "euw1",
      expected: "euw1",
      region: "europe",
    },
  ] as const
) {
  test(`platform=${scenario.platform ?? "省略"}・既定=${scenario.defaultPlatform} で登録するとregionをplatformから導出する`, async () => {
    // Arrange
    const deps = createTestDependencies();
    const env = deps.env.get;
    using _env = stub(
      deps.env,
      "get",
      (name) =>
        name === "RIOT_DEFAULT_PLATFORM"
          ? scenario.defaultPlatform
          : name === "RIOT_DEFAULT_REGION"
          ? "asia"
          : env(name),
    );
    using account = stub(
      deps.riotApi,
      "getAccountByRiotId",
      () =>
        Promise.resolve({
          puuid: "account",
          gameName: "Teemo",
          tagLine: "SEA",
        }),
    );
    using save = stub(
      deps.dbActions,
      "upsertRiotAccount",
      () => Promise.resolve(),
    );

    // Act
    const response = await createApp(deps).request("/users/link-by-riot-id", {
      method: "PATCH",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        discordId: "owner",
        gameName: "Teemo",
        tagLine: "SEA",
        platform: scenario.platform,
      }),
    });

    // Assert
    assertEquals(response.status, 204);
    assertSpyCall(account, 0, { args: [scenario.region, "Teemo", "SEA"] });
    assertSpyCall(save, 0, {
      args: [{
        discordId: "owner",
        puuid: "account",
        gameName: "Teemo",
        tagLine: "SEA",
        platform: scenario.expected,
        region: scenario.region,
      }],
    });
  });
}

test("platformとregionが一致しない登録を422で拒否する", async () => {
  // Arrange
  const deps = createTestDependencies();
  using account = stub(
    deps.riotApi,
    "getAccountByRiotId",
    () => Promise.resolve(null),
  );

  // Act
  const response = await createApp(deps).request("/users/link-by-riot-id", {
    method: "PATCH",
    headers: {
      ...TEST_BOT_SERVICE_AUTH_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      discordId: "owner",
      gameName: "Teemo",
      tagLine: "SEA",
      platform: "sg2",
      region: "asia",
    }),
  });

  // Assert
  assertEquals(response.status, 422);
  assertSpyCalls(account, 0);
});
