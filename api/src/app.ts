import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";

const app = new Hono()
  .use("*", logger())
  .get("/health", (c) => {
    return c.json({ ok: true, message: "This API is healthy!" });
  })
  .route("/users", usersRoutes)
  .route("/events", eventsRoutes);

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
