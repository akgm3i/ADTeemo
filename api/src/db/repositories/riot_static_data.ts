import { eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { Database } from "../index.ts";
import { riotStaticDataCache } from "../schema.ts";

const riotStaticDataCacheInsertSchema = createInsertSchema(riotStaticDataCache);

export function createRiotStaticDataRepository(database: Database) {
  async function getRiotStaticDataCache(key: string) {
    return await database.query.riotStaticDataCache.findFirst({
      where: eq(riotStaticDataCache.key, key),
    });
  }

  async function upsertRiotStaticDataCache(cache: {
    key: string;
    version: string;
    value: string;
  }) {
    const payload = riotStaticDataCacheInsertSchema.parse(cache);
    await database.insert(riotStaticDataCache).values(payload)
      .onConflictDoUpdate({
        target: riotStaticDataCache.key,
        set: {
          version: cache.version,
          value: cache.value,
          updatedAt: new Date(),
        },
      }).execute();
  }

  return {
    getRiotStaticDataCache,
    upsertRiotStaticDataCache,
  };
}

export type RiotStaticDataRepository = ReturnType<
  typeof createRiotStaticDataRepository
>;
