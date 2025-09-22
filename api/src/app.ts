import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";
import { matchesRoutes } from "./routes/matches.ts";
import { authRoutes } from "./routes/auth.ts";

const app = new Hono()
  .use("*", logger())
  .onError((err, c) => {
    console.error(`[Error] ${c.req.method} ${c.req.url}:`, err);
    return c.json({ success: false, error: "Internal Server Error" }, 500);
  })
  .get("/health", (c) => {
    return c.json({ ok: true, message: "This API is healthy!" });
  })
  .route("/users", usersRoutes)
  .route("/events", eventsRoutes)
  .route("/matches", matchesRoutes)
  .route("/auth", authRoutes);

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
