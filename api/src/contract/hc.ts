import { hc } from "@hono/hono/client";
import type { AppType } from "./app.ts";

export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);
