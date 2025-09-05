import { app } from "./app.ts";

export default app satisfies Deno.ServeDefaultExport;

export type AppType = typeof app;
