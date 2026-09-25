import {
  type Guild,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Message,
  type MessageCreateOptions,
  type MessageManager,
} from "discord.js";

import { hasMessageMarker } from "./discord_message_marker.ts";

export const CUSTOM_GAME_EVENT_OPERATION_MARKER_PREFIX = "ADTeemo operation:";

export function customGameEventOperationMarker(operationKey: string) {
  return `${CUSTOM_GAME_EVENT_OPERATION_MARKER_PREFIX}${operationKey}`;
}

export async function findCustomGameScheduledEvent(
  guild: Pick<Guild, "scheduledEvents">,
  operationKey: string,
): Promise<GuildScheduledEvent | null> {
  const operationMarker = customGameEventOperationMarker(operationKey);
  const scheduledEvents = await guild.scheduledEvents.fetch();
  const matchingEvents = scheduledEvents.filter(
    (event) => event.description === operationMarker,
  );
  if (matchingEvents.size > 1) {
    throw new Error(
      `Multiple Discord scheduled events found for operation ${operationKey}`,
    );
  }
  return matchingEvents.first() ?? null;
}

export async function findOrCreateCustomGameScheduledEvent(
  guild: Pick<Guild, "scheduledEvents">,
  input: {
    operationKey: string;
    name: string;
    voiceChannelId: string;
    scheduledStartAt: Date;
  },
): Promise<GuildScheduledEvent> {
  const operationMarker = customGameEventOperationMarker(input.operationKey);
  const existingEvent = await findCustomGameScheduledEvent(
    guild,
    input.operationKey,
  );
  if (existingEvent) return existingEvent;

  try {
    return await guild.scheduledEvents.create({
      name: input.name,
      description: operationMarker,
      scheduledStartTime: input.scheduledStartAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: input.voiceChannelId,
    });
  } catch (createError) {
    try {
      const recoveredEvent = await findCustomGameScheduledEvent(
        guild,
        input.operationKey,
      );
      if (recoveredEvent) return recoveredEvent;
    } catch (recoveryError) {
      throw new AggregateError(
        [createError, recoveryError],
        "Discord scheduled event creation outcome is ambiguous",
      );
    }
    throw createError;
  }
}

export async function findCustomGameRecruitmentMessage(
  messages: Pick<MessageManager, "fetch">,
  input: {
    operationKey: string;
    createdAfter: Date;
  },
): Promise<Message | null> {
  let before: string | undefined;
  let found: Message | null = null;

  while (true) {
    const page = await messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    for (const message of page.values()) {
      if (
        message.createdAt < input.createdAfter ||
        !hasMessageMarker(
          message,
          customGameEventOperationMarker(input.operationKey),
        )
      ) {
        continue;
      }
      if (found && found.id !== message.id) {
        throw new Error(
          `Multiple Discord recruitment messages found for operation ${input.operationKey}`,
        );
      }
      found = message;
    }

    const oldest = page.last();
    if (
      page.size < 100 || !oldest || oldest.createdAt <= input.createdAfter
    ) {
      return found;
    }
    if (oldest.id === before) {
      throw new Error("Discord message pagination did not advance");
    }
    before = oldest.id;
  }
}

type RecruitmentMessageGateway = {
  messages: Pick<MessageManager, "fetch">;
  send(options: MessageCreateOptions): Promise<Message>;
};

export async function findOrCreateCustomGameRecruitmentMessage(
  channel: RecruitmentMessageGateway,
  input: {
    operationKey: string;
    content: string;
    createdAfter: Date;
  },
): Promise<Message> {
  const createOptions: MessageCreateOptions = {
    content: input.content,
    embeds: [{
      footer: { text: customGameEventOperationMarker(input.operationKey) },
    }],
    nonce: input.operationKey,
    enforceNonce: true,
  };

  const existingMessage = await findCustomGameRecruitmentMessage(
    channel.messages,
    input,
  );
  if (existingMessage) return existingMessage;

  try {
    return await channel.send(createOptions);
  } catch (firstCreateError) {
    try {
      return await channel.send(createOptions);
    } catch (secondCreateError) {
      try {
        const recoveredMessage = await findCustomGameRecruitmentMessage(
          channel.messages,
          input,
        );
        if (recoveredMessage) return recoveredMessage;
      } catch (recoveryError) {
        throw new AggregateError(
          [firstCreateError, secondCreateError, recoveryError],
          "Discord recruitment message creation outcome is ambiguous",
        );
      }
      throw new AggregateError(
        [firstCreateError, secondCreateError],
        "Discord recruitment message creation failed",
      );
    }
  }
}
