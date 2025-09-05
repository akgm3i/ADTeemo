import { Hono } from "jsr:@hono/hono";
import { logger } from "jsr:@hono/hono/logger";

import { usersRoutes } from "./routes/users.ts";
export const app = new Hono()
  .use("*", logger())
  .get("/health", (c) => {
    return c.json({ ok: true, message: "This API is healthy!" });
  })
  .route("/users", usersRoutes);
