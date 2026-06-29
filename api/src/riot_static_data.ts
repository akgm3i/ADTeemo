import { z } from "zod";
import type { DbActions } from "./db/actions.ts";

const DEFAULT_STATIC_DATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_DRAGON_VERSIONS_URL =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const DATA_DRAGON_CDN_BASE = "https://ddragon.leagueoflegends.com/cdn";
const RIOT_STATIC_DOCS_BASE = "https://static.developer.riotgames.com/docs/lol";

const versionsSchema = z.array(z.string()).min(1);
const championDataSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      key: z.string(),
      name: z.string(),
      image: z.object({
        full: z.string(),
      }).optional(),
    }).passthrough(),
  ),
}).passthrough();
const queuesSchema = z.array(
  z.object({
    queueId: z.number(),
    description: z.string().nullable().optional(),
  }).passthrough(),
);
const mapsSchema = z.array(
  z.object({
    mapId: z.number(),
    mapName: z.string().nullable().optional(),
  }).passthrough(),
);
const gameModesSchema = z.array(
  z.object({
    gameMode: z.string(),
    description: z.string().nullable().optional(),
  }).passthrough(),
);

const jaQueueNames: Record<number, string> = {
  400: "ノーマルドラフト",
  420: "ランクソロ/デュオ",
  430: "ノーマルブラインド",
  440: "ランクフレックス",
  450: "ARAM",
};

const jaMapNames: Record<number, string> = {
  11: "サモナーズリフト",
  12: "ハウリングアビス",
};

const jaGameModeNames: Record<string, string> = {
  ARAM: "ARAM",
  CLASSIC: "クラシック",
};

export type RiotStaticDataResolveInput = {
  locale?: string;
  championIds?: number[];
  queueIds?: number[];
  mapIds?: number[];
  gameModes?: string[];
};

export type RiotStaticDataResolveResult = {
  champions: Record<
    string,
    { name: string | null; iconUrl: string | null }
  >;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};

type EnvReader = {
  get(key: string): string | undefined;
};

type Logger = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

type RiotStaticDataDbActions = Pick<
  DbActions,
  "getRiotStaticDataCache" | "upsertRiotStaticDataCache"
>;

export type RiotStaticDataServiceDependencies = {
  dbActions: RiotStaticDataDbActions;
  env: EnvReader;
  fetchJson: (url: string) => Promise<unknown>;
  logger: Logger;
};

export type RiotStaticDataService = {
  getChampionNameById(
    championId: number,
    locale?: string,
  ): Promise<string | null>;
  getChampionIconUrlById(
    championId: number,
    locale?: string,
  ): Promise<string | null>;
  getQueueNameById(queueId: number, locale?: string): Promise<string | null>;
  getMapNameById(mapId: number, locale?: string): Promise<string | null>;
  getGameModeName(gameMode: string, locale?: string): Promise<string | null>;
  resolve(
    input: RiotStaticDataResolveInput,
  ): Promise<RiotStaticDataResolveResult>;
};

