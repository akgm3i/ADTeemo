import type { app } from "./app.ts";
import { hc } from "jsr:@hono/hono/client";

// assign the client to a variable to calculate the type when compiling
const client = hc<typeof app>("");
export type Client = typeof client;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<typeof app>(...args);
