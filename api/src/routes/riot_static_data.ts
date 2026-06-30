import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { riotStaticDataResolveSchema } from "../contract/schemas.ts";
import type { AppDependencies } from "../dependencies.ts";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Failed to resolve Riot static data";
}

export function riotStaticDataRoutes(
  deps: Pick<AppDependencies, "riotStaticData">,
) {
  const { riotStaticData } = deps;
  return new Hono().post(
    "/resolve",
    zValidator("json", riotStaticDataResolveSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "Invalid Riot static data resolve request" },
          400,
        );
      }
    }),
    async (c) => {
      try {
        const result = await riotStaticData.resolve(c.req.valid("json"));
        return c.json(result, 200);
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 502);
      }
    },
  );
}

export type RiotStaticDataRoutes = ReturnType<typeof riotStaticDataRoutes>;
