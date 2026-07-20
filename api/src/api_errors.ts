import type { Context } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { ErrorCategory } from "../../lib/logger/mod.ts";
import {
  API_ERROR_STATUS_BY_CODE,
  type ApiErrorCode,
  type ApiErrorDetails,
  type ApiErrorResponse,
  type ApiValidationIssue,
  DEFAULT_API_ERROR_MESSAGE,
} from "./contract/errors.ts";
import { recordRequestFailure } from "./request_failure.ts";

type ApiErrorCommonOptions = {
  message?: string;
  cause?: unknown;
  errorCategory?: ErrorCategory;
};

type ApiErrorResponseOptions<C extends ApiErrorCode> =
  & ApiErrorCommonOptions
  & (C extends "VALIDATION_ERROR" ? { details?: ApiErrorDetails }
    : { details?: never });

export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly publicMessage: string;
  readonly errorCategory: ErrorCategory;

  constructor(code: ApiErrorCode, options: ApiErrorCommonOptions = {}) {
    const publicMessage = options.message ?? DEFAULT_API_ERROR_MESSAGE[code];
    super(publicMessage, { cause: options.cause });
    this.name = "ApiHttpError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.errorCategory = options.errorCategory ?? "unexpected";
  }
}

export function remoteApiError(
  code: "RIOT_API_UNAVAILABLE" | "RIOT_STATIC_DATA_UNAVAILABLE",
  cause: unknown,
): ApiHttpError {
  return new ApiHttpError(code, { cause, errorCategory: "remote_api" });
}

export function repositoryApiError(cause: unknown): ApiHttpError {
  return new ApiHttpError("INTERNAL_ERROR", {
    cause,
    errorCategory: "repository",
  });
}

function responseBody<C extends ApiErrorCode>(
  code: C,
  options: ApiErrorResponseOptions<C>,
): ApiErrorResponse {
  const body = {
    code,
    message: options.message ?? DEFAULT_API_ERROR_MESSAGE[code],
  };
  if (code === "VALIDATION_ERROR" && options.details) {
    return { ...body, details: options.details } as ApiErrorResponse;
  }
  return body as ApiErrorResponse;
}

export function apiErrorResponse<C extends ApiErrorCode>(
  c: Context,
  code: C,
  options: ApiErrorResponseOptions<C> = {} as ApiErrorResponseOptions<C>,
) {
  const status = API_ERROR_STATUS_BY_CODE[code];
  if (status >= 500 && options.cause !== undefined) {
    recordRequestFailure(
      c.req.raw,
      options.cause,
      options.errorCategory ?? "unexpected",
    );
  }
  return c.json(responseBody(code, options), status);
}

function safeValidationIssues(error: unknown): ApiValidationIssue[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return [];
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue): ApiValidationIssue[] => {
    if (typeof issue !== "object" || issue === null) return [];
    const code = "code" in issue && typeof issue.code === "string"
      ? issue.code
      : "invalid_input";
    const rawPath = "path" in issue && Array.isArray(issue.path)
      ? issue.path
      : [];
    const path = rawPath.flatMap((part: unknown): Array<string | number> => {
      if (typeof part === "string" || typeof part === "number") return [part];
      return [];
    });
    return [{ code, path }];
  });
}

export function apiValidationHook(
  result: { success: boolean; error?: unknown },
  c: Context,
) {
  if (result.success) return;
  return apiErrorResponse(c, "VALIDATION_ERROR", {
    details: { issues: safeValidationIssues(result.error) },
  });
}

function httpExceptionCode(error: HTTPException): ApiErrorCode {
  switch (error.status) {
    case 400:
      return error.message === "Malformed JSON in request body"
        ? "INVALID_JSON"
        : "INVALID_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION_ERROR";
    case 429:
      return "RATE_LIMITED";
    default:
      return "INTERNAL_ERROR";
  }
}

export function handleApiError(error: Error, c: Context) {
  if (error instanceof ApiHttpError) {
    return apiErrorResponse(c, error.code, {
      message: error.publicMessage,
      cause: error.cause,
      errorCategory: error.errorCategory,
    });
  }
  if (error instanceof HTTPException && error.status < 500) {
    return apiErrorResponse(c, httpExceptionCode(error));
  }
  return apiErrorResponse(c, "INTERNAL_ERROR", { cause: error });
}
