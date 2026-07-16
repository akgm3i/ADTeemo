import { apiLogger } from "../logger.ts";
import { createDb, isDbQueryLoggingEnabled } from "./index.ts";

function defaultDatabaseUrl() {
  const url = Deno.env.get("DATABASE_URL");
  return url || "file:./data/sqlite.db";
}

export const dbConnection = createDb({
  url: defaultDatabaseUrl(),
  logger: apiLogger,
  queryLogging: isDbQueryLoggingEnabled(),
});
export const db = dbConnection.db;
