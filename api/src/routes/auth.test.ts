import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, stub } from "@std/testing/mock";
import app from "../app.ts";
import { testable } from "./auth.ts";

describe("routes/auth.ts", () => {
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

        const req = new Request(
          "http://localhost/auth/rso/callback?code=any-code&state=invalid-state",
        );
        const res = await app.request(req);

        // Assertion
        assertEquals(res.status, 400);
        const body = await res.json();
        assertEquals(body.success, false);
        assertEquals(body.error, "Invalid or expired state provided.");
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

        const req = new Request(
          `http://localhost/auth/rso/callback?code=any-code&state=${mockState}`,
        );
        const res = await app.request(req);

        // Assertion
        assertEquals(res.status, 500);
        const body = await res.json();
        assertEquals(body.success, false);
        assertEquals(body.error, "Internal Server Error");
      });
    });
  });
});
