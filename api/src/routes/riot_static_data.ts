import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { riotStaticDataResolveSchema } from "../contract/schemas.ts";
import type { AppDependencies } from "../dependencies.ts";
import { apiValidationHook, remoteApiError } from "../api_errors.ts";

export function riotStaticDataRoutes(
  deps: Pick<AppDependencies, "riotStaticData">,
) {
  const { riotStaticData } = deps;
  return new Hono().post(
    "/resolve",
    zValidator("json", riotStaticDataResolveSchema, apiValidationHook),
    async (c) => {
      try {
        const result = await riotStaticData.resolve(c.req.valid("json"));
        return c.json(result, 200);
      } catch (error) {
        throw remoteApiError("RIOT_STATIC_DATA_UNAVAILABLE", error);
      }
    },
  );
}

export type RiotStaticDataRoutes = ReturnType<typeof riotStaticDataRoutes>;
