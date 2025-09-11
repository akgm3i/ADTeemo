import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

const url = Deno.env.get("DATABASE_URL");
if (!url) {
  // Fallback for local development if DATABASE_URL is not set
  console.log(
    "DATABASE_URL not set, falling back to local file './data/sqlite.db'",
  );
}

const client = createClient({
  url: url || "file:./data/sqlite.db",
});

export const db = drizzle(client, { schema, logger: true });
