import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/actions.ts";
import { createParticipantSchema } from "../validators.ts";
import { RecordNotFoundError } from "../errors.ts";

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
        if (e instanceof RecordNotFoundError) {
          return c.json({ success: false, error: e.message }, 400);
        }
        throw e;
      }
    },
  );

export type MatchesRoutes = typeof matchesRoutes;
