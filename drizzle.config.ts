import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./api/src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  verbose: true,
  strict: true,
  dbCredentials: {
    url: Deno.env.get("DATABASE_URL") || "file:./data/sqlite.db",
  },
});
