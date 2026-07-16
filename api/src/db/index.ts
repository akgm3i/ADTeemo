import { drizzle } from "drizzle-orm/libsql";
import type { Logger as DrizzleLogger } from "drizzle-orm/logger";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";
import type { StructuredLogger } from "../../../lib/logger/mod.ts";

type EnvReader = {
  get(name: string): string | undefined;
};

export type CreateDbOptions = {
  url: string;
  logger?: Pick<StructuredLogger, "debug"> | false;
  queryLogging?: boolean;
};

export function isDbQueryLoggingEnabled(env: EnvReader = Deno.env): boolean {
  return env.get("DB_QUERY_LOG") === "1";
}

export function createDbQueryLogger(
  logger: Pick<StructuredLogger, "debug">,
): DrizzleLogger {
  return {
    logQuery(query: string, _params: unknown[]): void {
      logger.debug("db.query", { sql: query });
    },
  };
}

export function createDb(
  { url, logger = false, queryLogging = false }: CreateDbOptions,
) {
  const client = createClient({ url });
  const drizzleLogger = queryLogging && logger
    ? createDbQueryLogger(logger)
    : false;
  const db = drizzle(client, { schema, logger: drizzleLogger });

  return {
    client,
    db,
    close: () => client.close(),
  };
}

export type DatabaseConnection = ReturnType<typeof createDb>;
export type Database = DatabaseConnection["db"];
