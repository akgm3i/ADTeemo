import { createDb } from "./index.ts";

function defaultDatabaseUrl() {
  const url = Deno.env.get("DATABASE_URL");
  return url || "file:./data/sqlite.db";
}

export const dbConnection = createDb({ url: defaultDatabaseUrl() });
export const db = dbConnection.db;
