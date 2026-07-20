import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  platformAndPuuidSchema,
  regionAndMatchIdSchema,
} from "../contract/schemas.ts";
import type { AppDependencies } from "../dependencies.ts";
import { apiValidationHook, remoteApiError } from "../api_errors.ts";

export function riotRoutes(deps: Pick<AppDependencies, "riotApi">) {
  const { riotApi } = deps;
  return new Hono()
    .get(
      "/active-games/:platform/:puuid",
      zValidator("param", platformAndPuuidSchema, apiValidationHook),
      async (c) => {
        const { platform, puuid } = c.req.valid("param");
        try {
          const activeGame = await riotApi.getActiveGameByPuuid(
            platform,
            puuid,
          );
          return c.json({ activeGame }, 200);
        } catch (error) {
          throw remoteApiError("RIOT_API_UNAVAILABLE", error);
        }
      },
    )
    .get(
      "/matches/:region/:matchId",
      zValidator("param", regionAndMatchIdSchema, apiValidationHook),
      async (c) => {
        const { region, matchId } = c.req.valid("param");
        try {
          const match = await riotApi.getMatchById(region, matchId);
          return c.json({ match }, 200);
        } catch (error) {
          throw remoteApiError("RIOT_API_UNAVAILABLE", error);
        }
      },
    )
    .get(
      "/league-entries/:platform/:puuid",
      zValidator("param", platformAndPuuidSchema, apiValidationHook),
      async (c) => {
        const { platform, puuid } = c.req.valid("param");
        try {
          const entries = await riotApi.getLeagueEntriesByPuuid(
            platform,
            puuid,
          );
          return c.json({ entries }, 200);
        } catch (error) {
          throw remoteApiError("RIOT_API_UNAVAILABLE", error);
        }
      },
    );
}

export type RiotRoutes = ReturnType<typeof riotRoutes>;
