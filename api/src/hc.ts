import app, { type AppType } from "./app.ts";
import { hc } from "jsr:@hono/hono/client";

// assign the client to a variable to calculate the type when compiling
export type Client = ReturnType<typeof hc<typeof app>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);
