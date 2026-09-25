import { messageHandler, messageKeys } from "../messages.ts";
import type { Event } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";

export async function selectOwnedCustomGameEvent(
  input: {
    guildId: string;
    recruitmentChannelId: string;
    creatorId: string;
    eventId: number;
  },
): Promise<Event> {
  const result = await apiClient.getCustomGameEventsByCreator(
    input.guildId,
    input.recruitmentChannelId,
    input.creatorId,
  );
  if (!result.success) throw new Error(result.error);
  const event = result.events.find((candidate) =>
    candidate.id === input.eventId && candidate.guildId === input.guildId &&
    candidate.recruitmentChannelId === input.recruitmentChannelId &&
    candidate.creatorId === input.creatorId &&
    candidate.phase === "RECRUITING" &&
    candidate.syncState === "CONSISTENT"
  );
  if (!event) {
    throw new Error(
      messageHandler.formatMessage(messageKeys.customGame.flow.noOwnedEvent),
    );
  }
  return event;
}
