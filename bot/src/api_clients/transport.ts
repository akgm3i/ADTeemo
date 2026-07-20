import {
  API_ERROR_STATUS_BY_CODE,
  type ApiErrorCode,
  apiErrorResponseSchema,
  type ApiErrorStatus,
  type ApiErrorStatusPair,
  type ApiErrorWithStatus,
  type Client,
} from "@adteemo/api/contract";
import { botLogger } from "../logger.ts";

export const COMMUNICATION_ERROR = "Failed to communicate with API";
const FAILURE_LOGGED = Symbol("failure-logged");

export type ApiRpcClient = Client;
type FailureBase = {
  success: false;
  error: string;
  [FAILURE_LOGGED]?: true;
};
export type HttpFailureResult = FailureBase & ApiErrorStatusPair;
export type FailureResult =
  | HttpFailureResult
  | FailureBase & {
    code?: never;
    status?: never;
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

export type ParsedApiError = ApiErrorWithStatus;

export async function readApiError(
  res: ApiResponse,
): Promise<ParsedApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Invalid API error response for HTTP ${res.status}`);
  }

  const parsed = apiErrorResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid API error response for HTTP ${res.status}`);
  }

  const status = API_ERROR_STATUS_BY_CODE[parsed.data.code];
  if (res.status !== status) {
    throw new Error(`API error status/code mismatch for HTTP ${res.status}`);
  }
  return { ...parsed.data, status } as ParsedApiError;
}

export async function failureFromResponse(
  res: ApiResponse,
): Promise<HttpFailureResult> {
  const error = await readApiError(res);
  return {
    success: false,
    error: error.message,
    code: error.code,
    status: error.status,
  } as HttpFailureResult;
}

export class ApiResponseError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;

  constructor(error: ParsedApiError) {
    super(error.message);
    this.name = "ApiResponseError";
    this.code = error.code;
    this.status = error.status;
  }
}

export async function throwApiResponseError(
  res: ApiResponse,
): Promise<never> {
  throw new ApiResponseError(await readApiError(res));
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
      return await failureFromResponse(res);
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
