import type { z } from "zod";
import {
  eventCancellationProgressSchema,
  eventCreationFailureSchema,
  eventCreationProgressSchema,
  eventScopeSchema,
  prepareEventSchema,
  responseContracts,
  saveEventParticipantsSchema,
} from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";

export function createEventsApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function prepareCustomGameEvent(
    input: z.infer<typeof prepareEventSchema>,
  ) {
    return await requestResult(
      responseContracts.prepareEvent,
      () => rpcClient.events.$post({ json: input }),
    );
  }

  async function updateCustomGameEventCreationProgress(
    eventId: number,
    input: z.infer<typeof eventCreationProgressSchema>,
  ) {
    return await requestResult(
      responseContracts.eventCreation,
      () =>
        rpcClient.events[":eventId"].creation.$patch({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function activateCustomGameEvent(
    eventId: number,
    input: z.infer<typeof eventScopeSchema>,
  ) {
    return await requestResult(
      responseContracts.activateEvent,
      () =>
        rpcClient.events[":eventId"].activate.$post({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function markCustomGameEventCreationFailed(
    eventId: number,
    input: z.infer<typeof eventCreationFailureSchema>,
  ) {
    return await requestResult(
      responseContracts.eventCreationFailure,
      () =>
        rpcClient.events[":eventId"]["creation-failure"].$post({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function getCustomGameEventsByCreator(
    guildId: string,
    recruitmentChannelId: string,
    creatorId: string,
  ) {
    return await requestResult(
      responseContracts.eventsByCreator,
      () =>
        rpcClient.events["by-creator"][":guildId"][":channelId"][":creatorId"]
          .$get({
            param: {
              guildId,
              channelId: recruitmentChannelId,
              creatorId,
            },
          }),
    );
  }

  async function getEventStartingTodayByCreator(
    guildId: string,
    recruitmentChannelId: string,
    creatorId: string,
  ) {
    return await requestResult(
      responseContracts.eventToday,
      () =>
        rpcClient.events.today[":guildId"][":channelId"]["by-creator"][
          ":creatorId"
        ].$get({
          param: {
            guildId,
            channelId: recruitmentChannelId,
            creatorId,
          },
        }),
    );
  }

  async function beginCustomGameEventCancellation(
    eventId: number,
    input: z.infer<typeof eventScopeSchema>,
  ) {
    return await requestResult(
      responseContracts.cancelEvent,
      () =>
        rpcClient.events[":eventId"].cancel.$post({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function updateCustomGameEventCancellationProgress(
    eventId: number,
    input: z.infer<typeof eventCancellationProgressSchema>,
  ) {
    return await requestResult(
      responseContracts.eventCancellation,
      () =>
        rpcClient.events[":eventId"].cancel.$patch({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function confirmCustomGameEventParticipants(
    eventId: number,
    input: z.infer<typeof saveEventParticipantsSchema>,
  ) {
    return await requestResult(
      responseContracts.confirmParticipants,
      () =>
        rpcClient.events[":eventId"].participants.confirm.$post({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function saveCustomGameEventParticipants(
    eventId: number,
    input: z.infer<typeof saveEventParticipantsSchema>,
  ) {
    return await requestResult(
      responseContracts.saveParticipants,
      () =>
        rpcClient.events[":eventId"].participants.$put({
          param: { eventId: String(eventId) },
          json: input,
        }),
    );
  }

  async function getCustomGameEventParticipants(
    eventId: number,
    input: z.infer<typeof eventScopeSchema>,
  ) {
    return await requestResult(
      responseContracts.getParticipants,
      () =>
        rpcClient.events[":eventId"].participants.$get({
          param: { eventId: String(eventId) },
          query: input,
        }),
    );
  }

  return {
    getNextCustomGameSequence: (
      eventId: number,
      scope: { guildId: string; recruitmentChannelId: string },
    ) =>
      requestResult(
        responseContracts.getNextCustomGameSequence,
        () =>
          rpcClient.events[":eventId"]["next-game"].$get({
            param: { eventId: String(eventId) },
            query: scope,
          }),
      ),
    prepareCustomGameEvent,
    updateCustomGameEventCreationProgress,
    activateCustomGameEvent,
    markCustomGameEventCreationFailed,
    getCustomGameEventsByCreator,
    getEventStartingTodayByCreator,
    beginCustomGameEventCancellation,
    updateCustomGameEventCancellationProgress,
    saveCustomGameEventParticipants,
    confirmCustomGameEventParticipants,
    getCustomGameEventParticipants,
  };
}

export type EventsApiClient = ReturnType<typeof createEventsApiClient>;
