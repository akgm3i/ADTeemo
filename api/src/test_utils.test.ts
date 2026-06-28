import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createTestDependencies } from "./test_utils.ts";

describe("test_utils.ts", () => {
  test("Riot API testing helperを部分overrideするとき、未指定のtesting helperを保持する", () => {
    // Arrange
    let resetCalled = false;

    // Act
    const deps = createTestDependencies({
      riotApi: {
        __testing: {
          resetRateLimiter: () => {
            resetCalled = true;
          },
        },
      },
    });
    deps.riotApi.__testing.resetRateLimiter();

    // Assert
    assertEquals(resetCalled, true);
    assertEquals(typeof deps.riotApi.__testing.rateLimiterSnapshot, "function");
  });
});
