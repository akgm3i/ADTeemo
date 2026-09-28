import { assertEquals, assertFalse, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  createRiotApi,
  defaultSleeper,
  RiotApiRequestError,
} from "./riot_api.ts";

const activeGame = {
  gameId: 12345,
  gameType: "MATCHED_GAME",
  gameStartTime: 1_700_000_000_000,
  mapId: 11,
  gameMode: "CLASSIC",
  participants: [{ championId: 17, teamId: 100 }],
};

function createApi(
  fetch: typeof globalThis.fetch,
  warn: (event: string, context?: Record<string, unknown>) => void,
) {
  return createRiotApi({
    fetch,
    clock: { now: () => 1_700_000_000_000 },
    sleeper: defaultSleeper,
    env: {
      get: (key) => key === "RIOT_API_KEY" ? "private-api-key" : undefined,
    },
    logger: { warn },
  });
}

describe("Riot応答検証の診断", () => {
  for (
    const scenario of [
      { reason: "parse", body: "private-response-body", issues: undefined },
      {
        reason: "schema",
        body: JSON.stringify({
          ...activeGame,
          participants: [{ championId: "private-response-body", teamId: 100 }],
        }),
        issues: [{
          issueCode: "invalid_type",
          path: ["participants", 0, "championId"],
        }],
      },
    ] as const
  ) {
    test(`${scenario.reason}失敗では安全な診断情報を残し、次の正常な試合取得は続行できる`, async () => {
      // Arrange
      const warnings: unknown[] = [];
      let fetches = 0;
      const api = createApi(
        () =>
          Promise.resolve(
            new Response(
              fetches++ === 0 ? scenario.body : JSON.stringify(activeGame),
            ),
          ),
        (event, context) => warnings.push({ event, context }),
      );

      // Act
      const error = await assertRejects(
        () => api.getActiveGameByPuuid("jp1", "private-puuid"),
        RiotApiRequestError,
      );
      const nextGame = await api.getActiveGameByPuuid("jp1", "private-puuid");

      // Assert
      assertEquals(error.reason, scenario.reason);
      assertEquals(nextGame?.gameId, 12345);
      assertEquals(fetches, 2);
      assertEquals(warnings, [{
        event: "riot_api.invalid_response",
        context: {
          methodKey:
            "jp1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/:puuid",
          reason: scenario.reason,
          status: 200,
          ...(scenario.issues ? { issues: scenario.issues } : {}),
        },
      }]);
      assertFalse(JSON.stringify(warnings).includes("private-"));
    });
  }

  test("診断loggerが失敗しても、Riot応答の検証失敗を別の例外に変えない", async () => {
    // Arrange
    const api = createApi(
      () => Promise.resolve(new Response("invalid JSON")),
      () => {
        throw new Error("sink failed");
      },
    );

    // Act
    const error = await assertRejects(
      () => api.getActiveGameByPuuid("jp1", "private-puuid"),
      RiotApiRequestError,
    );

    // Assert
    assertEquals(error.reason, "parse");
  });
});
