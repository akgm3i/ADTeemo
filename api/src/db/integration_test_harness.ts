import { migrate } from "drizzle-orm/libsql/migrator";
import { toFileUrl } from "@std/path";
import {
  createDbActions,
  type DbActions,
  type DbActionsConfig,
} from "./actions.ts";
import { createDb, type DatabaseConnection } from "./index.ts";

export const migrationsFolder = decodeURIComponent(
  new URL("../../../drizzle", import.meta.url).pathname,
);

export type MigratedTestDatabase =
  & Pick<
    DatabaseConnection,
    "client" | "db"
  >
  & {
    actions: DbActions;
    databasePath: string;
    dispose: () => Promise<void>;
    [Symbol.asyncDispose]: () => Promise<void>;
  };

export async function createMigratedTestDatabase(
  config: Partial<DbActionsConfig> = {},
): Promise<MigratedTestDatabase> {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "adteemo-repository-test-",
  });
  const databasePath = `${temporaryDirectory}/database.sqlite`;
  const connection = createDb({
    url: toFileUrl(databasePath).href,
    logger: false,
  });
  let disposed = false;

  const dispose = async () => {
    if (disposed) return;
    disposed = true;

    try {
      connection.close();
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  };

  try {
    await migrate(connection.db, { migrationsFolder });
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    client: connection.client,
    db: connection.db,
    actions: createDbActions(connection.db, config),
    databasePath,
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}