function numberEnv(env: EnvReader, name: string, fallback: number) {
  const value = Number(env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cacheTtlMs(env: EnvReader) {
  return numberEnv(
    env,
    "RIOT_STATIC_DATA_CACHE_TTL_MS",
    DEFAULT_STATIC_DATA_CACHE_TTL_MS,
  );
}

function normalizeLocale(env: EnvReader, locale?: string) {
  const raw = locale ?? env.get("BOT_MESSAGE_LANG") ??
    env.get("API_MESSAGE_LANG") ?? "ja_JP";
  return raw.replace("-", "_").split(".")[0];
}

function localizedQueueName(env: EnvReader, queueId: number, locale?: string) {
  if (normalizeLocale(env, locale) === "ja_JP") {
    return jaQueueNames[queueId] ?? null;
  }
  return null;
}

function localizedMapName(env: EnvReader, mapId: number, locale?: string) {
  if (normalizeLocale(env, locale) === "ja_JP") {
    return jaMapNames[mapId] ?? null;
  }
  return null;
}

function localizedGameModeName(
  env: EnvReader,
  gameMode: string,
  locale?: string,
) {
  if (normalizeLocale(env, locale) === "ja_JP") {
    return jaGameModeNames[gameMode] ?? null;
  }
  return null;
}

function isFresh(env: EnvReader, updatedAt: Date, now = Date.now()) {
  return now - updatedAt.getTime() < cacheTtlMs(env);
}

export async function fetchRiotStaticDataJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Failed to fetch Riot static data: ${res.status}`);
  }
  return await res.json();
}

function parseCachedValue<T>(value: string, schema: z.ZodType<T>) {
  return schema.parse(JSON.parse(value));
}

const stringRecordSchema: z.ZodType<Record<string, string>> = z.record(
  z.string(),
  z.string(),
);
const championCacheSchema = z.record(
  z.string(),
  z.object({
    name: z.string(),
    imageFull: z.string().nullable(),
  }),
);

async function cachedVersionedJson<T>(
  deps: RiotStaticDataServiceDependencies,
  key: string,
  schema: z.ZodType<T>,
  fetcher: () => Promise<{ version: string; value: T }>,
) {
  const cached = await deps.dbActions.getRiotStaticDataCache(key);
  if (cached && isFresh(deps.env, cached.updatedAt)) {
    return {
      version: cached.version,
      value: parseCachedValue(cached.value, schema),
    };
  }

  try {
    const fetched = await fetcher();
    await deps.dbActions.upsertRiotStaticDataCache({
      key,
      version: fetched.version,
      value: JSON.stringify(fetched.value),
    });
    return fetched;
  } catch (error) {
    if (cached) {
      deps.logger.warn("riot_static_data.cache_refresh_failed", {
        key,
        version: cached.version,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        version: cached.version,
        value: parseCachedValue(cached.value, schema),
      };
    }
    throw error;
  }
}

async function cachedJson<T>(
  deps: RiotStaticDataServiceDependencies,
  key: string,
  schema: z.ZodType<T>,
  fetcher: () => Promise<{ version: string; value: T }>,
) {
  return (await cachedVersionedJson(deps, key, schema, fetcher)).value;
}

async function getLatestDataDragonVersion(
  deps: RiotStaticDataServiceDependencies,
) {
  const versions = versionsSchema.parse(
    await deps.fetchJson(DATA_DRAGON_VERSIONS_URL),
  );
  return versions[0];
}

async function getChampions(
  deps: RiotStaticDataServiceDependencies,
  locale?: string,
) {
  const normalizedLocale = normalizeLocale(deps.env, locale);
  return await cachedVersionedJson(
    deps,
    `champions-data:${normalizedLocale}`,
    championCacheSchema,
    async () => {
      const version = await getLatestDataDragonVersion(deps);
      const data = championDataSchema.parse(
        await deps.fetchJson(
          `${DATA_DRAGON_CDN_BASE}/${version}/data/${normalizedLocale}/champion.json`,
        ),
      );
      const champions: Record<
        string,
        { name: string; imageFull: string | null }
      > = {};
      for (const champion of Object.values(data.data)) {
        champions[champion.key] = {
          name: champion.name,
          imageFull: champion.image?.full ?? null,
        };
      }
      return { version, value: champions };
    },
  );
}

async function getQueues(deps: RiotStaticDataServiceDependencies) {
  return await cachedJson(deps, "queues", stringRecordSchema, async () => {
    const queues = queuesSchema.parse(
      await deps.fetchJson(`${RIOT_STATIC_DOCS_BASE}/queues.json`),
    );
    const names: Record<string, string> = {};
    for (const queue of queues) {
      if (queue.description) {
        names[String(queue.queueId)] = queue.description;
      }
    }
    return { version: "static.developer.riotgames.com", value: names };
  });
}

async function getMaps(deps: RiotStaticDataServiceDependencies) {
  return await cachedJson(deps, "maps", stringRecordSchema, async () => {
    const maps = mapsSchema.parse(
      await deps.fetchJson(`${RIOT_STATIC_DOCS_BASE}/maps.json`),
    );
    const names: Record<string, string> = {};
    for (const map of maps) {
      if (map.mapName) {
        names[String(map.mapId)] = map.mapName;
      }
    }
    return { version: "static.developer.riotgames.com", value: names };
  });
}

async function getGameModes(deps: RiotStaticDataServiceDependencies) {
  return await cachedJson(deps, "gameModes", stringRecordSchema, async () => {
    const gameModes = gameModesSchema.parse(
      await deps.fetchJson(`${RIOT_STATIC_DOCS_BASE}/gameModes.json`),
    );
    const names: Record<string, string> = {};
    for (const mode of gameModes) {
      if (mode.description) {
        names[mode.gameMode] = mode.description;
      }
    }
    return { version: "static.developer.riotgames.com", value: names };
  });
}

async function getChampionNameById(
  deps: RiotStaticDataServiceDependencies,
  championId: number,
  locale?: string,
) {
  const { value: champions } = await getChampions(deps, locale);
  return champions[String(championId)]?.name ?? null;
}

async function getChampionIconUrlById(
  deps: RiotStaticDataServiceDependencies,
  championId: number,
  locale?: string,
) {
  const { version, value: champions } = await getChampions(deps, locale);
  const file = champions[String(championId)]?.imageFull;
  return file
    ? `${DATA_DRAGON_CDN_BASE}/${version}/img/champion/${file}`
    : null;
}

async function getQueueNameById(
  deps: RiotStaticDataServiceDependencies,
  queueId: number,
  locale?: string,
) {
  const localizedName = localizedQueueName(deps.env, queueId, locale);
  if (localizedName) return localizedName;

  const names = await getQueues(deps);
  return names[String(queueId)] ?? null;
}

async function getMapNameById(
  deps: RiotStaticDataServiceDependencies,
  mapId: number,
  locale?: string,
) {
  const localizedName = localizedMapName(deps.env, mapId, locale);
  if (localizedName) return localizedName;

  const names = await getMaps(deps);
  return names[String(mapId)] ?? null;
}

async function getGameModeName(
  deps: RiotStaticDataServiceDependencies,
  gameMode: string,
  locale?: string,
) {
  const localizedName = localizedGameModeName(deps.env, gameMode, locale);
  if (localizedName) return localizedName;

  const names = await getGameModes(deps);
  return names[gameMode] ?? null;
}

function unique<T>(values: T[] | undefined) {
  return [...new Set(values ?? [])];
}

async function resolveResource<T>(
  deps: RiotStaticDataServiceDependencies,
  resource: string,
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    deps.logger.warn(`riot_static_data.resolve_${resource}_failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolve(
  deps: RiotStaticDataServiceDependencies,
  input: RiotStaticDataResolveInput,
): Promise<RiotStaticDataResolveResult> {
  const championIds = unique(input.championIds);
  const queueIds = unique(input.queueIds);
  const mapIds = unique(input.mapIds);
  const gameModes = unique(input.gameModes);

  const needsQueues = queueIds.some((queueId) =>
    localizedQueueName(deps.env, queueId, input.locale) === null
  );
  const needsMaps = mapIds.some((mapId) =>
    localizedMapName(deps.env, mapId, input.locale) === null
  );
  const needsGameModes = gameModes.some((gameMode) =>
    localizedGameModeName(deps.env, gameMode, input.locale) === null
  );

  const [championData, queueNames, mapNames, gameModeNames] = await Promise.all(
    [
      championIds.length > 0
        ? resolveResource(
          deps,
          "champions",
          () => getChampions(deps, input.locale),
        )
        : Promise.resolve(null),
      needsQueues
        ? resolveResource(deps, "queues", () => getQueues(deps))
        : Promise.resolve(null),
      needsMaps
        ? resolveResource(deps, "maps", () => getMaps(deps))
        : Promise.resolve(null),
      needsGameModes
        ? resolveResource(deps, "game_modes", () => getGameModes(deps))
        : Promise.resolve(null),
    ],
  );

  const champions: RiotStaticDataResolveResult["champions"] = {};
  for (const championId of championIds) {
    const champion = championData?.value[String(championId)];
    champions[String(championId)] = {
      name: champion?.name ?? null,
      iconUrl: champion?.imageFull && championData
        ? `${DATA_DRAGON_CDN_BASE}/${championData.version}/img/champion/${champion.imageFull}`
        : null,
    };
  }

  const queues: RiotStaticDataResolveResult["queues"] = {};
  for (const queueId of queueIds) {
    queues[String(queueId)] = localizedQueueName(
      deps.env,
      queueId,
      input.locale,
    ) ??
      queueNames?.[String(queueId)] ?? null;
  }

  const maps: RiotStaticDataResolveResult["maps"] = {};
  for (const mapId of mapIds) {
    maps[String(mapId)] = localizedMapName(deps.env, mapId, input.locale) ??
      mapNames?.[String(mapId)] ?? null;
  }

  const resolvedGameModes: RiotStaticDataResolveResult["gameModes"] = {};
  for (const gameMode of gameModes) {
    resolvedGameModes[gameMode] = localizedGameModeName(
      deps.env,
      gameMode,
      input.locale,
    ) ?? gameModeNames?.[gameMode] ?? null;
  }

  return {
    champions,
    queues,
    maps,
    gameModes: resolvedGameModes,
  };
}

export function createRiotStaticData(
  deps: RiotStaticDataServiceDependencies,
): RiotStaticDataService {
  return {
    getChampionNameById: (championId, locale) =>
      getChampionNameById(deps, championId, locale),
    getChampionIconUrlById: (championId, locale) =>
      getChampionIconUrlById(deps, championId, locale),
    getQueueNameById: (queueId, locale) =>
      getQueueNameById(deps, queueId, locale),
    getMapNameById: (mapId, locale) => getMapNameById(deps, mapId, locale),
    getGameModeName: (gameMode, locale) =>
      getGameModeName(deps, gameMode, locale),
    resolve: (input) => resolve(deps, input),
  };
}
