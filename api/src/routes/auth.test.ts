import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import app from "../app.ts";
import { testable } from "./auth.ts";
import { messageKeys } from "../messages.ts";

describe("routes/auth.ts", () => {
  describe("GET /auth/rso/login-url", () => {
    it("有効なdiscordIdが提供されたとき、stateを作成し、認証URLを返す", async () => {
      // Setup
      const mockDiscordId = "discord-123";
      const mockState: `${string}-${string}-${string}-${string}-${string}` =
        "a1b2c3d4-e5f6-7890-1234-567890abcdef";
      const mockAuthUrl = `https://mock.auth.url/authorize?state=${mockState}`;

      using _uuidStub = stub(crypto, "randomUUID", () => mockState);
      using createAuthStateStub = stub(
        testable.dbActions,
        "createAuthState",
        () => Promise.resolve(),
      );
      using getAuthUrlStub = stub(
        testable.rso,
        "getAuthorizationUrl",
        () => mockAuthUrl,
      );

      const req = new Request(
        `http://localhost/auth/rso/login-url?discordId=${mockDiscordId}`,
      );
      const res = await app.request(req);
      const body = await res.json();

      // Assertions
      assertEquals(res.status, 200);
      assertEquals(body.url, mockAuthUrl);

      assertSpyCall(createAuthStateStub, 0, {
        args: [mockState, mockDiscordId],
      });
      assertSpyCall(getAuthUrlStub, 0, {
        args: [mockState],
      });
    });

    it("discordIdが提供されない場合、400 Bad Requestを返す", async () => {
      const req = new Request("http://localhost/auth/rso/login-url");
      const res = await app.request(req);
      assertEquals(res.status, 400);
    });
  });

  describe("GET /auth/rso/callback", () => {
    describe("正常系", () => {
      it("有効なcodeとstateが提供されたとき、Riot APIからトークンを取得し、ユーザーのriotIdを更新して、成功ページを返す", async () => {
        // Setup: Mocks and Stubs
        const mockState = "valid-state-123";
        const mockDiscordId = "discord-id-456";
        const mockRiotId = "riot-id-789";

        using _getAuthStateStub = stub(
          testable.dbActions,
          "getAuthState",
          () =>
            Promise.resolve({
              discordId: mockDiscordId,
              state: mockState,
              createdAt: new Date(),
            }),
        );
        using exchangeCodeForTokensStub = stub(
          testable.rso,
          "exchangeCodeForTokens",
          () =>
            Promise.resolve({
              accessToken: "access-token",
              idToken: "id-token",
            }),
        );
        using getUserInfoStub = stub(
          testable.rso,
          "getUserInfo",
          () => Promise.resolve({ sub: mockRiotId }),
        );
        using updateUserRiotIdStub = stub(
          testable.dbActions,
          "updateUserRiotId",
          () => Promise.resolve(),
        );
        using deleteAuthStateStub = stub(
          testable.dbActions,
          "deleteAuthState",
          () => Promise.resolve(),
        );

        const req = new Request(
          `http://localhost/auth/rso/callback?code=valid-code&state=${mockState}`,
        );
        const res = await app.request(req);

        // Assertion
        assert(res.ok);
        assertEquals(
          res.headers.get("content-type"),
          "text/html; charset=UTF-8",
        );
        const text = await res.text();
        assert(text.includes("認証が完了しました"));

        // Verify stub calls
        assertSpyCall(_getAuthStateStub, 0, { args: [mockState] });
        assertSpyCall(exchangeCodeForTokensStub, 0, { args: ["valid-code"] });
        assertSpyCall(getUserInfoStub, 0, { args: ["access-token"] });
        assertSpyCall(updateUserRiotIdStub, 0, {
          args: [mockDiscordId, mockRiotId],
        });
        assertSpyCall(deleteAuthStateStub, 0, { args: [mockState] });
      });
    });

    describe("異常系", () => {
      it("stateが見つからない場合、400 Bad Requestを返す", async () => {
        // Setup
        using _getAuthStateStub = stub(
          testable.dbActions,
          "getAuthState",
          () => Promise.resolve(undefined),
        );
        using formatMessageSpy = spy(testable, "formatMessage");

        const req = new Request(
          "http://localhost/auth/rso/callback?code=any-code&state=invalid-state",
        );
        const res = await app.request(req);

        // Assertion
        assertEquals(res.status, 400);
        const body = await res.json();
        assertEquals(body.success, false);
        assertSpyCalls(formatMessageSpy, 1);
        assertSpyCall(formatMessageSpy, 0, {
          args: [messageKeys.riotAccount.link.error.invalidState],
        });
      });

      it("Riot APIへのトークン要求が失敗した場合、500 Internal Server Errorを返す", async () => {
        // Setup
        const mockState = "valid-state-123";
        using _getAuthStateStub = stub(
          testable.dbActions,
          "getAuthState",
          () =>
            Promise.resolve({
              discordId: "discord-id",
              state: mockState,
              createdAt: new Date(),
            }),
        );
        using _exchangeCodeForTokensStub = stub(
          testable.rso,
          "exchangeCodeForTokens",
          () => Promise.reject(new Error("Riot API Error")),
        );
        using formatMessageSpy = spy(testable, "formatMessage");

        const req = new Request(
          `http://localhost/auth/rso/callback?code=any-code&state=${mockState}`,
        );
        const res = await app.request(req);

        // Assertion
        assertEquals(res.status, 500);
        const body = await res.json();
        assertEquals(body.success, false);
        assertSpyCall(formatMessageSpy, 0, {
          args: [messageKeys.common.error.internalServerError],
        });
      });
    });
  });
});
