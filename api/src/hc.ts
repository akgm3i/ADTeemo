import type { AppType } from "./app.ts";
import { hc } from "@hono/hono/client";

// assign the client to a variable to calculate the type when compiling
export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);
