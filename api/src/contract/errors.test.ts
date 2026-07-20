import { assertEquals, assertFalse } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { API_ERROR_STATUS_BY_CODE, apiErrorResponseSchema } from "./errors.ts";

describe("API error schema", () => {
  test("公開codeをstatusへ一意に対応付ける", () => {
    assertEquals(API_ERROR_STATUS_BY_CODE, {
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
    });
  });

  test("codeとmessage、安全なvalidation detailsだけを受理する", () => {
    assertEquals(
      apiErrorResponseSchema.parse({
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: {
          issues: [{ code: "invalid_type", path: ["name", 0] }],
        },
      }),
      {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: {
          issues: [{ code: "invalid_type", path: ["name", 0] }],
        },
      },
    );
  });

  test("success、旧error、非validation detailsなど契約外のfieldを拒否する", () => {
    for (
      const body of [
        { code: "INTERNAL_ERROR", message: "safe", success: false },
        { code: "INTERNAL_ERROR", message: "safe", error: "unsafe" },
        {
          code: "INTERNAL_ERROR",
          message: "safe",
          details: { issues: [] },
        },
        {
          code: "VALIDATION_ERROR",
          message: "safe",
          details: {
            issues: [{ code: "invalid_type", path: ["name"], message: "raw" }],
          },
        },
      ]
    ) {
      assertFalse(apiErrorResponseSchema.safeParse(body).success);
    }
  });
});
