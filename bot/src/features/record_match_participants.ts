import { selectOwnedCustomGameEvent } from "./custom_game_selection.ts";
import type { Event, Lane } from "@adteemo/api/contract";
import type { Guild } from "discord.js";
import { apiClient } from "../api_client.ts";
import type { FailureResult } from "../api_clients/transport.ts";

export type RecordMatchParticipant = {
  user: {
    id: string;
    username: string;
  };
  lane: Lane;
  team: "BLUE" | "RED";
};

export type ActiveRecordMatch = {
  event: Event;
  participants: RecordMatchParticipant[];
};

type ActiveParticipantInput = {
  guild: Guild;
  guildId: string;
  recruitmentChannelId: string;
  creatorId: string;
  eventId?: number;
};

export class RecordMatchParticipantProviderError extends Error {
  constructor(readonly failure: FailureResult) {
    super(failure.error);
    this.name = "RecordMatchParticipantProviderError";
  }
}

async function getTodayEvent(input: ActiveParticipantInput) {
  const eventResult = await apiClient.getEventStartingTodayByCreator(
    input.guildId,
    input.recruitmentChannelId,
    input.creatorId,
  );
  if (!eventResult.success) {
    throw new RecordMatchParticipantProviderError(eventResult);
  }

  return eventResult.event;
}

async function getActiveParticipants(
  input: ActiveParticipantInput,
): Promise<ActiveRecordMatch> {
  const event = input.eventId !== undefined
    ? await selectOwnedCustomGameEvent({ ...input, eventId: input.eventId })
    : await getTodayEvent(input);

  const rosterResult = await apiClient.getCustomGameEventParticipants(
    event.id,
    {
      guildId: input.guildId,
      recruitmentChannelId: input.recruitmentChannelId,
    },
  );
  if (!rosterResult.success) {
    throw new RecordMatchParticipantProviderError(rosterResult);
  }
  if (rosterResult.participants.length !== 10) {
    throw new Error("A custom match requires exactly 10 participants");
  }

  const participants = await Promise.all(
    rosterResult.participants.map(async (participant) => {
      const member = await input.guild.members.fetch(participant.userId);
      if (!member) {
        throw new Error(
          `Discord member ${participant.userId} is not in the guild`,
        );
      }
      return {
        user: {
          id: participant.userId,
          username: member.user.username,
        },
        lane: participant.lane,
        team: participant.team,
      };
    }),
  );

  return { event, participants };
}

export const recordMatchParticipantProvider = {
  getActiveParticipants,
};
