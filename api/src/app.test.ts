import { testClient } from "@hono/hono/testing";
import { Hono } from "@hono/hono";
import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import {
  createApp,
  createClassifiedRoutes,
  createRequestLoggingMiddleware,
} from "./app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
  TEST_BOT_SERVICE_TOKEN,
} from "./test_utils.ts";

type RoutableApp = {
  routes: ReadonlyArray<{ method: string; path: string }>;
};

function endpointKeys(app: RoutableApp): string[] {
  return [
    ...new Set(
      app.routes
        .filter(({ method }) => method !== "ALL")
        .map(({ method, path }) => `${method} ${path}`),
    ),
  ].sort();
}

function requestTarget(endpointKey: string) {
  const separator = endpointKey.indexOf(" ");
  return {
    method: endpointKey.slice(0, separator),
    path: endpointKey.slice(separator + 1).replaceAll(/:[^/]+/g, "test"),
  };
}

describe("app.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const client = testClient(app, {}, undefined, {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
  });

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

      test("credentialなしでリクエストを送信したとき、public routeとして200を返す", async () => {
        // Act
        const res = await app.request("/health");

        // Assert
        assertEquals(res.status, 200);
      });

      test("リクエストを送信したとき、HTTPメソッドとパス、ステータスを含むログを注入loggerへ出力する", async () => {
        // Arrange
        using infoStub = stub(deps.logger, "info", () => {});

        // Act
        await client.health.$get();

        // Assert
        assertSpyCalls(infoStub, 1);
        const [message, context] = infoStub.calls[0].args;
        assertEquals(message, "request.completed");
        assertEquals(context?.http, {
          method: "GET",
          path: "/health",
          status: 200,
        });
        assertEquals(typeof context?.durationMs, "number");
      });

      test("ハンドラ例外で500が返るとき、失敗リクエストとして注入loggerへERRORログを出力する", async () => {
        // Arrange
        const logger = createTestDependencies().logger;
        using errorStub = stub(logger, "error", () => {});
        const failingApp = new Hono()
          .use("*", createRequestLoggingMiddleware(logger))
          .get("/error", () => {
            throw new Error("Unexpected failure");
          });

        // Act
        const res = await failingApp.request("/error");

        // Assert
        assertEquals(res.status, 500);
        assertSpyCalls(errorStub, 1);
        const [message, context] = errorStub.calls[0].args;
        assertEquals(message, "request.failed");
        assertEquals(context?.http, {
          method: "GET",
          path: "/error",
          status: 500,
        });
        assertEquals(typeof context?.durationMs, "number");
      });

      test("下流middlewareが例外を再throwしたとき、失敗リクエストと例外を注入loggerへERRORログ出力する", async () => {
        // Arrange
        const logger = createTestDependencies().logger;
        using errorStub = stub(logger, "error", () => {});
        const middleware = createRequestLoggingMiddleware(logger);
        const error = new Error("Unexpected failure");
        const context = {
          req: {
            method: "POST",
            path: "/error",
          },
          res: new Response(null, { status: 200 }),
        } as unknown as Parameters<typeof middleware>[0];

        // Act
        await assertRejects(
          () => middleware(context, () => Promise.reject(error)),
          Error,
          error.message,
        );

        // Assert
        assertSpyCalls(errorStub, 1);
        const [message, logContext, loggedError] = errorStub.calls[0].args;
        assertEquals(message, "request.failed");
        assertEquals(logContext?.http, {
          method: "POST",
          path: "/error",
          status: 500,
        });
        assertEquals(typeof logContext?.durationMs, "number");
        assertStrictEquals(loggedError, error);
      });
    });
  });

  describe("route classification", () => {
    test("全endpointをpublic、browser callback、Bot serviceのいずれか一つへ分類する", () => {
      // Arrange
      const classified = createClassifiedRoutes(deps);
      const publicEndpoints = endpointKeys(classified.publicRoutes);
      const callbackEndpoints = endpointKeys(classified.callbackRoutes);
      const botServiceEndpoints = endpointKeys(classified.botServiceRoutes);
      const allClassifiedEndpoints = [
        ...publicEndpoints,
        ...callbackEndpoints,
        ...botServiceEndpoints,
      ];

      // Act
      const uniqueClassifiedEndpoints = [...new Set(allClassifiedEndpoints)]
        .sort();

      // Assert
      assertEquals(publicEndpoints, ["GET /health"]);
      assertEquals(callbackEndpoints, ["GET /auth/rso/callback"]);
      assertEquals(
        botServiceEndpoints.includes("GET /auth/rso/login-url"),
        true,
      );
      assertEquals(
        uniqueClassifiedEndpoints.length,
        allClassifiedEndpoints.length,
      );
      assertEquals(uniqueClassifiedEndpoints, endpointKeys(app));
    });

    test("Bot serviceへ分類した全endpointはcredentialなしの場合にhandlerより先に401を返す", async () => {
      // Arrange
      const { botServiceRoutes } = createClassifiedRoutes(deps);

      // Act / Assert
      for (const endpointKey of endpointKeys(botServiceRoutes)) {
        const { method, path } = requestTarget(endpointKey);
        const res = await app.request(path, { method });
        assertEquals(res.status, 401, endpointKey);
        assertEquals(await res.json(), {
          code: "UNAUTHORIZED",
          error: "Unauthorized",
        });
      }
    });

    test("credentialなしでbrowser callbackへアクセスしたとき、認証middlewareを通さずcallback handlerを実行する", async () => {
      // Arrange
      const callbackDeps = createTestDependencies();
      using getAuthStateStub = stub(
        callbackDeps.dbActions,
        "getAuthState",
        () => Promise.resolve(undefined),
      );
      const callbackApp = createApp(callbackDeps);

      // Act
      const res = await callbackApp.request(
        "/auth/rso/callback?code=code&state=state",
      );

      // Assert
      assertEquals(res.status, 400);
      assertSpyCalls(getAuthStateStub, 1);
    });
  });

  describe("Bot service authentication", () => {
    test("credentialなしの場合、401を返してrepositoryを呼ばない", async () => {
      // Arrange
      using repositoryStub = stub(
        deps.dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(undefined),
      );

      // Act
      const res = await app.request("/users/user-1/riot-account");

      // Assert
      assertEquals(res.status, 401);
      assertEquals(await res.json(), {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
      });
      assertSpyCalls(repositoryStub, 0);
    });

    test("不正なcredentialの場合、秘密値をレスポンスとログへ含めず401を返す", async () => {
      // Arrange
      const invalidCredential =
        "invalid-bot-service-token-0000000000000000000000000000";
      using repositoryStub = stub(
        deps.dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(undefined),
      );
      using infoStub = stub(deps.logger, "info", () => {});
      using warnStub = stub(deps.logger, "warn", () => {});

      // Act
      const res = await app.request("/users/user-1/riot-account", {
        headers: { Authorization: `Bearer ${invalidCredential}` },
      });
      const responseBody = await res.text();

      // Assert
      assertEquals(res.status, 401);
      assertEquals(JSON.parse(responseBody), {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
      });
      assertSpyCalls(repositoryStub, 0);
      assertFalse(responseBody.includes(invalidCredential));
      assertFalse(
        JSON.stringify([...infoStub.calls, ...warnStub.calls]).includes(
          invalidCredential,
        ),
      );
    });

    test("正しい現行credentialの場合、既存のhandlerとrepositoryを実行する", async () => {
      // Arrange
      const account = {
        discordId: "user-1",
        puuid: "puuid-1",
        gameName: "Teemo",
        tagLine: "JP1",
        platform: "jp1" as const,
        region: "asia" as const,
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
        updatedAt: new Date("2026-07-12T00:00:00.000Z"),
      };
      using repositoryStub = stub(
        deps.dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(account),
      );

      // Act
      const res = await app.request("/users/user-1/riot-account", {
        headers: TEST_BOT_SERVICE_AUTH_HEADERS,
      });

      // Assert
      assertEquals(res.status, 200);
      assertEquals((await res.json()).account.puuid, account.puuid);
      assertSpyCalls(repositoryStub, 1);
    });

    test("rotation中の旧credentialの場合、既存のhandlerとrepositoryを実行する", async () => {
      // Arrange
      const previousCredential =
        "previous-bot-service-token-00000000000000000000000000";
      const rotatingDeps = createTestDependencies({
        env: {
          get: (key: string) => {
            if (key === "BOT_SERVICE_TOKEN") return TEST_BOT_SERVICE_TOKEN;
            if (key === "BOT_SERVICE_TOKEN_PREVIOUS") {
              return previousCredential;
            }
            return undefined;
          },
        },
      });
      using repositoryStub = stub(
        rotatingDeps.dbActions,
        "getRiotAccountByDiscordId",
        () => Promise.resolve(undefined),
      );
      const rotatingApp = createApp(rotatingDeps);

      // Act
      const res = await rotatingApp.request("/users/user-1/riot-account", {
        headers: { Authorization: `Bearer ${previousCredential}` },
      });

      // Assert
      assertEquals(res.status, 404);
      assertSpyCalls(repositoryStub, 1);
    });

    test("現行credentialが未設定の場合、秘密値を含まない設定エラーで起動を拒否する", () => {
      // Arrange
      const missingCredentialDeps = createTestDependencies({
        env: { get: () => undefined },
      });

      // Act / Assert
      assertThrows(
        () => createApp(missingCredentialDeps),
        Error,
        "BOT_SERVICE_TOKEN must be at least 32 characters",
      );
    });
  });
});
