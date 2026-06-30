import type { Event } from "@adteemo/api/contract";
import {
  type ApiRpcClient,
  readErrorMessage,
  resultFromRequest,
  successOnly,
  unexpectedResponseError,
} from "./transport.ts";

function parseEvent(
  event: {
    scheduledStartAt: string | Date;
    createdAt: string | Date;
  } & Omit<Event, "scheduledStartAt" | "createdAt">,
): Event {
  return {
    ...event,
    scheduledStartAt: new Date(event.scheduledStartAt),
    createdAt: new Date(event.createdAt),
  };
}

export function createEventsApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  async function createCustomGameEvent(event: {
    name: string;
    guildId: string;
    creatorId: string;
    discordScheduledEventId: string;
    recruitmentMessageId: string;
    scheduledStartAt: Date;
  }) {
    return await resultFromRequest(
      () => rpcClient.events.$post({ json: event }),
      successOnly,
    );
  }

  async function getCustomGameEventsByCreatorId(creatorId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events["by-creator"][":creatorId"].$get({
          param: { creatorId },
        }),
      async (res) => {
        const body = await res.json() as {
          events: Parameters<typeof parseEvent>[0][];
        };
        return { events: body.events.map(parseEvent) };
      },
    );
  }

  async function deleteCustomGameEvent(discordEventId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events[":discordEventId"].$delete({
          param: { discordEventId },
        }),
      successOnly,
    );
  }

  async function getEventStartingTodayByCreatorId(creatorId: string) {
    return await resultFromRequest(
      () =>
        rpcClient.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId },
        }),
      async (res) => {
        const data = await res.json() as {
          event: Parameters<typeof parseEvent>[0];
        };
        return { event: parseEvent(data.event) };
      },
      async (res) => {
        if (res.status === 404) {
          return { success: false, error: await readErrorMessage(res) };
        }

        throw unexpectedResponseError(res);
      },
    );
  }

  return {
    createCustomGameEvent,
    getCustomGameEventsByCreatorId,
    deleteCustomGameEvent,
    getEventStartingTodayByCreatorId,
  };
}

export type EventsApiClient = ReturnType<typeof createEventsApiClient>;
