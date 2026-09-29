import { assertEquals, assertExists } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { createApiClient, createApiRpcClients } from "../api_client.ts";
import { COMMUNICATION_ERROR, failureKind } from "./transport.ts";

const REQUEST_TIMEOUT_MS = 120_000;

function clientWithFetch(fetcher: typeof fetch) {
  const clients = createApiRpcClients({
    apiUrl: "https://backend.example",
    credential: "test-service-token-00000000000000000000000000",
    fetch: fetcher,
  });
  return createApiClient({
    rpcClient: clients.botServiceRpcClient,
    publicRpcClient: clients.publicRpcClient,
  });
}

describe("Bot RPC HTTP deadline", () => {
  for (const stalledAt of ["headers", "body"] as const) {
    test(`${stalledAt}で応答が止まったとき、期限でHTTPをabortし通信失敗として終了する`, async () => {
      // Arrange
      using time = new FakeTime(0);
      let signal: AbortSignal | null | undefined;
      const client = clientWithFetch((_input, init) => {
        signal = init?.signal;
        if (stalledAt === "headers") {
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal?.reason), {
              once: true,
            });
          });
        }
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"watchers":['));
                signal?.addEventListener(
                  "abort",
                  () => controller.error(signal?.reason),
                  { once: true },
                );
              },
            }),
          ),
        );
      });

      // Act
      const request = client.getEnabledMatchWatchers();
      await time.tickAsync(REQUEST_TIMEOUT_MS);

      // Assert
      assertExists(signal);
      assertEquals(signal.aborted, true);
      const result = await request;
      assertEquals(result, { success: false, error: COMMUNICATION_ERROR });
      if (!result.success) assertEquals(failureKind(result), "communication");
    });
  }

  test("本文まで正常に読み終えたとき、timerを解除しpublic/serviceの認証境界を保持する", async () => {
    // Arrange
    using time = new FakeTime(0);
    const requests: RequestInit[] = [];
    const client = clientWithFetch((input, init) => {
      requests.push(init ?? {});
      return Promise.resolve(
        String(input).endsWith("/health")
          ? Response.json({ message: "ok" })
          : new Response(null, { status: 204 }),
      );
    });

    // Act
    const health = await client.checkHealth();
    const mutation = await client.setMainRole("user", "guild", "Top");
    await time.tickAsync(REQUEST_TIMEOUT_MS);

    // Assert
    assertEquals(health, { success: true, message: "ok" });
    assertEquals(mutation.success, true);
    assertEquals(requests.length, 2);
    for (const request of requests) {
      assertExists(request.signal);
      assertEquals(request.signal.aborted, false);
    }
    assertEquals(new Headers(requests[0].headers).has("Authorization"), false);
    assertEquals(new Headers(requests[1].headers).has("Authorization"), true);
  });
});
