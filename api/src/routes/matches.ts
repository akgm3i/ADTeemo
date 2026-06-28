import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/default_actions.ts";
import {
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  resolveOpggMatchDetailSchema,
  upsertPendingRankSnapshotsSchema,
} from "../validators.ts";
import {
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
} from "../errors.ts";
import { opggMatchDetailService } from "../services/opgg_match_detail.ts";
import { apiLogger } from "../logger.ts";

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
    "/:matchId/external-details/opgg/resolve",
    zValidator("json", resolveOpggMatchDetailSchema, (result, c) => {
      if (!result.success) {
        apiLogger.warn("opgg_match_detail.invalid_request", {
          validationIssues: result.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path,
          })),
        });
        return c.json({ error: "Invalid request body" }, 400);
      }
    }),
    async (c) => {
      const { matchId } = c.req.param();
      const payload = c.req.valid("json");

      try {
        const detail = await opggMatchDetailService.resolveAndSave({
          matchId,
          ...payload,
        });
        return c.json({ detail }, 200);
      } catch (error) {
        if (error instanceof RecordNotFoundError) {
          return c.json({ error: error.message }, 404);
        }
        if (error instanceof OpggMatchParticipantMismatchError) {
          return c.json({ error: error.message }, 400);
        }
        apiLogger.error(
          "opgg_match_detail.request_failed",
          {
            matchId,
            targetDiscordId: payload.targetDiscordId,
          },
          error,
        );
        return c.json({ error: "Failed to resolve OP.GG match detail" }, 500);
      }
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
