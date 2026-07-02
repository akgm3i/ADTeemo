import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createRiotRequestBudgetMonitor } from "./match_tracking_budget.ts";

describe("match_tracking_budget.ts", () => {
  test("watcher数の見積もりがlong window上限の8割以上になったとき、固定時刻で警告する", () => {
    const warnings: Record<string, unknown>[] = [];
    const monitor = createRiotRequestBudgetMonitor({
      config: () => ({
        pollIntervalMs: 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      }),
      clock: {
        now: () => new Date("2026-01-01T00:00:00Z"),
      },
      logger: {
        warn: (_message, metadata) => warnings.push(metadata),
      },
    });

    monitor.warnIfRiotRequestBudgetRisk(40);

    assertEquals(warnings, [{
      watcherCount: 40,
      pollIntervalMs: 60_000,
      rateLimitWindowMs: 120_000,
      estimatedRequestsPerWindow: 80,
      limitPerWindow: 100,
    }]);
  });

  test("long window内で警告済みのとき、同じinstanceでは再警告しない", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const warnings: string[] = [];
    const monitor = createRiotRequestBudgetMonitor({
      config: () => ({
        pollIntervalMs: 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      }),
      clock: {
        now: () => now,
      },
      logger: {
        warn: (message) => warnings.push(message),
      },
    });

    monitor.warnIfRiotRequestBudgetRisk(40);
    now = new Date("2026-01-01T00:01:00Z");
    monitor.warnIfRiotRequestBudgetRisk(40);

    assertEquals(warnings, ["match_tracking.riot_request_budget_risk"]);
  });

  test("long window経過後に警告条件が続くとき、同じinstanceで再警告する", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const warnings: string[] = [];
    const monitor = createRiotRequestBudgetMonitor({
      config: () => ({
        pollIntervalMs: 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      }),
      clock: {
        now: () => now,
      },
      logger: {
        warn: (message) => warnings.push(message),
      },
    });

    monitor.warnIfRiotRequestBudgetRisk(40);
    now = new Date("2026-01-01T00:02:00Z");
    monitor.warnIfRiotRequestBudgetRisk(40);

    assertEquals(warnings, [
      "match_tracking.riot_request_budget_risk",
      "match_tracking.riot_request_budget_risk",
    ]);
  });
});
