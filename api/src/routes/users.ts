import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  lanes,
  type RiotPlatform,
  riotPlatforms,
  type RiotRegion,
  riotRegions,
} from "../db/schema.ts";
import { dbActions } from "../db/actions.ts";
import { riotApi } from "../riot_api.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const roleSchema = z.object({
  guildId: z.string(),
  role: z.enum(lanes),
});

const linkByRiotIdSchema = z.object({
  discordId: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
  platform: z.enum(riotPlatforms).optional(),
  region: z.enum(riotRegions).optional(),
});

function defaultPlatform(): RiotPlatform {
  const platform = Deno.env.get("RIOT_DEFAULT_PLATFORM") ?? "jp1";
  return riotPlatforms.includes(platform as RiotPlatform)
    ? platform as RiotPlatform
    : "jp1";
}

function defaultRegion(): RiotRegion {
  const region = Deno.env.get("RIOT_DEFAULT_REGION") ?? "asia";
  return riotRegions.includes(region as RiotRegion)
    ? region as RiotRegion
    : "asia";
}

export const usersRoutes = new Hono()
  .patch(
    "/link-by-riot-id",
    zValidator("json", linkByRiotIdSchema),
    async (c) => {
      const { discordId, gameName, tagLine, platform, region } = c.req.valid(
        "json",
      );
      const resolvedPlatform = platform ?? defaultPlatform();
      const resolvedRegion = region ?? defaultRegion();

      const account = await riotApi.getAccountByRiotId(
        resolvedRegion,
        gameName,
        tagLine,
      );

      if (!account) {
        return c.json({
          error: messageHandler.formatMessage(
            messageKeys.riotAccount.set.error.summonerNotFound,
          ),
        }, 404);
      }

      await dbActions.upsertRiotAccount({
        discordId,
        puuid: account.puuid,
        gameName: account.gameName,
        tagLine: account.tagLine,
        platform: resolvedPlatform,
        region: resolvedRegion,
      });

      return c.body(null, 204);
    },
  )
  .get("/:userId/riot-account", async (c) => {
    const { userId } = c.req.param();
    const account = await dbActions.getRiotAccountByDiscordId(userId);
    if (!account) {
      return c.json({ error: "Riot account not found" }, 404);
    }
    return c.json({ account }, 200);
  })
  .put(
    "/:userId/main-role",
    zValidator("json", roleSchema),
    async (c) => {
      const { userId } = c.req.param();
      const { guildId, role } = c.req.valid("json");
      await dbActions.setMainRole(userId, guildId, role);
      return c.body(null, 204);
    },
  );

export type UsersRoutes = typeof usersRoutes;
