import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { createMatchTrackingWorker } from "./match_tracking.ts";
import { createMatchTrackingService } from "./match_tracking_service.ts";
import {
  BOT_API_REQUEST_TIMEOUT_MS,
  createApiClient,
  createApiRpcClients,
} from "../api_client.ts";
import {
  account,
  trackingNow,
  watcher,
} from "./testing/match_tracking_fixtures.ts";

function createManualScheduler() {
  const callbacks = new Map<number, () => void>();
  const intervals: number[] = [];
  const cleared: number[] = [];
  let nextId = 1;

  return {
    intervals,
    cleared,
    scheduler: {
      setInterval: (callback: () => void, intervalMs: number) => {
        const id = nextId++;
        callbacks.set(id, callback);
        intervals.push(intervalMs);
        return id;
      },
      clearInterval: (id: number) => {
        cleared.push(id);
        callbacks.delete(id);
      },
    },
    tick: (id = 1) => callbacks.get(id)?.(),
  };
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("match_tracking worker", () => {
  test("startしたとき、初回tickを即時実行しpoll間隔で次tickを登録する", async () => {
    // Arrange
    using time = new FakeTime();
    const manualScheduler = createManualScheduler();
    const calls: string[] = [];
    const worker = createMatchTrackingWorker({
      createService: () => ({
        processMatchWatchers: () => {
          calls.push("process");
          return Promise.resolve();
        },
      }),
      scheduler: manualScheduler.scheduler,
      config: {
        pollIntervalMs: 12_345,
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    // Act
    worker.start();
    await time.runMicrotasks();
    manualScheduler.tick();
    await time.runMicrotasks();

    // Assert
    assertEquals(manualScheduler.intervals, [12_345]);
    assertEquals(calls, ["process", "process"]);
  });

  test("startを重複して呼んだとき、新しいintervalと初回tickを追加しない", async () => {
    // Arrange
    using time = new FakeTime();
    const manualScheduler = createManualScheduler();
    let serviceCount = 0;
    const calls: string[] = [];
    const worker = createMatchTrackingWorker({
      createService: () => {
        serviceCount += 1;
        return {
          processMatchWatchers: () => {
            calls.push("process");
            return Promise.resolve();
          },
        };
      },
      scheduler: manualScheduler.scheduler,
      config: {
        pollIntervalMs: 60_000,
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    // Act
    worker.start();
    worker.start();
    await time.runMicrotasks();

    // Assert
    assertEquals(serviceCount, 1);
    assertEquals(manualScheduler.intervals, [60_000]);
    assertEquals(calls, ["process"]);
  });

  test("前tickが処理中のとき、次tickをskipして警告する", async () => {
    // Arrange
    using time = new FakeTime();
    const manualScheduler = createManualScheduler();
    const firstTick = deferred();
    const calls: string[] = [];
    const warnings: string[] = [];
    const worker = createMatchTrackingWorker({
      createService: () => ({
        processMatchWatchers: () => {
          calls.push("process");
          return firstTick.promise;
        },
      }),
      scheduler: manualScheduler.scheduler,
      config: {
        pollIntervalMs: 60_000,
      },
      logger: {
        warn: (message) => warnings.push(message),
        error: () => {},
      },
    });

    // Act
    worker.start();
    await time.runMicrotasks();
    manualScheduler.tick();
    await time.runMicrotasks();
    firstTick.resolve();
    await time.runMicrotasks();

    // Assert
    assertEquals(calls, ["process"]);
    assertEquals(warnings, ["match_tracking.worker_tick_skipped"]);
  });

  test("tick処理が例外で失敗したとき、errorログを出して次tickを継続できる", async () => {
    // Arrange
    using time = new FakeTime();
    const manualScheduler = createManualScheduler();
    const calls: string[] = [];
    const errors: {
      message: string;
      metadata: Record<string, unknown>;
      error: unknown;
    }[] = [];
    const failure = new Error("temporary failure");
    const serviceCorrelationIds: string[] = [];
    const worker = createMatchTrackingWorker({
      createService: () => ({
        setCorrelationId: (correlationId) => {
          serviceCorrelationIds.push(correlationId);
        },
        processMatchWatchers: () => {
          calls.push("process");
          if (calls.length === 1) {
            return Promise.reject(failure);
          }
          return Promise.resolve();
        },
      }),
      scheduler: manualScheduler.scheduler,
      config: {
        pollIntervalMs: 60_000,
      },
      logger: {
        warn: () => {},
        error: (message, metadata, error) => {
          errors.push({ message, metadata, error });
        },
      },
    });

    // Act
    worker.start();
    await time.runMicrotasks();
    manualScheduler.tick();
    await time.runMicrotasks();

    // Assert
    assertEquals(calls, ["process", "process"]);
    assertEquals(errors[0].message, "match_tracking.worker_tick_failed");
    assertEquals(errors[0].metadata.correlationId, serviceCorrelationIds[0]);
    assertEquals(errors[0].metadata.errorCategory, "unexpected");
    assertEquals(errors[0].error, failure);
  });

  test("stopしたとき、登録済みintervalを解除して次tickを実行しない", async () => {
    // Arrange
    using time = new FakeTime();
    const manualScheduler = createManualScheduler();
    let calls = 0;
    const worker = createMatchTrackingWorker({
      createService: () => ({
        processMatchWatchers: () => {
          calls += 1;
          return Promise.resolve();
        },
      }),
      scheduler: manualScheduler.scheduler,
      config: {
        pollIntervalMs: 60_000,
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    // Act
    worker.start();
    await time.runMicrotasks();
    worker.stop();
    manualScheduler.tick();
    await time.runMicrotasks();

    // Assert
    assertEquals(manualScheduler.cleared, [1]);
    assertEquals(calls, 1);
  });
});

for (const stalledAt of ["headers", "body"] as const) {
  test(`watcherのHTTP ${stalledAt}が停止しても、abort後に次watcherと次tickを排他的に処理する`, async () => {
    // Arrange
    using time = new FakeTime(trackingNow);
    const scheduler = createManualScheduler();
    const inspections: string[] = [];
    const warnings: string[] = [];
    let listRequests = 0;
    let aborted = false;
    let unexpectedEffects = 0;
    const unexpected = () => {
      unexpectedEffects++;
      throw new Error("Unexpected notification");
    };
    const rpc = createApiRpcClients({
      apiUrl: "https://backend.example",
      credential: "test-service-token-00000000000000000000000000",
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/match-watchers/enabled") {
          listRequests++;
          return Promise.resolve(Response.json({
            watchers: [
              watcher(),
              watcher({
                targetDiscordId: "target-2",
                riotAccountPuuid: "puuid-2",
              }),
            ],
          }));
        }
        const target = path.split("/")[3];
        inspections.push(target);
        if (inspections.length === 1) {
          const signal = init?.signal;
          if (stalledAt === "headers") {
            return new Promise<Response>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                aborted = true;
                reject(signal.reason);
              }, { once: true });
            });
          }
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  signal?.addEventListener("abort", () => {
                    aborted = true;
                    controller.error(signal.reason);
                  }, { once: true });
                },
              }),
            ),
          );
        }
        return Promise.resolve(Response.json({
          account: account({
            discordId: target,
            puuid: target === "target-1" ? "puuid-1" : "puuid-2",
          }),
          activeGame: null,
        }));
      },
    });
    const service = createMatchTrackingService({
      apiClient: createApiClient({ rpcClient: rpc.botServiceRpcClient }),
      notifier: { sendOrEditWatcherMessage: unexpected },
      renderer: {
        activeGame: unexpected,
        resultPending: unexpected,
        resultUnavailable: unexpected,
        matchResult: unexpected,
      },
      clock: { now: () => new Date(time.now) },
      logger: { warn: () => {}, error: () => {} },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10_800_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });
    const tickCompleted = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    let ticks = 0;
    const worker = createMatchTrackingWorker({
      createService: () => ({
        async processMatchWatchers() {
          const tick = ticks++;
          try {
            await service.processMatchWatchers();
          } finally {
            tickCompleted[tick].resolve();
          }
        },
      }),
      scheduler: scheduler.scheduler,
      config: { pollIntervalMs: 60_000 },
      logger: { warn: (message) => warnings.push(message), error: () => {} },
    });

    // Act / Assert
    worker.start();
    await time.runMicrotasks();
    scheduler.tick();
    await time.runMicrotasks();
    assertEquals(inspections, ["target-1"]);
    assertEquals(listRequests, 1);
    assertEquals(warnings, ["match_tracking.worker_tick_skipped"]);

    await time.tickAsync(BOT_API_REQUEST_TIMEOUT_MS);
    assertEquals(aborted, true);
    await tickCompleted[0].promise;
    await time.runMicrotasks();
    assertEquals(inspections, ["target-1", "target-2"]);
    scheduler.tick();
    await tickCompleted[1].promise;
    await time.runMicrotasks();
    worker.stop();

    assertEquals(inspections, ["target-1", "target-2", "target-1", "target-2"]);
    assertEquals(listRequests, 2);
    assertEquals(unexpectedEffects, 0);
  });
}
