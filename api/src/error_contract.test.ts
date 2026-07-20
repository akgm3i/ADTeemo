import { assertEquals, assertFalse, assertMatch } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "./app.ts";
import {
  API_ERROR_STATUS_BY_CODE,
  type ApiErrorCode,
  apiErrorResponseSchema,
  type ApiErrorStatus,
} from "./contract/errors.ts";
import { MatchWatcherLimitError } from "./errors.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "./test_utils.ts";

type ExpectedApiError = {
  status: ApiErrorStatus;
  code: ApiErrorCode;
  message: string;
};

async function assertApiError(
  response: Response,
  expected: ExpectedApiError,
) {
  assertEquals(response.status, expected.status);
  assertMatch(
    response.headers.get("content-type") ?? "",
    /^application\/json(?:;|$)/,
  );

  const body = apiErrorResponseSchema.parse(await response.json());
  assertEquals(response.status, API_ERROR_STATUS_BY_CODE[body.code]);
  assertEquals(body.code, expected.code);
  assertEquals(body.message, expected.message);
  assertFalse("success" in body);
  assertFalse("error" in body);
  return body;
}

describe("API error contract", () => {
  test("malformed JSONでリクエストすると、内部詳細を含まない共通JSON形式の400を返す", async () => {
    const app = createApp(createTestDependencies());

    const response = await app.request("/events", {
      method: "POST",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "Content-Type": "application/json",
      },
      body: "{",
    });

    await assertApiError(response, {
      status: 400,
      code: "INVALID_JSON",
      message: "Request body must be valid JSON",
    });
  });

  test("schemaに一致しないJSONでリクエストすると、安全なissueだけを含む共通JSON形式の422を返す", async () => {
    const app = createApp(createTestDependencies());

    const response = await app.request("/events", {
      method: "POST",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const body = await assertApiError(response, {
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
    });
    const details = body.details as {
      issues?: Array<Record<string, unknown>>;
    };
    assertEquals(Array.isArray(details.issues), true);
    assertEquals((details.issues?.length ?? 0) > 0, true);
    for (const issue of details.issues ?? []) {
      assertEquals(Object.keys(issue).sort(), ["code", "path"]);
    }
  });

  test("resource未登録、domain競合、認証失敗、route不一致を共通JSON形式へ変換する", async () => {
    const deps = createTestDependencies({
      dbActions: {
        getEventStartingTodayByCreatorId: () => Promise.resolve(undefined),
        upsertMatchWatcher: () =>
          Promise.reject(
            new MatchWatcherLimitError("private guild id: guild-1"),
          ),
      },
    });
    const app = createApp(deps);
    const cases: Array<{
      name: string;
      request: () => Response | Promise<Response>;
      expected: ExpectedApiError;
    }> = [
      {
        name: "resource未登録",
        request: () =>
          app.request("/events/today/by-creator/user-1", {
            headers: TEST_BOT_SERVICE_AUTH_HEADERS,
          }),
        expected: {
          status: 404,
          code: "EVENT_NOT_FOUND",
          message: "Event not found",
        },
      },
      {
        name: "domain競合",
        request: () =>
          app.request("/match-watchers", {
            method: "POST",
            headers: {
              ...TEST_BOT_SERVICE_AUTH_HEADERS,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              guildId: "guild-1",
              targetDiscordId: "target-1",
              requesterId: "requester-1",
              channelId: "channel-1",
            }),
          }),
        expected: {
          status: 409,
          code: "MATCH_WATCHER_LIMIT_REACHED",
          message: "Match watcher limit reached",
        },
      },
      {
        name: "認証失敗",
        request: () => app.request("/events/by-creator/user-1"),
        expected: {
          status: 401,
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      },
      {
        name: "route不一致",
        request: () =>
          app.request("/unknown", {
            headers: TEST_BOT_SERVICE_AUTH_HEADERS,
          }),
        expected: {
          status: 404,
          code: "ROUTE_NOT_FOUND",
          message: "Route not found",
        },
      },
    ];

    for (const { name, request, expected } of cases) {
      await assertApiError(await request(), expected).catch((error) => {
        throw new Error(name, { cause: error });
      });
    }
  });

  test("repositoryの未処理例外が発生すると、SQLやcredentialを含まない共通JSON形式の500を返す", async () => {
    const privateDetail =
      "SQL SELECT * FROM users WHERE token=private-credential";
    const deps = createTestDependencies({
      dbActions: {
        getCustomGameEventsByCreatorId: () =>
          Promise.reject(new Error(privateDetail)),
      },
    });
    const app = createApp(deps);

    const response = await app.request("/events/by-creator/user-1", {
      headers: TEST_BOT_SERVICE_AUTH_HEADERS,
    });
    const responseText = await response.clone().text();

    await assertApiError(response, {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    assertFalse(responseText.includes(privateDetail));
  });

  test("Riot API例外が発生すると、元例外をremote_apiとして記録し、公開用の安定した502を返す", async () => {
    const cause = new Error("provider body with private credential");
    const deps = createTestDependencies({
      riotApi: {
        getActiveGameByPuuid: () => Promise.reject(cause),
      },
    });
    using errorStub = stub(deps.logger, "error", () => {});
    const app = createApp(deps);

    const response = await app.request(
      "/riot/active-games/jp1/private-puuid",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );
    const responseText = await response.clone().text();

    await assertApiError(response, {
      status: 502,
      code: "RIOT_API_UNAVAILABLE",
      message: "Riot API request failed",
    });
    assertFalse(responseText.includes(cause.message));
    assertSpyCalls(errorStub, 1);
    assertEquals(errorStub.calls[0].args[1]?.errorCategory, "remote_api");
    assertEquals(errorStub.calls[0].args[2], cause);
  });

  test("Riot ID連携中にRiot API例外が発生すると、remote_apiとして記録し、公開用の安定した502を返す", async () => {
    const cause = new Error("provider body with private credential");
    const deps = createTestDependencies({
      riotApi: {
        getAccountByRiotId: () => Promise.reject(cause),
      },
    });
    using errorStub = stub(deps.logger, "error", () => {});
    const app = createApp(deps);

    const response = await app.request("/users/link-by-riot-id", {
      method: "PATCH",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        discordId: "discord-1",
        gameName: "Teemo",
        tagLine: "JP1",
      }),
    });
    const responseText = await response.clone().text();

    await assertApiError(response, {
      status: 502,
      code: "RIOT_API_UNAVAILABLE",
      message: "Riot API request failed",
    });
    assertFalse(responseText.includes(cause.message));
    assertSpyCalls(errorStub, 1);
    assertEquals(errorStub.calls[0].args[1]?.errorCategory, "remote_api");
    assertEquals(errorStub.calls[0].args[2], cause);
  });

  test("match watcher検査のrepository例外が発生すると、元例外をrepositoryとして記録し、安全な500を返す", async () => {
    const cause = new Error("SQL with private parameters");
    const deps = createTestDependencies({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.reject(cause),
      },
    });
    using errorStub = stub(deps.logger, "error", () => {});
    const app = createApp(deps);

    const response = await app.request(
      "/match-watchers/guild-1/target-1/tracking/active-game",
      {
        method: "POST",
        headers: {
          ...TEST_BOT_SERVICE_AUTH_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ lastState: "IDLE", currentGameId: null }),
      },
    );
    const responseText = await response.clone().text();

    await assertApiError(response, {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    assertFalse(responseText.includes(cause.message));
    assertSpyCalls(errorStub, 1);
    assertEquals(errorStub.calls[0].args[1]?.errorCategory, "repository");
    assertEquals(errorStub.calls[0].args[2], cause);
  });
});
