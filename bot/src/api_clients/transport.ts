import type { Client } from "@adteemo/api/contract";
import { botLogger } from "../logger.ts";

export const COMMUNICATION_ERROR = "Failed to communicate with API";
const FAILURE_LOGGED = Symbol("failure-logged");

export type ApiRpcClient = Client;
export type FailureResult = {
  success: false;
  error: string;
  [FAILURE_LOGGED]?: true;
};
export type ApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<T>;
};

export function dateOrNull(value: string | Date | null | undefined) {
  return value == null ? null : new Date(value);
}

export async function readErrorMessage(res: ApiResponse): Promise<string> {
  const body = await res.json() as { error?: string };
  return body.error ?? COMMUNICATION_ERROR;
}

export function logCommunicationError(error: unknown) {
  botLogger.error("api_client.communication_failed", {
    correlationId: crypto.randomUUID(),
    errorCategory: "remote_api",
  }, error);
}

export function markFailureLogged<T extends FailureResult>(failure: T): T {
  Object.defineProperty(failure, FAILURE_LOGGED, {
    value: true,
    enumerable: false,
  });
  return failure;
}

export function wasFailureLogged(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as FailureResult)[FAILURE_LOGGED] === true;
}

export function unexpectedResponseError(res: ApiResponse): Error {
  return new Error(`Unexpected response: ${res.status} ${res.statusText}`);
}

export async function resultFromRequest<
  T extends Record<string, unknown>,
  F extends FailureResult = FailureResult,
>(
  request: () => Promise<ApiResponse>,
  parseSuccess: (res: ApiResponse) => Promise<T> | T,
  handleHttpError?: (
    res: ApiResponse,
  ) => Promise<F> | F,
): Promise<({ success: true } & T) | F | FailureResult> {
  try {
    const res = await request();

    if (!res.ok) {
      if (handleHttpError) {
        return await handleHttpError(res);
      }

      throw unexpectedResponseError(res);
    }

    return { success: true, ...await parseSuccess(res) };
  } catch (error) {
    logCommunicationError(error);
    return markFailureLogged({ success: false, error: COMMUNICATION_ERROR });
  }
}

export function successOnly() {
  return {};
}
