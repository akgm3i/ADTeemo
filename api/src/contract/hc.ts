import { hc } from "@hono/hono/client";
import type { AppType } from "../app.ts";

const createTypedClient = (...args: Parameters<typeof hc>) =>
  hc<AppType>(...args);
export type Client = ReturnType<typeof createTypedClient>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  createTypedClient(...args);
