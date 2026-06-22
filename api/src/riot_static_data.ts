import { z } from "zod";
import { dbActions } from "./db/actions.ts";
import { apiLogger } from "./logger.ts";

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

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cacheTtlMs() {
  return numberEnv(
    "RIOT_STATIC_DATA_CACHE_TTL_MS",
    DEFAULT_STATIC_DATA_CACHE_TTL_MS,
  );
}

function normalizeLocale(locale?: string) {
  const raw = locale ?? Deno.env.get("BOT_MESSAGE_LANG") ??
    Deno.env.get("API_MESSAGE_LANG") ?? "ja_JP";
  return raw.replace("-", "_").split(".")[0];
}

function localizedQueueName(queueId: number, locale?: string) {
  if (normalizeLocale(locale) === "ja_JP") {
    return jaQueueNames[queueId] ?? null;
  }
  return null;
}

function localizedMapName(mapId: number, locale?: string) {
  if (normalizeLocale(locale) === "ja_JP") {
    return jaMapNames[mapId] ?? null;
  }
  return null;
}

function localizedGameModeName(gameMode: string, locale?: string) {
  if (normalizeLocale(locale) === "ja_JP") {
    return jaGameModeNames[gameMode] ?? null;
  }
  return null;
}

function isFresh(updatedAt: Date, now = Date.now()) {
  return now - updatedAt.getTime() < cacheTtlMs();
}

async function fetchJson(url: string) {
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
  key: string,
  schema: z.ZodType<T>,
  fetcher: () => Promise<{ version: string; value: T }>,
) {
  const cached = await dbActions.getRiotStaticDataCache(key);
  if (cached && isFresh(cached.updatedAt)) {
    return {
      version: cached.version,
      value: parseCachedValue(cached.value, schema),
    };
  }

  try {
    const fetched = await fetcher();
    await dbActions.upsertRiotStaticDataCache({
      key,
      version: fetched.version,
      value: JSON.stringify(fetched.value),
    });
    return fetched;
  } catch (error) {
    if (cached) {
      apiLogger.warn("riot_static_data.cache_refresh_failed", {
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
  key: string,
  schema: z.ZodType<T>,
  fetcher: () => Promise<{ version: string; value: T }>,
) {
  return (await cachedVersionedJson(key, schema, fetcher)).value;
}

async function getLatestDataDragonVersion() {
  const versions = versionsSchema.parse(
    await fetchJson(DATA_DRAGON_VERSIONS_URL),
  );
  return versions[0];
}

async function getChampions(locale?: string) {
  const normalizedLocale = normalizeLocale(locale);
  return await cachedVersionedJson(
    `champions-data:${normalizedLocale}`,
    championCacheSchema,
    async () => {
      const version = await getLatestDataDragonVersion();
      const data = championDataSchema.parse(
        await fetchJson(
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

async function getQueues() {
  return await cachedJson("queues", stringRecordSchema, async () => {
    const queues = queuesSchema.parse(
      await fetchJson(`${RIOT_STATIC_DOCS_BASE}/queues.json`),
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

async function getMaps() {
  return await cachedJson("maps", stringRecordSchema, async () => {
    const maps = mapsSchema.parse(
      await fetchJson(`${RIOT_STATIC_DOCS_BASE}/maps.json`),
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

async function getGameModes() {
  return await cachedJson("gameModes", stringRecordSchema, async () => {
    const gameModes = gameModesSchema.parse(
      await fetchJson(`${RIOT_STATIC_DOCS_BASE}/gameModes.json`),
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

async function getChampionNameById(championId: number, locale?: string) {
  const { value: champions } = await getChampions(locale);
  return champions[String(championId)]?.name ?? null;
}

async function getChampionIconUrlById(championId: number, locale?: string) {
  const { version, value: champions } = await getChampions(locale);
  const file = champions[String(championId)]?.imageFull;
  return file
    ? `${DATA_DRAGON_CDN_BASE}/${version}/img/champion/${file}`
    : null;
}

async function getQueueNameById(queueId: number, locale?: string) {
  const localizedName = localizedQueueName(queueId, locale);
  if (localizedName) return localizedName;

  const names = await getQueues();
  return names[String(queueId)] ?? null;
}

async function getMapNameById(mapId: number, locale?: string) {
  const localizedName = localizedMapName(mapId, locale);
  if (localizedName) return localizedName;

  const names = await getMaps();
  return names[String(mapId)] ?? null;
}

async function getGameModeName(gameMode: string, locale?: string) {
  const localizedName = localizedGameModeName(gameMode, locale);
  if (localizedName) return localizedName;

  const names = await getGameModes();
  return names[gameMode] ?? null;
}

function unique<T>(values: T[] | undefined) {
  return [...new Set(values ?? [])];
}

async function resolve(
  input: RiotStaticDataResolveInput,
): Promise<RiotStaticDataResolveResult> {
  const championIds = unique(input.championIds);
  const queueIds = unique(input.queueIds);
  const mapIds = unique(input.mapIds);
  const gameModes = unique(input.gameModes);

  const needsQueues = queueIds.some((queueId) =>
    localizedQueueName(queueId, input.locale) === null
  );
  const needsMaps = mapIds.some((mapId) =>
    localizedMapName(mapId, input.locale) === null
  );
  const needsGameModes = gameModes.some((gameMode) =>
    localizedGameModeName(gameMode, input.locale) === null
  );

  const [championData, queueNames, mapNames, gameModeNames] = await Promise.all(
    [
      championIds.length > 0
        ? getChampions(input.locale)
        : Promise.resolve(null),
      needsQueues ? getQueues() : Promise.resolve(null),
      needsMaps ? getMaps() : Promise.resolve(null),
      needsGameModes ? getGameModes() : Promise.resolve(null),
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
    queues[String(queueId)] = localizedQueueName(queueId, input.locale) ??
      queueNames?.[String(queueId)] ?? null;
  }

  const maps: RiotStaticDataResolveResult["maps"] = {};
  for (const mapId of mapIds) {
    maps[String(mapId)] = localizedMapName(mapId, input.locale) ??
      mapNames?.[String(mapId)] ?? null;
  }

  const resolvedGameModes: RiotStaticDataResolveResult["gameModes"] = {};
  for (const gameMode of gameModes) {
    resolvedGameModes[gameMode] = localizedGameModeName(
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

export const riotStaticData = {
  getChampionNameById,
  getChampionIconUrlById,
  getQueueNameById,
  getMapNameById,
  getGameModeName,
  resolve,
};
