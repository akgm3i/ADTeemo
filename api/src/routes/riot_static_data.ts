import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppDependencies } from "../dependencies.ts";

const riotStaticDataResolveSchema = z.object({
  locale: z.string().trim().min(1).max(32).optional(),
  championIds: z.array(z.number().int().nonnegative()).max(20).default([]),
  queueIds: z.array(z.number().int().nonnegative()).max(10).default([]),
  mapIds: z.array(z.number().int().nonnegative()).max(10).default([]),
  gameModes: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
});

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
