import { assert, assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import { riotAccounts, users } from "../../api/src/db/schema.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";
import { strictFake } from "../../bot/src/features/testing/strict_fake.ts";
import type { RiotRegion } from "@adteemo/api/contract";

type Account = { puuid: string; gameName: string; tagLine: string };
const original: Account = {
  puuid: "canonical-puuid",
  gameName: "Teemo",
  tagLine: "NA1",
};
function strictOAuth(accounts: Account[]) {
  const token = strictFake<
    [string],
    Promise<{ accessToken: string; idToken: string }>
  >(
    "OAuth token exchange",
    accounts.map((_, index) => ({
      args: [`code-${index + 1}`],
      value: Promise.resolve({
        accessToken: `access-${index + 1}`,
        idToken: "opaque-sub-is-not-a-puuid",
      }),
    })),
  );
  const account = strictFake<[string, RiotRegion], Promise<Account>>(
    "Account-v1 accounts/me",
    accounts.map((value, index) => ({
      args: [`access-${index + 1}`, "americas"],
      value: Promise.resolve(value),
    })),
  );
  return {
    rso: {
      getAuthorizationUrl: (state: string) =>
        `https://auth.example.test/authorize?state=${state}`,
      exchangeCodeForTokens: token.invoke,
      getAccount: account.invoke,
    },
    [Symbol.dispose]() {
      try {
        token[Symbol.dispose]();
      } finally {
        account[Symbol.dispose]();
      }
    },
  };
}
async function loginState(
  app: ReturnType<typeof createApp>,
  discordId = "user-1",
) {
  const login = await createInProcessBotApiClient(app).getLoginUrl(
    discordId,
    "guild-1",
    "na1",
    "americas",
  );
  assert(login.success);
  return new URL(login.url).searchParams.get("state")!;
}
function callback(
  app: ReturnType<typeof createApp>,
  state: string,
  code = "code-1",
) {
  return app.request(`/auth/rso/callback?code=${code}&state=${state}`);
}

test("OAuth再連携でRiot IDが改名されても、canonical PUUIDの同一行を更新しBotがmain accountを参照できる", async () => {
  await using database = await createMigratedTestDatabase();
  using oauth = strictOAuth([original, {
    ...original,
    gameName: "Renamed",
    tagLine: "NEW",
  }]);
  const app = createApp(
    createTestDependencies({ dbActions: database.actions, rso: oauth.rso }),
  );
  const state = await loginState(app);
  const binding = await database.actions.getAuthState(state);
  assertEquals([
    binding?.discordId,
    binding?.guildId,
    binding?.platform,
    binding?.region,
  ], ["user-1", "guild-1", "na1", "americas"]);
  assertEquals((await callback(app, state)).status, 200);
  assertEquals(
    (await callback(app, await loginState(app), "code-2")).status,
    200,
  );
  const result = await createInProcessBotApiClient(app).getRiotAccount(
    "user-1",
  );
  assert(result.success);
  assertEquals([
    result.account.puuid,
    result.account.gameName,
    result.account.tagLine,
    result.account.platform,
    result.account.region,
    result.account.isMain,
  ], ["canonical-puuid", "Renamed", "NEW", "na1", "americas", true]);
  assertEquals((await database.db.select().from(riotAccounts)).length, 1);
  assertEquals((await database.db.select().from(users))[0].riotId, null);
});

test("同じstateのcallbackが競合・再送されても、OAuth交換とcanonical保存は一回だけ行う", async () => {
  await using database = await createMigratedTestDatabase();
  using oauth = strictOAuth([original]);
  const app = createApp(
    createTestDependencies({ dbActions: database.actions, rso: oauth.rso }),
  );
  const state = await loginState(app);
  const responses = await Promise.all([
    callback(app, state),
    callback(app, state),
  ]);
  assertEquals(responses.map(({ status }) => status).sort(), [200, 400]);
  assertEquals((await callback(app, state)).status, 400);
  assertEquals(await database.actions.getAuthState(state), undefined);
  assertEquals((await database.db.select().from(riotAccounts)).length, 1);
});

test("stateが期限切れまたは不一致なら、OAuthを呼ばず400を返し再利用も拒否する", async () => {
  await using database = await createMigratedTestDatabase();
  using oauth = strictOAuth([]);
  const app = createApp(
    createTestDependencies({ dbActions: database.actions, rso: oauth.rso }),
  );
  const state = await loginState(app);
  await database.client.execute({
    sql: "UPDATE auth_states SET created_at = created_at - 301 WHERE state = ?",
    args: [state],
  });
  assertEquals((await callback(app, state)).status, 400);
  assertEquals((await callback(app, "unknown-state")).status, 400);
  assertEquals(await database.actions.getAuthState(state), undefined);
  assertEquals(await database.db.select().from(riotAccounts), []);
});

test("別Discord userが登録済みPUUIDを連携しようとすると、409で所有者を変更せずstateを消費する", async () => {
  await using database = await createMigratedTestDatabase();
  using oauth = strictOAuth([original, original]);
  const app = createApp(
    createTestDependencies({ dbActions: database.actions, rso: oauth.rso }),
  );
  assertEquals((await callback(app, await loginState(app))).status, 200);
  const foreignState = await loginState(app, "other-user");
  const denied = await callback(app, foreignState, "code-2");
  assertEquals(denied.status, 409);
  assertEquals(await denied.json(), { code: "CONFLICT", message: "Conflict" });
  const rows = await database.db.select().from(riotAccounts);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].discordId, "user-1");
  assertEquals(await database.actions.getAuthState(foreignState), undefined);
});

test("canonical account INSERTが失敗すると、callbackは成功表示せずstate消費とDB rollbackを保つ", async () => {
  await using database = await createMigratedTestDatabase();
  using oauth = strictOAuth([original]);
  const app = createApp(
    createTestDependencies({ dbActions: database.actions, rso: oauth.rso }),
  );
  await database.client.execute(
    "CREATE TRIGGER reject_rso_account BEFORE INSERT ON riot_accounts BEGIN SELECT RAISE(ABORT, 'injected account failure'); END",
  );
  const state = await loginState(app);
  const result = await callback(app, state);
  assertEquals(result.status, 500);
  assertEquals(await result.json(), {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
  assertEquals(await database.db.select().from(riotAccounts), []);
  assertEquals(await database.actions.getAuthState(state), undefined);
});
