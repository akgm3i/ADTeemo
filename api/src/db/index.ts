import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type CreateDbOptions = {
  url: string;
  logger?: boolean;
};

export function createDb({ url, logger = true }: CreateDbOptions) {
  const client = createClient({ url });
  const db = drizzle(client, { schema, logger });

  return {
    client,
    db,
    close: () => client.close(),
  };
}

export type DatabaseConnection = ReturnType<typeof createDb>;
export type Database = DatabaseConnection["db"];
