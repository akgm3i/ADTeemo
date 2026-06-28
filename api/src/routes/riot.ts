import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { riotPlatforms, riotRegions } from "../db/schema.ts";
import type { AppDependencies } from "../dependencies.ts";

const platformAndPuuidSchema = z.object({
  platform: z.enum(riotPlatforms),
  puuid: z.string().min(1),
});

const regionAndMatchIdSchema = z.object({
  region: z.enum(riotRegions),
  matchId: z.string().min(1),
});

function upstreamErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Riot API request failed";
}

export function riotRoutes(deps: Pick<AppDependencies, "riotApi">) {
  const { riotApi } = deps;
  return new Hono()
    .get(
      "/active-games/:platform/:puuid",
      zValidator("param", platformAndPuuidSchema),
      async (c) => {
        const { platform, puuid } = c.req.valid("param");
        try {
          const activeGame = await riotApi.getActiveGameByPuuid(
            platform,
            puuid,
          );
          return c.json({ activeGame }, 200);
        } catch (error) {
          return c.json({ error: upstreamErrorMessage(error) }, 502);
        }
      },
    )
    .get(
      "/matches/:region/:matchId",
      zValidator("param", regionAndMatchIdSchema),
      async (c) => {
        const { region, matchId } = c.req.valid("param");
        try {
          const match = await riotApi.getMatchById(region, matchId);
          return c.json({ match }, 200);
        } catch (error) {
          return c.json({ error: upstreamErrorMessage(error) }, 502);
        }
      },
    )
    .get(
      "/league-entries/:platform/:puuid",
      zValidator("param", platformAndPuuidSchema),
      async (c) => {
        const { platform, puuid } = c.req.valid("param");
        try {
          const entries = await riotApi.getLeagueEntriesByPuuid(
            platform,
            puuid,
          );
          return c.json({ entries }, 200);
        } catch (error) {
          return c.json({ error: upstreamErrorMessage(error) }, 502);
        }
      },
    );
}

export type RiotRoutes = ReturnType<typeof riotRoutes>;
