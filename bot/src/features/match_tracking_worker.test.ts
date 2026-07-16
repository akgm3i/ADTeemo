import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createMatchTrackingWorker } from "./match_tracking.ts";

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

async function flushMicrotasks(count = 10) {
  for (let index = 0; index < count; index++) {
    await Promise.resolve();
  }
}

describe("match_tracking worker", () => {
  test("startしたとき、初回tickを即時実行しpoll間隔で次tickを登録する", async () => {
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

    worker.start();
    await flushMicrotasks();
    manualScheduler.tick();
    await flushMicrotasks();

    assertEquals(manualScheduler.intervals, [12_345]);
    assertEquals(calls, ["process", "process"]);
  });

  test("startを重複して呼んだとき、新しいintervalと初回tickを追加しない", async () => {
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

    worker.start();
    worker.start();
    await flushMicrotasks();

    assertEquals(serviceCount, 1);
    assertEquals(manualScheduler.intervals, [60_000]);
    assertEquals(calls, ["process"]);
  });

  test("前tickが処理中のとき、次tickをskipして警告する", async () => {
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

    worker.start();
    await flushMicrotasks();
    manualScheduler.tick();
    await flushMicrotasks();
    firstTick.resolve();
    await flushMicrotasks();

    assertEquals(calls, ["process"]);
    assertEquals(warnings, ["match_tracking.worker_tick_skipped"]);
  });

  test("tick処理が例外で失敗したとき、errorログを出して次tickを継続できる", async () => {
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

    worker.start();
    await flushMicrotasks();
    manualScheduler.tick();
    await flushMicrotasks();

    assertEquals(calls, ["process", "process"]);
    assertEquals(errors[0].message, "match_tracking.worker_tick_failed");
    assertEquals(errors[0].metadata.correlationId, serviceCorrelationIds[0]);
    assertEquals(errors[0].metadata.errorCategory, "unexpected");
    assertEquals(errors[0].error, failure);
  });

  test("stopしたとき、登録済みintervalを解除する", () => {
    const manualScheduler = createManualScheduler();
    const worker = createMatchTrackingWorker({
      createService: () => ({
        processMatchWatchers: () => Promise.resolve(),
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

    worker.start();
    worker.stop();

    assertEquals(manualScheduler.cleared, [1]);
  });
});
