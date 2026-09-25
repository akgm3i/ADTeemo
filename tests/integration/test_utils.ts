import { hcWithType } from "@adteemo/api/contract";
import type { createApp } from "../../api/src/app.ts";
import { TEST_BOT_SERVICE_AUTH_HEADERS } from "../../api/src/test_utils.ts";
import { createApiClient } from "../../bot/src/api_client.ts";

export function createInProcessBotApiClient(
  app: ReturnType<typeof createApp>,
  transformResponse?: (response: Response, request: Request) => Response,
) {
  const rpcClient = hcWithType("http://adteemo.integration.test", {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const response = await app.fetch(request);
      return transformResponse
        ? transformResponse(response, request)
        : response;
    },
  });
  return createApiClient({ rpcClient });
}
