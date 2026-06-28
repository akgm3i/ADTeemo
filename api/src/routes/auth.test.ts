import { testClient } from "@hono/hono/testing";
import { describe, test } from "@std/testing/bdd";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { assertSpyCall, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import { createTestDependencies } from "../test_utils.ts";
import { messageHandler, messageKeys } from "../messages.ts";

describe("routes/auth.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions, rso } = deps;

  describe("GET /rso/login-url", () => {
    describe("正常系", () => {
      test("有効なdiscordIdが提供されたとき、認証用のstateを保存し、認証URLを返す", async () => {
        // Arrange
        const FIXED_UUID: `${string}-${string}-${string}-${string}-${string}` =
          "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0";
        using _uuidStub = stub(crypto, "randomUUID", () => FIXED_UUID);
        using createAuthStateStub = stub(
          dbActions,
          "createAuthState",
          () => Promise.resolve(),
        );
        using getAuthorizationUrlStub = stub(
          rso,
          "getAuthorizationUrl",
          (state: string) => `https://mock.auth.url/authorize?state=${state}`,
        );
        const client = testClient(app);
        const discordId = "discord-123";

        // Act
        const res = await client.auth.rso["login-url"].$get({
          query: { discordId },
        });

        // Assert
        assert(res.ok);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(
          body.url,
          `https://mock.auth.url/authorize?state=${FIXED_UUID}`,
        );
        assertSpyCall(createAuthStateStub, 0, {
          args: [FIXED_UUID, discordId],
        });
        assertSpyCall(getAuthorizationUrlStub, 0, { args: [FIXED_UUID] });
      });
    });
  });

  describe("GET /rso/callback", () => {
    describe("正常系", () => {
      test("有効なcodeとstateが提供されたとき、stateを検証・削除し、ユーザーのRiot IDを更新して成功ページを返す", async () => {
        // Arrange
        const code = "valid-code";
        const state = "valid-state-123";
        const discordId = "discord-id-456";
        const accessToken = "access-token";
        const riotId = "riot-id-789";
        using getAuthStateStub = stub(
          dbActions,
          "getAuthState",
          () =>
            Promise.resolve({
              discordId,
              state,
              createdAt: new Date(),
            }),
        );
        using exchangeCodeForTokensStub = stub(
          rso,
          "exchangeCodeForTokens",
          () => Promise.resolve({ accessToken, idToken: "id-token" }),
        );
        using getUserInfoStub = stub(
          rso,
          "getUserInfo",
          () => Promise.resolve({ sub: riotId }),
        );
        using linkUserWithRiotIdStub = stub(
          dbActions,
          "linkUserWithRiotId",
          () => Promise.resolve(),
        );
        using deleteAuthStateStub = stub(
          dbActions,
          "deleteAuthState",
          () => Promise.resolve(),
        );
        const client = testClient(app);

        // Act
        const res = await client.auth.rso.callback.$get({
          query: { code, state },
        });

        // Assert
        assert(res.ok);
        assertEquals(
          res.headers.get("content-type"),
          "text/html; charset=UTF-8",
        );
        assertSpyCall(getAuthStateStub, 0, { args: [state] });
        assertSpyCall(exchangeCodeForTokensStub, 0, { args: [code] });
        assertSpyCall(getUserInfoStub, 0, { args: [accessToken] });
        assertSpyCall(linkUserWithRiotIdStub, 0, {
          args: [discordId, riotId],
        });
        assertSpyCall(deleteAuthStateStub, 0, { args: [state] });
      });
    });

    describe("異常系", () => {
      test("stateが見つからない場合、400 Bad Requestを返す", async () => {
        // Arrange
        using getAuthStateStub = stub(
          dbActions,
          "getAuthState",
          () => Promise.resolve(undefined),
        );
        using mockFormatMessage = stub(
          messageHandler,
          "formatMessage",
          () => "Invalid state.",
        );
        const client = testClient(app);

        // Act
        const res = await client.auth.rso.callback.$get({
          query: { code: "any-code", state: "invalid-state" },
        });

        // Assert
        assertEquals(res.status, 400);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body, { error: "Invalid state." });
        assertFalse("success" in body);
        assertSpyCall(getAuthStateStub, 0, { args: ["invalid-state"] });
        assertSpyCall(mockFormatMessage, 0, {
          args: [messageKeys.riotAccount.link.error.invalidState],
        });
      });

      test("RSOトークン交換に失敗した場合、500とエラーメッセージを返しsuccessフラグは含めない", async () => {
        // Arrange
        const state = "valid-state-123";
        using _getAuthStateStub = stub(
          dbActions,
          "getAuthState",
          () =>
            Promise.resolve({
              discordId: "discord-id-456",
              state,
              createdAt: new Date(),
            }),
        );
        using _exchangeCodeForTokensStub = stub(
          rso,
          "exchangeCodeForTokens",
          () => Promise.reject(new Error("RSO error")),
        );
        using formatMessageStub = stub(
          messageHandler,
          "formatMessage",
          () => "Internal server error.",
        );
        const client = testClient(app);

        // Act
        const res = await client.auth.rso.callback.$get({
          query: { code: "valid-code", state },
        });

        // Assert
        assertEquals(res.status, 500);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body, { error: "Internal server error." });
        assertFalse("success" in body);
        assertSpyCall(formatMessageStub, 0, {
          args: [messageKeys.common.error.internalServerError],
        });
      });
    });
  });
});
