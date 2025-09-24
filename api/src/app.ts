import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { createMiddleware } from "@hono/hono/factory";
import { usersRoutes } from "./routes/users.ts";
import { eventsRoutes } from "./routes/events.ts";
import { matchesRoutes } from "./routes/matches.ts";
import { authRoutes } from "./routes/auth.ts";
import {
  formatMessage as defaultFormatMessage,
  messageKeys as defaultMessageKeys,
} from "./messages.ts";

// Type definition for the application's environment and context variables
export type Env = {
  Variables: {
    formatMessage: typeof defaultFormatMessage;
    messageKeys: typeof defaultMessageKeys;
  };
};

// DI middleware to inject dependencies into the context
export const createDiMiddleware = (
  formatMessage: typeof defaultFormatMessage,
  messageKeys: typeof defaultMessageKeys,
) =>
  createMiddleware<Env>(async (c, next) => {
    c.set("formatMessage", formatMessage);
    c.set("messageKeys", messageKeys);
    await next();
  });

export const createApp = (
  // Optional dependencies for testin
  formatMessage = defaultFormatMessage,
  messageKeys = defaultMessageKeys,
) => {
  const diMiddleware = createDiMiddleware(
    formatMessage,
    messageKeys,
  );

  const app = new Hono<Env>()
    .use("*", logger())
    .use("*", diMiddleware)
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

  return app;
};

const app = createApp();

export default app satisfies Deno.ServeDefaultExport;
export type AppType = typeof app;
