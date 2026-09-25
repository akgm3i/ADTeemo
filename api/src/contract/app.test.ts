import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { testClient } from "@hono/hono/testing";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import { responseContracts } from "./responses.ts";
import { createApiClient } from "../../../bot/src/api_client.ts";

test("実runtime appへendpointを追加または削除すると、共有response契約との差異を検出する", () => {
  const app = createApp(createTestDependencies());
  const actual = [
    ...new Set(
      app.routes.filter(({ method, path }) =>
        method !== "ALL" && path !== "/auth/rso/callback"
      ).map(({ method, path }) => `${method} ${path.replace(/\/$/, "")}`),
    ),
  ].sort();
  const expected = Object.values(responseContracts).map(({ method, path }) =>
    `${method} ${path}`
  ).sort();
  assertEquals(actual, expected);
});

test("実Hono providerをconsumerから呼ぶと、method/path/body/queryと日時がHTTP境界を通る", async () => {
  const calls: unknown[] = [];
  const deps = createTestDependencies({
    dbActions: {
      setMainRole: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
      getCustomGameEventParticipants: (input) => {
        calls.push(input);
        return Promise.resolve([{
          eventId: 12,
          userId: "user-1",
          team: "BLUE",
          lane: "Top",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }]);
      },
      createAuthState: (_state, binding) => {
        calls.push(binding.discordId);
        return Promise.resolve();
      },
    },
    rso: { getAuthorizationUrl: () => "https://example.test/login" },
  });
  const app = createApp(deps);
  const client = createApiClient({
    rpcClient: testClient(app, {}, undefined, {
      headers: TEST_BOT_SERVICE_AUTH_HEADERS,
    }),
  });
  assertEquals(await client.checkHealth(), {
    success: true,
    message: "This API is healthy!",
  });
  assertEquals(await client.setMainRole("user-1", "guild-1", "Top"), {
    success: true,
  });
  const result = await client.getCustomGameEventParticipants(12, {
    guildId: "guild-1",
    recruitmentChannelId: "channel-1",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(
      result.participants[0].createdAt,
      new Date("2026-01-01T00:00:00.000Z"),
    );
  }
  assertEquals(await client.getLoginUrl("user-1", "guild-1"), {
    success: true,
    url: "https://example.test/login",
  });
  assertEquals(calls, [["user-1", "guild-1", "Top"], {
    eventId: 12,
    guildId: "guild-1",
    recruitmentChannelId: "channel-1",
  }, "user-1"]);
});

test("実providerの依存が不正な必須データを返すと、成功空値へ変換せず500となる", async () => {
  const app = createApp(
    createTestDependencies({
      riotApi: { getMatchById: () => Promise.resolve(undefined as never) },
    }),
  );
  const result = await app.request("/riot/matches/asia/JP1_123", {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
  });
  assertEquals(result.status, 500);
  assertEquals(await result.json(), {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
});
