import { assertEquals } from "@std/assert";
import {
  type ApiErrorCode,
  type Client,
  DEFAULT_API_ERROR_MESSAGE,
  type ResponseContract,
} from "@adteemo/api/contract";
import type { ApiResponse } from "./transport.ts";

export function response(body: unknown, status = 200): ApiResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers(),
    json: () => Promise.resolve(body),
  };
}
export function apiError(
  code: ApiErrorCode,
  message = DEFAULT_API_ERROR_MESSAGE[code] as string,
) {
  return { code, message };
}
export function invalidJsonResponse(status = 502) {
  return {
    ok: false,
    status,
    statusText: "",
    headers: new Headers(),
    json: () => Promise.reject(new SyntaxError("Unexpected token <")),
  };
}

export function createRpcClientStub(
  expectations: {
    contract: ResponseContract;
    result: ApiResponse | Error;
    args?: unknown[];
  }[],
) {
  const pending = [...expectations];
  const calls: { method: string; path: string; args: unknown[] }[] = [];
  const unexpected: string[] = [];
  function build(parts: string[]): unknown {
    return new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (!prop.startsWith("$")) return build([...parts, prop]);
        return (...args: unknown[]) => {
          const method = prop.slice(1).toUpperCase(),
            path = `/${parts.join("/")}`;
          calls.push({ method: prop, path, args });
          const index = pending.findIndex(({ contract }) =>
            contract.method === method && contract.path === path
          );
          if (index < 0) {
            unexpected.push(`${method} ${path}`);
            return Promise.reject(
              new Error(`Unexpected RPC call: ${method} ${path}`),
            );
          }
          const [expected] = pending.splice(index, 1);
          if (expected.args) assertEquals(args, expected.args);
          return expected.result instanceof Error
            ? Promise.reject(expected.result)
            : Promise.resolve(expected.result);
        };
      },
    });
  }
  return {
    calls,
    rpcClient: build([]) as Client,
    [Symbol.dispose]() {
      assertEquals(unexpected, [], "Unexpected RPC calls");
      assertEquals(
        pending.map(({ contract }) => `${contract.method} ${contract.path}`),
        [],
        "Unconsumed RPC responses",
      );
    },
  };
}
