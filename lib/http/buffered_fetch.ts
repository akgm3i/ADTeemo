/**
 * JSON HTTP adapters consume the entire body before returning, so one deadline
 * covers both response headers and body. Abort the actual fetch on expiry;
 * clearing a Promise.race alone would leave its work running in the background.
 */
export function createBufferedFetch({
  timeoutMs,
  fetch: fetcher = (...args) => globalThis.fetch(...args),
}: {
  timeoutMs: number;
  fetch?: typeof fetch;
}): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal ??
      (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort(upstreamSignal?.reason);
    upstreamSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException("HTTP request deadline exceeded", "TimeoutError"),
      );
    }, timeoutMs);
    try {
      upstreamSignal?.throwIfAborted();
      const response = await fetcher(input, {
        ...init,
        signal: controller.signal,
      });
      const body = response.body === null ? null : await response.arrayBuffer();
      controller.signal.throwIfAborted();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abort);
    }
  };
}
