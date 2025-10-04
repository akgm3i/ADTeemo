import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";
import { matchesRoutes } from "./routes/matches.ts";
import { authRoutes } from "./routes/auth.ts";

const app = new Hono()
  .use("*", logger())
  .get("/health", (c) => {
    return c.json({ message: "This API is healthy!" });
  })
  .route("/users", usersRoutes)
  .route("/events", eventsRoutes)
  .route("/matches", matchesRoutes)
  .route("/auth", authRoutes);

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
