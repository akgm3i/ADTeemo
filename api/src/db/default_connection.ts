import { createDb } from "./index.ts";

function defaultDatabaseUrl() {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    // Fallback for local development if DATABASE_URL is not set
    console.log(
      "DATABASE_URL not set, falling back to local file './data/sqlite.db'",
    );
  }
  return url || "file:./data/sqlite.db";
}

export const dbConnection = createDb({ url: defaultDatabaseUrl() });
export const db = dbConnection.db;
