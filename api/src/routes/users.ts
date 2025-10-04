import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { lanes } from "../db/schema.ts";
import { dbActions } from "../db/actions.ts";
import { riotApi } from "../riot_api.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const roleSchema = z.object({
  role: z.enum(lanes),
});

const linkByRiotIdSchema = z.object({
  discordId: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
});

export const usersRoutes = new Hono()
  .patch(
    "/link-by-riot-id",
    zValidator("json", linkByRiotIdSchema),
    async (c) => {
      const { discordId, gameName, tagLine } = c.req.valid("json");

      const account = await riotApi.getAccountByRiotId(gameName, tagLine);

      if (!account) {
        return c.json({
          error: messageHandler.formatMessage(
            messageKeys.riotAccount.set.error.summonerNotFound,
          ),
        }, 404);
      }

      await dbActions.upsertUser(discordId);
      await dbActions.updateUserRiotId(discordId, account.puuid);

      return c.json({ success: true });
    },
  )
  .put(
    "/:userId/main-role",
    zValidator("json", roleSchema),
    async (c) => {
      const { userId } = c.req.param();
      const { role } = c.req.valid("json");
      await dbActions.setMainRole(userId, role);
      return c.json({ success: true });
    },
  );

export type UsersRoutes = typeof usersRoutes;
