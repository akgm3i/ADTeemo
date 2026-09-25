import {
  API_ERROR_STATUS_BY_CODE,
  apiErrorResponseSchema,
} from "./contract/errors.ts";
import { createMiddleware } from "@hono/hono/factory";
import { responseContracts } from "./contract/responses.ts";
import { ApiHttpError } from "./api_errors.ts";

// Provider and consumer validate against the same schema after HTTP serialization.
export function responseValidationMiddleware() {
  return createMiddleware(async (c, next) => {
    await next();
    if (!c.res.ok) {
      let body: unknown;
      try {
        body = await c.res.clone().json();
      } catch {
        throw new ApiHttpError("INTERNAL_ERROR");
      }
      const parsed = apiErrorResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        API_ERROR_STATUS_BY_CODE[parsed.data.code] !== c.res.status
      ) throw new ApiHttpError("INTERNAL_ERROR");
      return;
    }
    const routePath = c.req.routePath.replace(/\/$/, "");
    const contract = Object.values(responseContracts).find((contract) =>
      contract.method === c.req.method && contract.path === routePath
    );
    // The OAuth callback intentionally returns HTML and has no JSON consumer.
    if (!contract) return;
    if (!contract.statuses.includes(c.res.status)) {
      throw new ApiHttpError("INTERNAL_ERROR");
    }
    let body: unknown;
    if (c.res.status !== 204) {
      try {
        body = await c.res.clone().json();
      } catch {
        throw new ApiHttpError("INTERNAL_ERROR");
      }
    }
    const parsed = contract.schema.safeParse(body);
    if (!parsed.success) throw new ApiHttpError("INTERNAL_ERROR");
    if (
      typeof parsed.data === "object" && parsed.data !== null &&
      "created" in parsed.data && parsed.data.created !== (c.res.status === 201)
    ) {
      throw new ApiHttpError("INTERNAL_ERROR");
    }
  });
}
