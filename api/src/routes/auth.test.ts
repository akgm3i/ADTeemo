import { testClient } from "@hono/hono/testing";
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import { dbActions } from "../db/actions.ts";
import { rso } from "../rso.ts";
import { type MessageKey, messageKeys } from "../messages.ts";

describe("routes/auth.ts", () => {
  describe("GET /rso/login-url", () => {
    describe("正常系", () => {
      it("有効なdiscordIdが提供されたとき、認証用のstateを保存し、認証URLを返す", async () => {
        using getAuthorizationUrlStub = stub(
          rso,
          "getAuthorizationUrl",
          (state: string) => `https://mock.auth.url/authorize?state=${state}`,
        );
        using createAuthStateStub = stub(
          dbActions,
          "createAuthState",
          () => Promise.resolve(),
        );

        const app = createApp();
        const client = testClient(app);
        const discordId = "discord-123";

        const res = await client.auth.rso["login-url"].$get({
          query: { discordId },
        });

        assert(res.ok);
        const body = await res.json();

        assert(body.url.startsWith("https://mock.auth.url"));
        assertSpyCalls(getAuthorizationUrlStub, 1);

        const state = getAuthorizationUrlStub.calls[0].args[0];
        assertSpyCall(createAuthStateStub, 0, { args: [state, discordId] });
      });
    });
  });

  describe("GET /rso/callback", () => {
    describe("正常系", () => {
      it("有効なcodeとstateが提供されたとき、stateを検証・削除し、ユーザーのRiot IDを更新して成功ページを返す", async () => {
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
        using updateUserRiotIdStub = stub(
          dbActions,
          "updateUserRiotId",
          () => Promise.resolve(),
        );
        using deleteAuthStateStub = stub(
          dbActions,
          "deleteAuthState",
          () => Promise.resolve(),
        );

        const app = createApp();
        const client = testClient(app);

        const res = await client.auth.rso.callback.$get({
          query: { code, state },
        });

        assert(res.ok);
        assertEquals(
          res.headers.get("content-type"),
          "text/html; charset=UTF-8",
        );

        assertSpyCall(getAuthStateStub, 0, { args: [state] });
        assertSpyCall(exchangeCodeForTokensStub, 0, { args: [code] });
        assertSpyCall(getUserInfoStub, 0, { args: [accessToken] });
        assertSpyCall(updateUserRiotIdStub, 0, { args: [discordId, riotId] });
        assertSpyCall(deleteAuthStateStub, 0, { args: [state] });
      });
    });

    describe("異常系", () => {
      it("stateが見つからない場合、400 Bad Requestを返す", async () => {
        using getAuthStateStub = stub(
          dbActions,
          "getAuthState",
          () => Promise.resolve(undefined),
        );
        const mockFormatMessage = spy(
          (_key: MessageKey, _params?: Record<string, string | number>) =>
            "Formatted Message",
        );

        const app = createApp(mockFormatMessage, messageKeys);
        const client = testClient(app);

        const res = await client.auth.rso.callback.$get({
          query: { code: "any-code", state: "invalid-state" },
        });

        assertEquals(res.status, 400);
        assertSpyCall(getAuthStateStub, 0, { args: ["invalid-state"] });
        assertSpyCall(mockFormatMessage, 0, {
          args: [messageKeys.riotAccount.link.error.invalidState],
        });
      });
    });
  });
});
