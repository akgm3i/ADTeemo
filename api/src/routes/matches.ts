import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/actions.ts";
import {
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  upsertPendingRankSnapshotsSchema,
} from "../validators.ts";
import { RecordNotFoundError } from "../errors.ts";

export const matchesRoutes = new Hono()
  .post(
    "/rank-snapshots/pending",
    zValidator("json", upsertPendingRankSnapshotsSchema),
    async (c) => {
      const payload = c.req.valid("json");
      await dbActions.upsertPendingRankSnapshots(payload);
      return c.body(null, 204);
    },
  )
  .post(
    "/:matchId/rank-snapshots/finalize",
    zValidator("json", finalizeRankSnapshotsSchema),
    async (c) => {
      const { matchId } = c.req.param();
      const payload = c.req.valid("json");
      const snapshots = await dbActions.finalizeMatchRankSnapshots({
        ...payload,
        matchId,
      });
      return c.json({ snapshots }, 200);
    },
  )
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
        return c.json({ id: result.id }, 201);
      } catch (e) {
        if (e instanceof RecordNotFoundError) {
          return c.json({ error: e.message }, 404);
        }
        throw e;
      }
    },
  );

export type MatchesRoutes = typeof matchesRoutes;
