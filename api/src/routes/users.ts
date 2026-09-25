import { z } from "zod";
import { DomainConflictError, RecordNotFoundError } from "../errors.ts";
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
import {
  apiErrorResponse,
  apiValidationHook,
  remoteApiError,
} from "../api_errors.ts";

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
  | "upsertRiotAccount"
  | "getRiotAccountByDiscordId"
  | "setMainRole"
  | "getRiotAccountsByDiscordId"
  | "setMainRiotAccount"
  | "deleteRiotAccount"
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
      zValidator("json", linkByRiotIdSchema, apiValidationHook),
      async (c) => {
        const { discordId, gameName, tagLine, platform, region } = c.req.valid(
          "json",
        );
        const resolvedPlatform = platform ?? defaultPlatform(env);
        const resolvedRegion = region ?? defaultRegion(env);

        let account;
        try {
          account = await riotApi.getAccountByRiotId(
            resolvedRegion,
            gameName,
            tagLine,
          );
        } catch (error) {
          throw remoteApiError("RIOT_API_UNAVAILABLE", error);
        }

        if (!account) {
          return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND", {
            message: messageHandler.formatMessage(
              messageKeys.riotAccount.set.error.summonerNotFound,
            ),
          });
        }

        try {
          await dbActions.upsertRiotAccount({
            discordId,
            puuid: account.puuid,
            gameName: account.gameName,
            tagLine: account.tagLine,
            platform: resolvedPlatform,
            region: resolvedRegion,
          });
        } catch (error) {
          if (error instanceof DomainConflictError) {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }

        return c.body(null, 204);
      },
    )
    .get("/:userId/riot-accounts", async (c) => {
      const accounts = await dbActions.getRiotAccountsByDiscordId(
        c.req.param("userId"),
      );
      return c.json({ accounts }, 200);
    })
    .put("/:userId/riot-accounts/:puuid/main", async (c) => {
      try {
        await dbActions.setMainRiotAccount(
          c.req.param("userId"),
          c.req.param("puuid"),
        );
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof RecordNotFoundError) {
          return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
        }
        throw error;
      }
    })
    .delete("/:userId/riot-accounts/:puuid", async (c) => {
      try {
        await dbActions.deleteRiotAccount(
          c.req.param("userId"),
          c.req.param("puuid"),
        );
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof RecordNotFoundError) {
          return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
        }
        throw error;
      }
    })
    .get(
      "/:userId/riot-account",
      zValidator(
        "query",
        z.object({ puuid: z.string().min(1).optional() }),
        apiValidationHook,
      ),
      async (c) => {
        const { userId } = c.req.param();
        const { puuid } = c.req.valid("query");
        const account = puuid === undefined
          ? await dbActions.getRiotAccountByDiscordId(userId)
          : await dbActions.getRiotAccountByDiscordId(userId, puuid);
        if (!account) return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
        return c.json({ account }, 200);
      },
    )
    .put(
      "/:userId/main-role",
      zValidator("json", roleSchema, apiValidationHook),
      async (c) => {
        const { userId } = c.req.param();
        const { guildId, role } = c.req.valid("json");
        await dbActions.setMainRole(userId, guildId, role);
        return c.body(null, 204);
      },
    );
}

export type UsersRoutes = ReturnType<typeof usersRoutes>;
