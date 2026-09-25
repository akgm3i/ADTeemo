import { assertEquals, assertRejects } from "@std/assert";
import { test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import {
  exchangeCodeForTokens,
  getAccount,
  getAuthorizationUrl,
  RsoProviderError,
} from "./rso.ts";

const config: Record<string, string> = {
  RSO_CLIENT_ID: "client-id",
  RSO_CLIENT_SECRET: "client-secret",
  RSO_REDIRECT_URI: "https://adteemo.example.test/",
};

test("token providerが失敗すると、response bodyや秘密値を公開エラーへ含めない", async () => {
  const response = new Response("private-provider-body", { status: 500 });
  using _env = stub(Deno.env, "get", (key) => config[key]);
  using _fetch = stub(globalThis, "fetch", () => Promise.resolve(response));
  using log = stub(console, "error");
  const error = await assertRejects(
    () => exchangeCodeForTokens("secret-code"),
    RsoProviderError,
  );
  assertEquals(error.message, "Riot Sign On token request failed (HTTP 500)");
  assertEquals(response.bodyUsed, false);
  assertSpyCalls(log, 0);
});

test("認証済accountを取得すると、access tokenをaccounts/meへ渡しsubではなくPUUIDを返す", async () => {
  using fetch = stub(
    globalThis,
    "fetch",
    () =>
      Promise.resolve(
        Response.json({
          sub: "not-a-puuid",
          puuid: "canonical-puuid",
          gameName: "Teemo",
          tagLine: "NA1",
        }),
      ),
  );
  assertEquals(await getAccount("access-token", "americas"), {
    puuid: "canonical-puuid",
    gameName: "Teemo",
    tagLine: "NA1",
  });
  assertSpyCall(fetch, 0, {
    args: ["https://americas.api.riotgames.com/riot/account/v1/accounts/me", {
      headers: { Authorization: "Bearer access-token" },
    }],
  });
});

test("providerが不正JSONまたは不正schemaを返すと、本文を含まないRSOエラーにする", async () => {
  for (const body of ['{"puuid":"private-value"}', "not-json"]) {
    using _fetch = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response(body, { status: 200 })),
    );
    const error = await assertRejects(
      () => getAccount("secret-token", "asia"),
      RsoProviderError,
    );
    assertEquals(error.message.includes("private-value"), false);
    assertEquals(error.message.includes("secret-token"), false);
  }
});

test("設定が有効なとき、認可URLとtoken交換に同じcallback URIとstateを使う", async () => {
  using _env = stub(Deno.env, "get", (key) => config[key]);
  const url = new URL(getAuthorizationUrl("state-1"));
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://adteemo.example.test/auth/rso/callback",
  );
  assertEquals(url.searchParams.get("state"), "state-1");
  using request = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(Response.json({ access_token: "token" })),
  );
  assertEquals(await exchangeCodeForTokens("code-1"), {
    accessToken: "token",
    idToken: undefined,
  });
  const options = request.calls[0].args[1];
  assertEquals(
    (options?.body as URLSearchParams).get("redirect_uri"),
    url.searchParams.get("redirect_uri"),
  );
});
