import type { Database } from "./index.ts";
import { createAuthRepository } from "./repositories/auth.ts";
import { createEventsRepository } from "./repositories/events.ts";
import { createGuildsRepository } from "./repositories/guilds.ts";
import { createMatchesRepository } from "./repositories/matches.ts";
import { createMatchWatchersRepository } from "./repositories/match_watchers.ts";
import { createRiotStaticDataRepository } from "./repositories/riot_static_data.ts";
import { createUsersRepository } from "./repositories/users.ts";

const DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD = 20;
const DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

export type DbActionsConfig = {
  matchWatcherMaxEnabledPerGuild: number;
  pendingRankSnapshotTtlMs: number;
};

type EnvReader = {
  get(name: string): string | undefined;
};

function numberEnv(env: EnvReader, name: string, fallback: number) {
  const value = Number(env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createDbActionsConfigFromEnv(
  env: EnvReader = Deno.env,
): DbActionsConfig {
  return {
    matchWatcherMaxEnabledPerGuild: numberEnv(
      env,
      "MATCH_WATCH_MAX_ENABLED_PER_GUILD",
      DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD,
    ),
    pendingRankSnapshotTtlMs: numberEnv(
      env,
      "PENDING_RANK_SNAPSHOT_TTL_MS",
      DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS,
    ),
  };
}

const DEFAULT_DB_ACTIONS_CONFIG: DbActionsConfig = {
  matchWatcherMaxEnabledPerGuild: DEFAULT_MATCH_WATCH_MAX_ENABLED_PER_GUILD,
  pendingRankSnapshotTtlMs: DEFAULT_PENDING_RANK_SNAPSHOT_TTL_MS,
};

export function createDbActions(
  database: Database,
  config: Partial<DbActionsConfig> = {},
) {
  const resolvedConfig = { ...DEFAULT_DB_ACTIONS_CONFIG, ...config };

  return {
    ...createUsersRepository(database),
    ...createGuildsRepository(database),
    ...createEventsRepository(database),
    ...createMatchesRepository(database, resolvedConfig),
    ...createAuthRepository(database),
    ...createRiotStaticDataRepository(database),
    ...createMatchWatchersRepository(database, resolvedConfig),
  };
}

export type DbActions = ReturnType<typeof createDbActions>;
