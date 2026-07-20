import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
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
import type { AppDependencies } from "../dependencies.ts";
import { apiErrorResponse, apiValidationHook } from "../api_errors.ts";

type MatchesDbActions = Pick<
  AppDependencies["dbActions"],
  | "upsertPendingRankSnapshots"
  | "finalizeMatchRankSnapshots"
  | "createMatchParticipant"
>;

export function matchesRoutes(
  deps: {
    dbActions: MatchesDbActions;
    opggMatchDetailService: AppDependencies["opggMatchDetailService"];
    logger: AppDependencies["logger"];
  },
) {
  const { dbActions, opggMatchDetailService, logger } = deps;
  return new Hono()
    .post(
      "/rank-snapshots/pending",
      zValidator(
        "json",
        upsertPendingRankSnapshotsSchema,
        apiValidationHook,
      ),
      async (c) => {
        const payload = c.req.valid("json");
        await dbActions.upsertPendingRankSnapshots(payload);
        return c.body(null, 204);
      },
    )
    .post(
      "/:matchId/rank-snapshots/finalize",
      zValidator("json", finalizeRankSnapshotsSchema, apiValidationHook),
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
          logger.warn("opgg_match_detail.invalid_request", {
            validationIssues: result.error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path,
            })),
          });
          return apiValidationHook(result, c);
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
            return apiErrorResponse(c, "RIOT_ACCOUNT_NOT_FOUND");
          }
          if (error instanceof OpggMatchParticipantMismatchError) {
            return apiErrorResponse(c, "OPGG_PARTICIPANT_MISMATCH");
          }
          return apiErrorResponse(c, "INTERNAL_ERROR", { cause: error });
        }
      },
    )
    .post(
      "/:matchId/participants",
      zValidator("json", createParticipantSchema, apiValidationHook),
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
            return apiErrorResponse(c, "RESOURCE_NOT_FOUND", {
              message: "Match or user not found",
            });
          }
          throw e;
        }
      },
    );
}

export type MatchesRoutes = ReturnType<typeof matchesRoutes>;
