import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { apiValidationHook } from "../api_errors.ts";
import type { AppDependencies } from "../dependencies.ts";
import {
  configureGuildMatchWatchSchema,
  matchWatchPreferenceSchema,
  syncGuildMatchWatchMembersSchema,
} from "../contract/watch_policy.ts";
export function watchPolicyRoutes({
  dbActions,
}: {
  dbActions: Pick<
    AppDependencies["dbActions"],
    | "getGuildMatchWatchSettings"
    | "setGuildMatchWatchSettings"
    | "syncGuildMatchWatchMembers"
    | "setMatchWatchOptOut"
  >;
}) {
  return new Hono()
    .get(
      "/:guildId/settings",
      async (c) =>
        c.json({
          settings: await dbActions.getGuildMatchWatchSettings(
            c.req.param("guildId"),
          ),
        }, 200),
    )
    .put(
      "/:guildId/settings",
      zValidator("json", configureGuildMatchWatchSchema, apiValidationHook),
      async (c) =>
        c.json(
          await dbActions.setGuildMatchWatchSettings({
            guildId: c.req.param("guildId"),
            ...c.req.valid("json"),
          }),
          200,
        ),
    )
    .put(
      "/:guildId/members",
      zValidator("json", syncGuildMatchWatchMembersSchema, apiValidationHook),
      async (c) =>
        c.json(
          await dbActions.syncGuildMatchWatchMembers(
            c.req.param("guildId"),
            c.req.valid("json").memberDiscordIds,
          ),
          200,
        ),
    )
    .put(
      "/:guildId/preferences/:discordId",
      zValidator("json", matchWatchPreferenceSchema, apiValidationHook),
      async (c) => {
        await dbActions.setMatchWatchOptOut(
          c.req.param("guildId"),
          c.req.param("discordId"),
          c.req.valid("json").optOut,
        );
        return c.body(null, 204);
      },
    );
}
