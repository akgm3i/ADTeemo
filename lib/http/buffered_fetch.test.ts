import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createBufferedFetch } from "./buffered_fetch.ts";

describe("createBufferedFetch", () => {
  test("呼出元がabortしたとき、HTTP中断へ伝播しlistenerとtimerを解放する", async () => {
    // Arrange
    using time = new FakeTime(0);
    const caller = new AbortController();
    using removed = spy(caller.signal, "removeEventListener");
    let signal: AbortSignal | null | undefined;
    const fetcher = createBufferedFetch({
      timeoutMs: 100,
      fetch: (_input, init) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          });
        });
      },
    });

    // Act
    const result = fetcher("https://provider.example", {
      signal: caller.signal,
    });
    const rejected = assertRejects(() => result, DOMException, "cancelled");
    caller.abort(new DOMException("cancelled", "AbortError"));
    await rejected;
    await time.tickAsync(100);

    // Assert
    assertEquals(signal?.aborted, true);
    assertEquals(signal?.reason, caller.signal.reason);
    assertSpyCalls(removed, 1);
  });

  test("本文読了前に失敗したとき、後から期限timerが発火しない", async () => {
    // Arrange
    using time = new FakeTime(0);
    let signal: AbortSignal | null | undefined;
    const fetcher = createBufferedFetch({
      timeoutMs: 100,
      fetch: (_input, init) => {
        signal = init?.signal;
        return Promise.reject(new TypeError("Network error"));
      },
    });

    // Act
    await assertRejects(() => fetcher("https://provider.example"), TypeError);
    await time.tickAsync(100);

    // Assert
    assertEquals(signal?.aborted, false);
  });

  test("事前にabort済みのRequestを渡したとき、HTTP送信を開始しない", async () => {
    // Arrange
    using time = new FakeTime(0);
    const caller = new AbortController();
    caller.abort();
    let calls = 0;
    const fetcher = createBufferedFetch({
      timeoutMs: 100,
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json({}));
      },
    });

    // Act
    await assertRejects(() =>
      fetcher(
        new Request("https://provider.example", {
          signal: caller.signal,
        }),
      )
    );
    await time.tickAsync(100);

    // Assert
    assertEquals(calls, 0);
  });
});
