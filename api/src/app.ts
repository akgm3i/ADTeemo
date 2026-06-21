import { Hono } from "@hono/hono";
import { createMiddleware } from "@hono/hono/factory";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";
import { matchesRoutes } from "./routes/matches.ts";
import { matchWatchersRoutes } from "./routes/match_watchers.ts";
import { authRoutes } from "./routes/auth.ts";
import { riotRoutes } from "./routes/riot.ts";
import { apiLogger } from "./logger.ts";

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

const app = new Hono()
  .use("*", requestLoggingMiddleware)
  .get("/health", (c) => {
    return c.json({ message: "This API is healthy!" });
  })
  .route("/users", usersRoutes)
  .route("/events", eventsRoutes)
  .route("/matches", matchesRoutes)
  .route("/match-watchers", matchWatchersRoutes)
  .route("/riot", riotRoutes)
  .route("/auth", authRoutes);

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
