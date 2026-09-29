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
  const argumentFailures: unknown[] = [];
  function build(parts: string[]): unknown {
    return new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (!prop.startsWith("$")) return build([...parts, prop]);
        return (...args: unknown[]) => {
          const method = prop.slice(1).toUpperCase(),
            path = `/${parts.join("/")}`;
          calls.push({ method: prop, path, args });
          // Calls may interleave across endpoints; each method/path consumes
          // its own responses in declaration order.
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
          try {
            if (expected.args) assertEquals(args, expected.args);
          } catch (error) {
            // Like strictFake, retain assertion failures even when the SUT
            // catches them and turns them into an ordinary failure result.
            argumentFailures.push(error);
            throw error;
          }
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
      assertEquals(argumentFailures, [], "RPC argument mismatches");
      assertEquals(
        pending.map(({ contract }) => `${contract.method} ${contract.path}`),
        [],
        "Unconsumed RPC responses",
      );
    },
  };
}
