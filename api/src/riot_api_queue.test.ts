import {
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import {
  createRiotApi,
  defaultSleeper,
  RiotApiRequestError,
  type RiotApiSleeper,
} from "./riot_api.ts";

function accountResponse(
  gameName = "Teemo",
  headers?: HeadersInit,
): Response {
  return new Response(
    JSON.stringify({
      puuid: `puuid-${gameName}`,
      gameName,
      tagLine: "JP1",
    }),
    { status: 200, headers },
  );
}

function matchResponse(): Response {
  return new Response(
    JSON.stringify({
      metadata: {
        matchId: "JP1_12345",
        participants: ["puuid-1"],
      },
      info: {
        gameId: 12345,
        gameCreation: 1_700_000_000_000,
        gameDuration: 1800,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        mapId: 11,
        queueId: 420,
        participants: [{
          puuid: "puuid-1",
          championName: "Teemo",
          teamId: 100,
          win: true,
          kills: 10,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          goldEarned: 12345,
        }],
      },
    }),
    { status: 200 },
  );
}

function createFakeRiotApi(
  fakeFetch: typeof fetch,
  options: { now?: number; sleeper?: RiotApiSleeper } = {},
) {
  let now = options.now ?? 0;
  const sleeps: number[] = [];
  const sleeper = options.sleeper ?? ((ms: number) => {
    sleeps.push(ms);
    now += ms;
    return Promise.resolve();
  });
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const api = createRiotApi({
    fetch: fakeFetch,
    clock: { now: () => now },
    sleeper,
    env: {
      get: (key: string) => key === "RIOT_API_KEY" ? "test-key" : undefined,
    },
    logger: {
      warn: (_event: string, context?: Record<string, unknown>) => {
        warnings.push(context);
      },
    },
  });

  return {
    api,
    sleeps,
    warnings,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createRiotApi", () => {
  test("既定sleeperが完了したとき、abort listenerを解除する", async () => {
    using time = new FakeTime();
    let listener: EventListenerOrEventListenerObject | undefined;
    let removed = 0;
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener(
        _type: string,
        callback: EventListenerOrEventListenerObject,
      ) {
        listener = callback;
      },
      removeEventListener(
        _type: string,
        callback: EventListenerOrEventListenerObject,
      ) {
        if (callback === listener) removed += 1;
      },
    } as unknown as AbortSignal;

    const sleeping = defaultSleeper(1_000, signal);
    time.tick(1_000);
    await sleeping;

    assertEquals(removed, 1);
  });

  test("同時に要求するとき、process内の共有queueからFIFO順に1件ずつ実行する", async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const fetchNames: string[] = [];
    const fake = createFakeRiotApi(
      ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const name = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        fetchNames.push(name);
        return fetchNames.length === 1
          ? firstResponse.promise
          : Promise.resolve(accountResponse(name));
      }) as typeof fetch,
      {
        sleeper: () => new Promise(() => {}),
      },
    );

    const first = fake.api.getAccountByRiotId("asia", "First", "JP1");
    const second = fake.api.getAccountByRiotId("asia", "Second", "JP1");
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(fetchNames, ["First"]);

    firstResponse.resolve(accountResponse("First"));
    assertEquals((await first)?.gameName, "First");
    assertEquals((await second)?.gameName, "Second");
    assertEquals(fetchNames, ["First", "Second"]);
  });

  test("fetchが応答しないとき、各attemptを5秒で打ち切って通常は最大3回試す", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    );

    const error = await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "Teemo", "JP1"),
      RiotApiRequestError,
      "Riot API request timed out",
    );

    assertInstanceOf(error, RiotApiRequestError);
    assertEquals(error.reason, "timeout");
    assertEquals(calls, 3);
    assertEquals(fake.sleeps, [5_000, 500, 5_000, 1_000, 5_000]);
  });

  test("attempt処理がrejectしたとき、timeout sleeperを必ずabortする", async () => {
    const response = Promise.withResolvers<Response>();
    let timeoutSignal: AbortSignal | undefined;
    const fake = createFakeRiotApi(
      (() => response.promise) as typeof fetch,
      {
        sleeper: (_ms, signal) => {
          timeoutSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason),
              { once: true },
            );
          });
        },
      },
    );
    const rootCause = new Error("response inspection failed");
    const brokenResponse = new Proxy(new Response(null, { status: 200 }), {
      get(target, property) {
        if (property === "ok") throw rootCause;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const request = fake.api.getAccountByRiotId("asia", "Teemo", "JP1");
    for (let index = 0; index < 12; index++) await Promise.resolve();
    response.resolve(brokenResponse);

    await assertRejects(() => request, Error, rootCause.message);
    assertEquals(timeoutSignal?.aborted, true);
  });

  test("network errorのあと成功するとき、500ms刻みの線形backoffで再試行する", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        if (calls < 3) return Promise.reject(new TypeError("secret network"));
        return Promise.resolve(accountResponse());
      }) as typeof fetch,
    );

    const account = await fake.api.getAccountByRiotId(
      "asia",
      "Teemo",
      "JP1",
    );

    assertEquals(account?.gameName, "Teemo");
    assertEquals(calls, 3);
    assertEquals(fake.sleeps, [500, 1_000]);
  });

  test("network errorが最終attemptまで続くとき、原因の詳細を公開しない型付きerrorを返す", async () => {
    const fake = createFakeRiotApi(
      (() =>
        Promise.reject(
          new TypeError("https://secret.example/puuid-raw?api_key=secret"),
        )) as typeof fetch,
    );

    const error = await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "RawRiotId", "RawTag"),
      RiotApiRequestError,
      "Riot API network request failed",
    );

    assertInstanceOf(error, RiotApiRequestError);
    assertEquals(error.reason, "network");
    assertEquals(error.retryable, true);
    assertFalse(error.message.includes("secret.example"));
    assertFalse(error.message.includes("RawRiotId"));
  });

  test("Riot IDがURL正規化される値でも、型付きerrorへ生値を含めない", async () => {
    const fake = createFakeRiotApi(
      (() =>
        Promise.resolve(new Response(null, { status: 400 }))) as typeof fetch,
    );

    for (const gameName of ["", ".", ".."]) {
      const error = await assertRejects(
        () => fake.api.getAccountByRiotId("asia", gameName, "SecretTag"),
        RiotApiRequestError,
        "Riot API request failed: 400",
      );

      assertFalse(error.message.includes("SecretTag"));
      assertFalse(error.methodKey.includes("SecretTag"));
      assertEquals(
        error.methodKey,
        "asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/:gameName/:tagLine",
      );
    }
  });

  test("429と5xxが続くとき、残attempt内だけ再試行する", async () => {
    const statuses = [429, 503, 200];
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        const status = statuses[calls++];
        return Promise.resolve(
          status === 200 ? accountResponse() : new Response(null, {
            status,
            headers: status === 429 ? { "Retry-After": "0" } : undefined,
          }),
        );
      }) as typeof fetch,
    );

    const account = await fake.api.getAccountByRiotId(
      "asia",
      "Teemo",
      "JP1",
    );

    assertEquals(account?.gameName, "Teemo");
    assertEquals(calls, 3);
    assertEquals(fake.sleeps, [500, 1_000]);
  });

  test("5xxがRetry-Afterを返すとき、指定時間を待ってから再試行する", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response(null, {
              status: 503,
              headers: { "Retry-After": "2" },
            })
            : accountResponse(),
        );
      }) as typeof fetch,
    );

    const account = await fake.api.getAccountByRiotId(
      "asia",
      "Teemo",
      "JP1",
    );

    assertEquals(account?.gameName, "Teemo");
    assertEquals(calls, 2);
    assertEquals(fake.sleeps, [2_000]);
  });

  test("Match要求で5xxが続くとき、最大5attemptまで試す", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return Promise.resolve(
          calls < 5 ? new Response(null, { status: 503 }) : matchResponse(),
        );
      }) as typeof fetch,
    );

    const match = await fake.api.getMatchById("asia", "JP1_12345");

    assertEquals(match?.metadata.matchId, "JP1_12345");
    assertEquals(calls, 5);
    assertEquals(fake.sleeps, [500, 1_000, 1_500, 2_000]);
  });

  test("retry対象外の4xxまたはschema不正では再試行しない", async () => {
    let httpCalls = 0;
    const httpFake = createFakeRiotApi(
      (() => {
        httpCalls += 1;
        return Promise.resolve(new Response(null, { status: 400 }));
      }) as typeof fetch,
    );

    const httpError = await assertRejects(
      () => httpFake.api.getAccountByRiotId("asia", "Teemo", "JP1"),
      RiotApiRequestError,
      "Riot API request failed: 400",
    );
    assertEquals(httpError.reason, "http");
    assertEquals(httpError.status, 400);
    assertEquals(httpError.retryable, false);
    assertEquals(httpCalls, 1);
    assertEquals(httpFake.sleeps, []);

    let schemaCalls = 0;
    const schemaFake = createFakeRiotApi(
      (() => {
        schemaCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ puuid: 42 }), { status: 200 }),
        );
      }) as typeof fetch,
    );

    const schemaError = await assertRejects(
      () => schemaFake.api.getAccountByRiotId("asia", "Teemo", "JP1"),
      RiotApiRequestError,
      "Riot API response validation failed",
    );
    assertEquals(schemaError.reason, "schema");
    assertEquals(schemaCalls, 1);
    assertEquals(schemaFake.sleeps, []);

    let parseCalls = 0;
    const parseFake = createFakeRiotApi(
      (() => {
        parseCalls += 1;
        return Promise.resolve(new Response("not-json", { status: 200 }));
      }) as typeof fetch,
    );

    const parseError = await assertRejects(
      () => parseFake.api.getAccountByRiotId("asia", "Teemo", "JP1"),
      RiotApiRequestError,
      "Riot API response parsing failed",
    );
    assertEquals(parseError.reason, "parse");
    assertEquals(parseCalls, 1);
    assertEquals(parseFake.sleeps, []);
  });

  test("最終attemptの429でもRetry-Afterを後続要求のcooldownへ反映する", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      ((input: RequestInfo | URL) => {
        calls += 1;
        const hostname = new URL(String(input)).hostname;
        if (hostname.startsWith("europe.")) {
          return Promise.resolve(accountResponse("Europe"));
        }
        if (calls <= 3) {
          return Promise.resolve(
            new Response(null, {
              status: 429,
              headers: {
                "Retry-After": calls === 3 ? "10" : "0",
                "X-Rate-Limit-Type": "application",
              },
            }),
          );
        }
        return Promise.resolve(accountResponse("Asia"));
      }) as typeof fetch,
    );

    await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "Teemo", "JP1"),
      RiotApiRequestError,
      "Riot API request failed: 429",
    );
    const snapshot = fake.api.__testing.rateLimiterSnapshot();
    assertEquals(
      snapshot.appBuckets.some((bucket) =>
        bucket.key.includes("asia.api.riotgames.com") &&
        bucket.cooldownUntil === fake.now() + 10_000
      ),
      true,
    );

    const europe = await fake.api.getAccountByRiotId(
      "europe",
      "Europe",
      "EUW",
    );
    assertEquals(europe?.gameName, "Europe");

    const beforeAsia = fake.now();
    const asia = await fake.api.getAccountByRiotId(
      "asia",
      "Asia",
      "JP1",
    );
    assertEquals(asia?.gameName, "Asia");
    assertEquals(fake.now() - beforeAsia, 10_000);
  });

  test("先頭requestがscope固有cooldownを待つとき、別hostnameのrequestをqueueで遮断しない", async () => {
    const pendingSleeps: Array<{ ms: number; resolve(): void }> = [];
    const fetchedHostnames: string[] = [];
    let asiaCalls = 0;
    const fake = createFakeRiotApi(
      ((input: RequestInfo | URL) => {
        const hostname = new URL(String(input)).hostname;
        fetchedHostnames.push(hostname);
        if (hostname.startsWith("europe.")) {
          return Promise.resolve(accountResponse("Europe"));
        }
        if (new URL(String(input)).pathname.includes("/lol/match/")) {
          return Promise.resolve(matchResponse());
        }
        asiaCalls += 1;
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: {
              "Retry-After": asiaCalls === 3 ? "60" : "0",
              "X-Rate-Limit-Type": "method",
            },
          }),
        );
      }) as typeof fetch,
      {
        sleeper: (ms) => {
          if (ms < 30_000) return Promise.resolve();
          return new Promise<void>((resolve) => {
            pendingSleeps.push({ ms, resolve });
          });
        },
      },
    );

    await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "Limited", "JP1"),
      RiotApiRequestError,
      "Riot API request failed: 429",
    );

    const blockedAsia = fake.api.getAccountByRiotId(
      "asia",
      "Blocked",
      "JP1",
    );
    for (let index = 0; index < 20 && pendingSleeps.length === 0; index++) {
      await Promise.resolve();
    }
    const europe = fake.api.getAccountByRiotId(
      "europe",
      "Europe",
      "EUW",
    );
    const match = fake.api.getMatchById("asia", "JP1_12345");
    for (let index = 0; index < 20; index++) await Promise.resolve();

    const europeFetchedBeforeDeadline = fetchedHostnames.includes(
      "europe.api.riotgames.com",
    );
    fake.advance(30_000);
    for (const sleep of pendingSleeps) sleep.resolve();
    const [asiaResult, europeResult, matchResult] = await Promise.allSettled([
      blockedAsia,
      europe,
      match,
    ]);

    assertEquals(europeFetchedBeforeDeadline, true);
    assertEquals(asiaResult.status, "rejected");
    assertEquals(europeResult.status, "fulfilled");
    assertEquals(matchResult.status, "fulfilled");
    if (europeResult.status === "fulfilled") {
      assertEquals(europeResult.value?.gameName, "Europe");
    }
  });

  test("retry backoffを待つとき、後続のready requestをqueueで遮断しない", async () => {
    const pendingSleeps: Array<{ ms: number; resolve(): void }> = [];
    const fetchedNames: string[] = [];
    let retryingCalls = 0;
    const fake = createFakeRiotApi(
      ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const name = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        fetchedNames.push(name);
        if (name === "Retrying") {
          retryingCalls += 1;
          if (retryingCalls === 1) {
            return Promise.resolve(new Response(null, { status: 500 }));
          }
        }
        return Promise.resolve(accountResponse(name));
      }) as typeof fetch,
      {
        sleeper: (ms) =>
          new Promise<void>((resolve) => {
            pendingSleeps.push({ ms, resolve });
          }),
      },
    );

    const retrying = fake.api.getAccountByRiotId(
      "asia",
      "Retrying",
      "JP1",
    );
    for (
      let index = 0;
      index < 20 && !pendingSleeps.some(({ ms }) => ms === 500);
      index++
    ) {
      await Promise.resolve();
    }
    const ready = fake.api.getAccountByRiotId("europe", "Ready", "EUW");
    for (let index = 0; index < 20; index++) await Promise.resolve();

    const readyFetchedBeforeBackoff = fetchedNames.includes("Ready");
    fake.advance(500);
    pendingSleeps.find(({ ms }) => ms === 500)?.resolve();

    assertEquals(readyFetchedBeforeBackoff, true);
    assertEquals((await ready)?.gameName, "Ready");
    assertEquals((await retrying)?.gameName, "Retrying");
  });

  test("method headerなしの429 cooldownが終わると、後続の成功要求を恒久的に1件制限しない", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        if (calls <= 3) {
          return Promise.resolve(
            new Response(null, {
              status: 429,
              headers: {
                "Retry-After": calls === 3 ? "10" : "0",
                "X-Rate-Limit-Type": "method",
              },
            }),
          );
        }
        return Promise.resolve(
          accountResponse(calls === 4 ? "FirstSuccess" : "SecondSuccess"),
        );
      }) as typeof fetch,
    );

    await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "Limited", "JP1"),
      RiotApiRequestError,
      "Riot API request failed: 429",
    );
    const first = await fake.api.getAccountByRiotId(
      "asia",
      "FirstSuccess",
      "JP1",
    );
    const second = await fake.api.getAccountByRiotId(
      "asia",
      "SecondSuccess",
      "JP1",
    );

    assertEquals(first?.gameName, "FirstSuccess");
    assertEquals(second?.gameName, "SecondSuccess");
    assertEquals(calls, 5);
    assertEquals(fake.sleeps, [500, 1_000, 10_000]);
    assertEquals(fake.api.__testing.rateLimiterSnapshot().methodBuckets, []);
  });

  test("limit headerだけが返るとき、現在requestをcountして次要求をwindowまで待機する", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return Promise.resolve(accountResponse(
          calls === 1 ? "First" : "Second",
          calls === 1 ? { "X-App-Rate-Limit": "1:10" } : undefined,
        ));
      }) as typeof fetch,
    );

    await fake.api.getAccountByRiotId("asia", "First", "JP1");
    const second = await fake.api.getAccountByRiotId(
      "asia",
      "Second",
      "JP1",
    );

    assertEquals(second?.gameName, "Second");
    assertEquals(calls, 2);
    assertEquals(fake.sleeps, [10_000]);
  });

  test("timeout済みattemptの遅延responseは、queue解放後の共有bucketを変更しない", async () => {
    const delayedResponses: Array<PromiseWithResolvers<Response>> = [];
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        if (calls <= 3) {
          const response = Promise.withResolvers<Response>();
          delayedResponses.push(response);
          return response.promise;
        }
        return Promise.resolve(accountResponse("Second"));
      }) as typeof fetch,
    );

    await assertRejects(
      () => fake.api.getAccountByRiotId("asia", "First", "JP1"),
      RiotApiRequestError,
      "timed out",
    );
    assertEquals(
      (await fake.api.getAccountByRiotId("asia", "Second", "JP1"))
        ?.gameName,
      "Second",
    );

    delayedResponses[0].resolve(
      new Response(null, {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-Rate-Limit-Type": "method",
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(fake.api.__testing.rateLimiterSnapshot().methodBuckets, []);
    assertEquals(fake.warnings, []);
    assertEquals(calls, 4);
  });

  test("queue待機中に30秒deadlineを過ぎた要求は後からfetchしない", async () => {
    const firstResponse = Promise.withResolvers<Response>();
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return firstResponse.promise;
      }) as typeof fetch,
      {
        sleeper: () => new Promise(() => {}),
      },
    );

    const first = fake.api.getAccountByRiotId("asia", "First", "JP1");
    const expired = fake.api.getAccountByRiotId("asia", "Expired", "JP1");
    await Promise.resolve();
    await Promise.resolve();
    fake.advance(30_001);
    firstResponse.resolve(accountResponse("First"));

    const [firstResult, expiredResult] = await Promise.allSettled([
      first,
      expired,
    ]);

    assertEquals(firstResult.status, "rejected");
    assertEquals(expiredResult.status, "rejected");
    assertEquals(calls, 1);
  });

  test("先行要求が応答しないままでも、queue待機中の要求は30秒で失敗する", async () => {
    const sleeps: Array<{
      ms: number;
      resolve(): void;
    }> = [];
    const firstResponse = Promise.withResolvers<Response>();
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return firstResponse.promise;
      }) as typeof fetch,
      {
        sleeper: (ms, signal) =>
          new Promise<void>((resolve, reject) => {
            const abort = () =>
              reject(
                signal?.reason ?? new DOMException(
                  "Aborted",
                  "AbortError",
                ),
              );
            signal?.addEventListener("abort", abort, { once: true });
            sleeps.push({
              ms,
              resolve() {
                signal?.removeEventListener("abort", abort);
                resolve();
              },
            });
          }),
      },
    );

    const first = fake.api.getAccountByRiotId("asia", "First", "JP1");
    const expired = fake.api.getAccountByRiotId("asia", "Expired", "JP1");
    for (let index = 0; index < 20 && sleeps.length < 2; index++) {
      await Promise.resolve();
    }
    assertEquals(sleeps.map(({ ms }) => ms).sort((a, b) => a - b), [
      5_000,
      30_000,
    ]);

    fake.advance(30_000);
    sleeps.find(({ ms }) => ms === 30_000)?.resolve();
    const error = await assertRejects(
      () => expired,
      RiotApiRequestError,
      "Riot API request deadline exceeded",
    );

    assertEquals(error.reason, "deadline");
    assertEquals(calls, 1);
    void first;
  });

  test("先行要求が失敗してもqueue tailを解放して後続要求を実行する", async () => {
    let calls = 0;
    const fake = createFakeRiotApi(
      (() => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response(null, { status: 400 })
            : accountResponse("Second"),
        );
      }) as typeof fetch,
    );

    const first = fake.api.getAccountByRiotId("asia", "First", "JP1");
    const second = fake.api.getAccountByRiotId("asia", "Second", "JP1");

    await assertRejects(() => first, RiotApiRequestError);
    assertEquals((await second)?.gameName, "Second");
    assertEquals(calls, 2);
  });
});
