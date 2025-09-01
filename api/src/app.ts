import { Hono } from "hono";
import { logger } from "hono/logger";

import { usersRoutes } from "./routes/users.ts";
export const app = new Hono()
  .use("*", logger())
  .get("/health", (c) => {
    return c.json({ ok: true, message: "Healthy" });
  })
  .route("/users", usersRoutes);
