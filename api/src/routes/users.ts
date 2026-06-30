import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  type RiotPlatform,
  riotPlatforms,
  type RiotRegion,
  riotRegions,
} from "../contract/domain.ts";
import { linkByRiotIdSchema, roleSchema } from "../contract/schemas.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import type { AppDependencies, EnvReader } from "../dependencies.ts";

function defaultPlatform(env: EnvReader): RiotPlatform {
  const platform = env.get("RIOT_DEFAULT_PLATFORM") ?? "jp1";
  return riotPlatforms.includes(platform as RiotPlatform)
    ? platform as RiotPlatform
    : "jp1";
}

function defaultRegion(env: EnvReader): RiotRegion {
  const region = env.get("RIOT_DEFAULT_REGION") ?? "asia";
  return riotRegions.includes(region as RiotRegion)
    ? region as RiotRegion
    : "asia";
}

type UsersDbActions = Pick<
  AppDependencies["dbActions"],
  "upsertRiotAccount" | "getRiotAccountByDiscordId" | "setMainRole"
>;

export function usersRoutes(deps: {
  dbActions: UsersDbActions;
  riotApi: AppDependencies["riotApi"];
  env: AppDependencies["env"];
}) {
  const { dbActions, riotApi, env } = deps;
  return new Hono()
    .patch(
      "/link-by-riot-id",
      zValidator("json", linkByRiotIdSchema),
      async (c) => {
        const { discordId, gameName, tagLine, platform, region } = c.req.valid(
          "json",
        );
        const resolvedPlatform = platform ?? defaultPlatform(env);
        const resolvedRegion = region ?? defaultRegion(env);

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
}

export type UsersRoutes = ReturnType<typeof usersRoutes>;
