import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  eventCancellationProgressSchema,
  eventCreationFailureSchema,
  eventCreationProgressSchema,
  eventIdParamSchema,
  eventScopeSchema,
  prepareEventSchema,
  saveEventParticipantsSchema,
} from "../contract/schemas.ts";
import type { AppDependencies } from "../dependencies.ts";
import { DomainConflictError, EventNotFoundError } from "../errors.ts";
import {
  apiErrorResponse,
  apiValidationHook,
  repositoryApiError,
} from "../api_errors.ts";

type EventsDbActions = Pick<
  AppDependencies["dbActions"],
  | "prepareCustomGameEvent"
  | "updateCustomGameEventCreationProgress"
  | "activateCustomGameEvent"
  | "markCustomGameEventCreationFailed"
  | "beginCustomGameEventCancellation"
  | "updateCustomGameEventCancellationProgress"
  | "getCustomGameEventsByCreator"
  | "getEventStartingTodayByCreator"
  | "saveCustomGameEventParticipants"
  | "confirmCustomGameEventParticipants"
  | "getCustomGameEventParticipants"
  | "getNextCustomGameSequence"
>;

function throwEventRepositoryError(error: unknown): never {
  if (error instanceof EventNotFoundError) {
    throw new Error("EventNotFoundError must be handled by the route");
  }
  if (error instanceof DomainConflictError) {
    throw new Error("DomainConflictError must be handled by the route");
  }
  throw repositoryApiError(error);
}

export function eventsRoutes(deps: { dbActions: EventsDbActions }) {
  const { dbActions } = deps;

  function eventFailure(error: unknown) {
    if (error instanceof EventNotFoundError) return "not_found" as const;
    if (error instanceof DomainConflictError) return "conflict" as const;
    return throwEventRepositoryError(error);
  }

  return new Hono()
    .post(
      "/",
      zValidator("json", prepareEventSchema, apiValidationHook),
      async (c) => {
        try {
          const result = await dbActions.prepareCustomGameEvent(
            c.req.valid("json"),
          );
          return c.json(result, result.created ? 201 : 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          throw error;
        }
      },
    )
    .get("/by-creator/:guildId/:channelId/:creatorId", async (c) => {
      const { guildId, channelId, creatorId } = c.req.param();
      try {
        const events = await dbActions.getCustomGameEventsByCreator({
          guildId,
          recruitmentChannelId: channelId,
          creatorId,
        });
        return c.json({ events }, 200);
      } catch (error) {
        throw repositoryApiError(error);
      }
    })
    .get("/today/:guildId/:channelId/by-creator/:creatorId", async (c) => {
      const { guildId, channelId, creatorId } = c.req.param();
      try {
        const event = await dbActions.getEventStartingTodayByCreator({
          guildId,
          recruitmentChannelId: channelId,
          creatorId,
        });
        if (!event) return apiErrorResponse(c, "EVENT_NOT_FOUND");
        return c.json({ event }, 200);
      } catch (error) {
        throw repositoryApiError(error);
      }
    })
    .patch(
      "/:eventId/creation",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", eventCreationProgressSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const event = await dbActions
            .updateCustomGameEventCreationProgress({
              eventId,
              ...c.req.valid("json"),
            });
          return c.json({ event }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .post(
      "/:eventId/activate",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", eventScopeSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const event = await dbActions.activateCustomGameEvent({
            eventId,
            ...c.req.valid("json"),
          });
          return c.json({ event }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .post(
      "/:eventId/creation-failure",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", eventCreationFailureSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const event = await dbActions.markCustomGameEventCreationFailed({
            eventId,
            ...c.req.valid("json"),
          });
          return c.json({ event }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .post(
      "/:eventId/cancel",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", eventScopeSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const event = await dbActions.beginCustomGameEventCancellation({
            eventId,
            ...c.req.valid("json"),
          });
          return c.json({ event }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .patch(
      "/:eventId/cancel",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator(
        "json",
        eventCancellationProgressSchema,
        apiValidationHook,
      ),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const event = await dbActions
            .updateCustomGameEventCancellationProgress({
              eventId,
              ...c.req.valid("json"),
            });
          return c.json({ event }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .get(
      "/:eventId/next-game",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("query", eventScopeSchema, apiValidationHook),
      async (c) => {
        try {
          const gameSequence = await dbActions.getNextCustomGameSequence({
            eventId: c.req.valid("param").eventId,
            ...c.req.valid("query"),
          });
          return c.json({ gameSequence }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(
              c,
              "EVENT_NOT_FOUND",
            );
          }
          if (failure === "conflict") return apiErrorResponse(c, "CONFLICT");
          throw error;
        }
      },
    )
    .post(
      "/:eventId/participants/confirm",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", saveEventParticipantsSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const participants = await dbActions
            .confirmCustomGameEventParticipants({
              eventId,
              ...c.req.valid("json"),
            });
          return c.json({ participants }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .put(
      "/:eventId/participants",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("json", saveEventParticipantsSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const participants = await dbActions
            .saveCustomGameEventParticipants({
              eventId,
              ...c.req.valid("json"),
            });
          return c.json({ participants }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    )
    .get(
      "/:eventId/participants",
      zValidator("param", eventIdParamSchema, apiValidationHook),
      zValidator("query", eventScopeSchema, apiValidationHook),
      async (c) => {
        try {
          const { eventId } = c.req.valid("param");
          const participants = await dbActions
            .getCustomGameEventParticipants({
              eventId,
              ...c.req.valid("query"),
            });
          return c.json({ participants }, 200);
        } catch (error) {
          const failure = eventFailure(error);
          if (failure === "not_found") {
            return apiErrorResponse(c, "EVENT_NOT_FOUND");
          }
          if (failure === "conflict") {
            return apiErrorResponse(c, "CONFLICT");
          }
          throw error;
        }
      },
    );
}

export type EventsRoutes = ReturnType<typeof eventsRoutes>;
