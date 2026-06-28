import { Hono } from "@hono/hono";
import { createMiddleware } from "@hono/hono/factory";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";
import { matchesRoutes } from "./routes/matches.ts";
import { matchWatchersRoutes } from "./routes/match_watchers.ts";
import { authRoutes } from "./routes/auth.ts";
import { riotRoutes } from "./routes/riot.ts";
import { riotStaticDataRoutes } from "./routes/riot_static_data.ts";
import { apiLogger } from "./logger.ts";
import type { AppDependencies } from "./dependencies.ts";
import { defaultDependencies } from "./default_dependencies.ts";

export const requestLoggingMiddleware = createMiddleware(async (c, next) => {
  const start = performance.now();
  try {
    await next();
    const durationMs = Math.round(performance.now() - start);
    const context = {
      http: {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
      },
      durationMs,
    };

    if (c.res.status >= 500) {
      apiLogger.error("request.failed", context);
      return;
    }

    apiLogger.info("request.completed", context);
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    apiLogger.error(
      "request.failed",
      {
        http: {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status >= 500 ? c.res.status : 500,
        },
        durationMs,
      },
      error,
    );
    throw error;
  }
});

export function createApp(deps: AppDependencies) {
  return new Hono()
    .use("*", requestLoggingMiddleware)
    .get("/health", (c) => {
      return c.json({ message: "This API is healthy!" });
    })
    .route("/users", usersRoutes(deps))
    .route("/events", eventsRoutes(deps))
    .route("/matches", matchesRoutes(deps))
    .route("/match-watchers", matchWatchersRoutes(deps))
    .route("/riot/static-data", riotStaticDataRoutes(deps))
    .route("/riot", riotRoutes(deps))
    .route("/auth", authRoutes(deps));
}

const app = createApp(defaultDependencies);

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
