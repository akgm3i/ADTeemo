import { createDbActions, createDbActionsConfigFromEnv } from "./actions.ts";
import { db } from "./default_connection.ts";

export const dbActions = createDbActions(db, createDbActionsConfigFromEnv());
