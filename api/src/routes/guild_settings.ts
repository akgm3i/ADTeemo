import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { customGameSettingsSchema } from "../contract/custom_game_settings.ts";
import type { AppDependencies } from "../dependencies.ts";
import { apiValidationHook } from "../api_errors.ts";

export function guildSettingsRoutes(
  { dbActions }: {
    dbActions: Pick<
      AppDependencies["dbActions"],
      "getCustomGameSettings" | "setCustomGameSettings"
    >;
  },
) {
  return new Hono()
    .get(
      "/:guildId/custom-game",
      async (c) =>
        c.json({
          settings:
            await dbActions.getCustomGameSettings(c.req.param("guildId")) ??
              null,
        }, 200),
    )
    .put(
      "/:guildId/custom-game",
      zValidator("json", customGameSettingsSchema, apiValidationHook),
      async (c) => {
        const settings = await dbActions.setCustomGameSettings(
          c.req.param("guildId"),
          c.req.valid("json"),
        );
        return c.json({ settings }, 200);
      },
    );
}
