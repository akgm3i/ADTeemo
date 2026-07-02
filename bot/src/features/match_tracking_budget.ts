export type RiotRequestBudgetMonitorConfig = {
  pollIntervalMs: number;
  riotLongWindowLimit: number;
  riotLongWindowMs: number;
};

export type RiotRequestBudgetMonitorDependencies = {
  config: () => RiotRequestBudgetMonitorConfig;
  clock: {
    now: () => Date;
  };
  logger: {
    warn: (message: string, metadata: Record<string, unknown>) => void;
  };
};

export function createRiotRequestBudgetMonitor(
  dependencies: RiotRequestBudgetMonitorDependencies,
) {
  let lastBudgetWarningAt: number | undefined;

  function warnIfRiotRequestBudgetRisk(watcherCount: number) {
    const config = dependencies.config();
    const estimatedRequests = watcherCount *
      Math.ceil(config.riotLongWindowMs / config.pollIntervalMs);
    const now = dependencies.clock.now().getTime();
    if (
      estimatedRequests >= config.riotLongWindowLimit * 0.8 &&
      (lastBudgetWarningAt === undefined ||
        now - lastBudgetWarningAt >= config.riotLongWindowMs)
    ) {
      lastBudgetWarningAt = now;
      dependencies.logger.warn("match_tracking.riot_request_budget_risk", {
        watcherCount,
        pollIntervalMs: config.pollIntervalMs,
        rateLimitWindowMs: config.riotLongWindowMs,
        estimatedRequestsPerWindow: estimatedRequests,
        limitPerWindow: config.riotLongWindowLimit,
      });
    }
  }

  return {
    warnIfRiotRequestBudgetRisk,
  };
}
