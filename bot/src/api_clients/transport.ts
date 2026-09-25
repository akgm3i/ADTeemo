import {
  API_ERROR_STATUS_BY_CODE,
  type ApiErrorCode,
  type ApiErrorResponse,
  apiErrorResponseSchema,
  type ApiErrorStatus,
  type ApiErrorStatusPair,
  type ApiErrorWithStatus,
  type Client,
  type ResponseContract,
} from "@adteemo/api/contract";
import { botLogger } from "../logger.ts";

export const COMMUNICATION_ERROR = "Failed to communicate with API";
export const CONTRACT_ERROR = "API response did not match contract";
const FAILURE_LOGGED = Symbol("failure-logged");
const FAILURE_KIND = Symbol("failure-kind");

export type FailureKind = "http" | "communication" | "contract" | "unknown";

export type ApiRpcClient = Client;
type FailureBase = {
  success: false;
  error: string;
  [FAILURE_LOGGED]?: true;
  [FAILURE_KIND]?: FailureKind;
  contractError?: ApiContractError;
};
export type HttpFailureResult = FailureBase & ApiErrorStatusPair;
export type FailureResult =
  | HttpFailureResult
  | FailureBase & {
    code?: never;
    status?: never;
  };
export type ApiResponse<T = unknown> = {
  headers?: Headers;
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<T>;
};

export class ApiContractError extends Error {
  readonly kind = "contract_error";
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly validationPaths: readonly string[] = [],
  ) {
    super(CONTRACT_ERROR);
    this.name = "ApiContractError";
  }
}

function safeValidationPath(path: readonly PropertyKey[]): string {
  const dynamicContainers = new Set([
    "champions",
    "queues",
    "maps",
    "gameModes",
  ]);
  let insideEmbed = false;
  return path.slice(0, 12).map((part, index) => {
    if (
      insideEmbed ||
      (index > 0 && dynamicContainers.has(String(path[index - 1])))
    ) return "<key>";
    if (part === "embed") insideEmbed = true;
    return typeof part === "number" ? "[]" : String(part).slice(0, 64);
  }).join(".");
}

export async function readContractResponse<T>(
  contract: ResponseContract<T>,
  res: ApiResponse,
): Promise<T> {
  const endpoint = `${contract.method} ${contract.path}`;
  if (!contract.statuses.includes(res.status)) {
    throw new ApiContractError(endpoint, res.status, ["status"]);
  }
  let body: unknown;
  if (res.status !== 204) {
    try {
      body = await res.json();
    } catch {
      throw new ApiContractError(endpoint, res.status, ["body"]);
    }
  }
  const parsed = contract.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiContractError(
      endpoint,
      res.status,
      parsed.error.issues.map((issue) => safeValidationPath(issue.path)).slice(
        0,
        20,
      ),
    );
  }
  // Creation and idempotent replay have distinct HTTP statuses.
  if (
    typeof parsed.data === "object" && parsed.data !== null &&
    "created" in parsed.data && parsed.data.created !== (res.status === 201)
  ) {
    throw new ApiContractError(endpoint, res.status, ["created"]);
  }
  return parsed.data;
}

export function requestResult<T extends Record<string, unknown>>(
  contract: ResponseContract<T>,
  request: () => Promise<ApiResponse>,
) {
  return resultFromRequest(
    request,
    (res) => readContractResponse(contract, res),
    undefined,
    `${contract.method} ${contract.path}`,
  );
}

function hasMatchingErrorStatus(
  error: ApiErrorResponse & { status: number },
): error is ApiErrorWithStatus {
  return API_ERROR_STATUS_BY_CODE[error.code] === error.status;
}

export type ParsedApiError = ApiErrorWithStatus;

export async function readApiError(
  res: ApiResponse,
  endpoint = "unknown",
): Promise<ParsedApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiContractError(endpoint, res.status, ["error"]);
  }

  const parsed = apiErrorResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiContractError(endpoint, res.status, ["error"]);
  }

  const error = { ...parsed.data, status: res.status };
  if (!hasMatchingErrorStatus(error)) {
    throw new ApiContractError(endpoint, res.status, ["status", "code"]);
  }
  return error;
}

export async function failureFromResponse(
  res: ApiResponse,
  endpoint = "unknown",
): Promise<HttpFailureResult> {
  const error = await readApiError(res, endpoint);
  const failure = {
    success: false as const,
    error: error.message,
    code: error.code,
    status: error.status,
  };
  if (!isHttpFailure(failure)) {
    throw new ApiContractError(endpoint, res.status, ["status", "code"]);
  }
  return markFailureKind(failure, "http");
}

function isHttpFailure(
  failure: FailureBase & { code: ApiErrorCode; status: number },
): failure is HttpFailureResult {
  return API_ERROR_STATUS_BY_CODE[failure.code] === failure.status;
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
  endpoint = "unknown",
): Promise<never> {
  throw new ApiResponseError(await readApiError(res, endpoint));
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

export function markFailureKind<T extends FailureResult>(
  failure: T,
  kind: FailureKind,
): T {
  Object.defineProperty(failure, FAILURE_KIND, {
    value: kind,
    enumerable: false,
  });
  return failure;
}

export function failureKind(value: FailureResult): FailureKind {
  return value[FAILURE_KIND] ?? ("code" in value ? "http" : "unknown");
}

function contractFailure(error: unknown): FailureResult {
  botLogger.error("api_client.contract_invalid", {
    correlationId: crypto.randomUUID(),
    errorCategory: "remote_api",
    ...(error instanceof ApiContractError
      ? {
        endpoint: error.endpoint,
        status: error.status,
        validationPaths: error.validationPaths,
      }
      : {}),
  });
  const failure: FailureResult = { success: false, error: CONTRACT_ERROR };
  if (error instanceof ApiContractError) {
    Object.defineProperty(failure, "contractError", {
      value: error,
      enumerable: false,
    });
  }
  return markFailureKind(markFailureLogged(failure), "contract");
}

export function wasFailureLogged(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    FAILURE_LOGGED in value && value[FAILURE_LOGGED] === true;
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
  endpoint = "unknown",
): Promise<({ success: true } & T) | F | FailureResult> {
  let res: ApiResponse;
  try {
    res = await request();
  } catch (error) {
    logCommunicationError(error);
    return markFailureKind(
      markFailureLogged({ success: false, error: COMMUNICATION_ERROR }),
      "communication",
    );
  }

  if (!res.ok) {
    try {
      if (handleHttpError) {
        return await handleHttpError(res);
      }
      return await failureFromResponse(res, endpoint);
    } catch (error) {
      return contractFailure(error);
    }
  }

  try {
    return { success: true, ...await parseSuccess(res) };
  } catch (error) {
    return contractFailure(error);
  }
}
