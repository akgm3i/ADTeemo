import { z } from "zod";

export const apiErrorCodes = [
  "INVALID_JSON",
  "INVALID_REQUEST",
  "OPGG_PARTICIPANT_MISMATCH",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "ROUTE_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "EVENT_NOT_FOUND",
  "RIOT_ACCOUNT_NOT_FOUND",
  "CONFLICT",
  "MATCH_WATCHER_LIMIT_REACHED",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "RIOT_API_UNAVAILABLE",
  "RIOT_STATIC_DATA_UNAVAILABLE",
] as const;

export type ApiErrorCode = typeof apiErrorCodes[number];

export const API_ERROR_STATUS_BY_CODE = {
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  OPGG_PARTICIPANT_MISMATCH: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ROUTE_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  RIOT_ACCOUNT_NOT_FOUND: 404,
  CONFLICT: 409,
  MATCH_WATCHER_LIMIT_REACHED: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  RIOT_API_UNAVAILABLE: 502,
  RIOT_STATIC_DATA_UNAVAILABLE: 502,
} as const satisfies Record<ApiErrorCode, number>;

export type ApiErrorStatus = typeof API_ERROR_STATUS_BY_CODE[ApiErrorCode];

export type NonValidationApiErrorCode = Exclude<
  ApiErrorCode,
  "VALIDATION_ERROR"
>;

export type ApiErrorResponse =
  | {
    code: "VALIDATION_ERROR";
    message: string;
    details?: ApiErrorDetails;
  }
  | {
    code: NonValidationApiErrorCode;
    message: string;
    details?: never;
  };

export type ApiErrorStatusPair = {
  [C in ApiErrorCode]: {
    code: C;
    status: typeof API_ERROR_STATUS_BY_CODE[C];
  };
}[ApiErrorCode];

export type ApiErrorWithStatus = {
  [C in ApiErrorCode]:
    & {
      code: C;
      message: string;
      status: typeof API_ERROR_STATUS_BY_CODE[C];
    }
    & (C extends "VALIDATION_ERROR" ? { details?: ApiErrorDetails }
      : { details?: never });
}[ApiErrorCode];

export const DEFAULT_API_ERROR_MESSAGE = {
  INVALID_JSON: "Request body must be valid JSON",
  INVALID_REQUEST: "Invalid request",
  OPGG_PARTICIPANT_MISMATCH: "Match participant does not match Riot account",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  ROUTE_NOT_FOUND: "Route not found",
  RESOURCE_NOT_FOUND: "Resource not found",
  EVENT_NOT_FOUND: "Event not found",
  RIOT_ACCOUNT_NOT_FOUND: "Riot account not found",
  CONFLICT: "Conflict",
  MATCH_WATCHER_LIMIT_REACHED: "Match watcher limit reached",
  VALIDATION_ERROR: "Request validation failed",
  RATE_LIMITED: "Too many requests",
  INTERNAL_ERROR: "Internal server error",
  RIOT_API_UNAVAILABLE: "Riot API request failed",
  RIOT_STATIC_DATA_UNAVAILABLE: "Failed to resolve Riot static data",
} as const satisfies Record<ApiErrorCode, string>;

export const apiValidationIssueSchema = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
}).strict();

export const apiErrorDetailsSchema = z.object({
  issues: z.array(apiValidationIssueSchema),
}).strict();

export type ApiValidationIssue = z.infer<typeof apiValidationIssueSchema>;
export type ApiErrorDetails = z.infer<typeof apiErrorDetailsSchema>;

const validationApiErrorResponseSchema = z.object({
  code: z.literal("VALIDATION_ERROR"),
  message: z.string(),
  details: apiErrorDetailsSchema.optional(),
}).strict();

const nonValidationApiErrorResponseSchema = z.object({
  code: z.enum(apiErrorCodes).exclude(["VALIDATION_ERROR"]),
  message: z.string(),
}).strict();

export const apiErrorResponseSchema: z.ZodType<ApiErrorResponse> = z.union([
  validationApiErrorResponseSchema,
  nonValidationApiErrorResponseSchema,
]);
