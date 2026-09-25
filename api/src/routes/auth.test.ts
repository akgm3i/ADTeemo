import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import { RsoProviderError } from "../rso.ts";

const stateBinding = {
  state: "state-1",
  discordId: "user-1",
  guildId: "guild-1",
  platform: "na1" as const,
  region: "americas" as const,
  createdAt: new Date(),
};

test("認証済Botがlogin URLを生成すると、Discord user/guildとroutingをstateへ保存する", async () => {
  const deps = createTestDependencies();
  using create = stub(
    deps.dbActions,
    "createAuthState",
    () => Promise.resolve(),
  );
  using authUrl = stub(
    deps.rso,
    "getAuthorizationUrl",
    (state) => `https://auth.example.test/?state=${state}`,
  );
  const response = await createApp(deps).request(
    "/auth/rso/login-url?discordId=user-1&guildId=guild-1&platform=na1&region=americas",
    { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
  );
  assertEquals(response.status, 200);
  const { url } = await response.json();
  const state = new URL(url).searchParams.get("state")!;
  assertSpyCall(create, 0, {
    args: [state, {
      discordId: "user-1",
      guildId: "guild-1",
      platform: "na1",
      region: "americas",
    }],
  });
  assertSpyCall(authUrl, 0, { args: [state] });
});

test("callbackが有効なstateを消費すると、Account-v1のPUUIDとstateの所有者をcanonical repositoryへ保存する", async () => {
  const deps = createTestDependencies();
  using consumed = stub(
    deps.dbActions,
    "consumeAuthState",
    () => Promise.resolve(stateBinding),
  );
  using token = stub(
    deps.rso,
    "exchangeCodeForTokens",
    () =>
      Promise.resolve({
        accessToken: "access-token",
        idToken: "opaque-id-token",
      }),
  );
  using account = stub(
    deps.rso,
    "getAccount",
    () =>
      Promise.resolve({
        puuid: "canonical-puuid",
        gameName: "Teemo",
        tagLine: "NA1",
      }),
  );
  using saved = stub(
    deps.dbActions,
    "upsertRiotAccount",
    () => Promise.resolve(),
  );
  const response = await createApp(deps).request(
    "/auth/rso/callback?code=code-1&state=state-1",
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=UTF-8",
  );
  assertSpyCall(consumed, 0, { args: ["state-1"] });
  assertSpyCall(token, 0, { args: ["code-1"] });
  assertSpyCall(account, 0, { args: ["access-token", "americas"] });
  assertSpyCall(saved, 0, {
    args: [{
      discordId: "user-1",
      puuid: "canonical-puuid",
      gameName: "Teemo",
      tagLine: "NA1",
      platform: "na1",
      region: "americas",
    }],
  });
});

test("stateがない場合は400、callbackでuser/guildを上書きしようとした場合は422で拒否する", async () => {
  const deps = createTestDependencies();
  using consumed = stub(
    deps.dbActions,
    "consumeAuthState",
    () => Promise.resolve(undefined),
  );
  const app = createApp(deps);
  assertEquals(
    (await app.request("/auth/rso/callback?code=x&state=missing")).status,
    400,
  );
  assertEquals(
    (await app.request(
      "/auth/rso/callback?code=x&state=s&discordId=other-user",
    )).status,
    422,
  );
  assertSpyCalls(consumed, 1);
});

test("RSO providerが失敗すると、安全な502で応答しcallbackを成功表示しない", async () => {
  const deps = createTestDependencies();
  using _consumed = stub(
    deps.dbActions,
    "consumeAuthState",
    () => Promise.resolve(stateBinding),
  );
  using _token = stub(
    deps.rso,
    "exchangeCodeForTokens",
    () => Promise.reject(new RsoProviderError("token", 503)),
  );
  const response = await createApp(deps).request(
    "/auth/rso/callback?code=secret-code&state=state-1",
  );
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    code: "RIOT_API_UNAVAILABLE",
    message: "Riot API request failed",
  });
});

test("canonical repositoryが失敗すると、500で応答し成功ページを返さない", async () => {
  const deps = createTestDependencies();
  using _consumed = stub(
    deps.dbActions,
    "consumeAuthState",
    () => Promise.resolve(stateBinding),
  );
  using _token = stub(
    deps.rso,
    "exchangeCodeForTokens",
    () => Promise.resolve({ accessToken: "access-token", idToken: undefined }),
  );
  using _account = stub(
    deps.rso,
    "getAccount",
    () => Promise.resolve({ puuid: "p", gameName: "name", tagLine: "tag" }),
  );
  using _save = stub(
    deps.dbActions,
    "upsertRiotAccount",
    () => Promise.reject(new Error("database failure")),
  );
  const response = await createApp(deps).request(
    "/auth/rso/callback?code=x&state=state-1",
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
});
