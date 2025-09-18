import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/actions.ts";
import { createParticipantSchema } from "../validators.ts";

export const matchesRoutes = new Hono()
  .post(
    "/:matchId/participants",
    zValidator("json", createParticipantSchema),
    async (c) => {
      const { matchId } = c.req.param();
      const participantData = c.req.valid("json");

      try {
        const result = await dbActions.createMatchParticipant({
          ...participantData,
          matchId,
        });
        return c.json({ success: true, id: result.id }, 201);
      } catch (e) {
        console.error(e);
        return c.json(
          { success: false, error: "Failed to create participant" },
          500,
        );
      }
    },
  );

export type MatchesRoutes = typeof matchesRoutes;
