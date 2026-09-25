import type { EmbedBuilder } from "discord.js";
import {
  hasMessageMarker,
  withMessageMarker,
} from "./discord_message_marker.ts";

export type { NotificationFailureReason as DeliveryReason } from "@adteemo/api/contract";
import type { NotificationFailureReason as DeliveryReason } from "@adteemo/api/contract";
export type NotificationResult =
  | { status: "sent" | "edited"; messageId: string }
  | { status: "skipped"; reason: "backoff" | "leased" }
  | {
    status: "retryable_failure" | "permanent_failure";
    reason: DeliveryReason;
  };
export type WatcherMessage = {
  id?: string;
  nonce?: string | number | null;
  embeds?: { footer?: { text: string } | null }[];
  author?: { id: string };
  client?: { user: { id: string } | null };
  createdTimestamp?: number;
  edit?: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};
export type WatcherChannel = {
  send?: (
    options: { embeds: EmbedBuilder[]; nonce?: string; enforceNonce?: boolean },
  ) => Promise<WatcherMessage>;
  messages?: { fetch?: (messageId: string) => Promise<WatcherMessage> };
  history?: (
    options: { limit: number; before?: string },
  ) => Promise<WatcherMessage[]>;
};
export type MatchTrackingNotifierDependencies = {
  client: {
    channels: { fetch: (channelId: string) => Promise<WatcherChannel | null> };
  };
  logger: {
    warn: (
      message: string,
      metadata?: Record<string, unknown>,
      error?: unknown,
    ) => void;
    error: (
      message: string,
      metadata?: Record<string, unknown>,
      error?: unknown,
    ) => void;
  };
};
export type DeliveryAttempt = {
  nonce: string;
  createdAt: number;
  uncertain: boolean;
};

function discordCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

// A lost send response cannot safely be retried after Discord's short nonce window.
// Search the persistent embed marker; inconclusive history stays a failure.
async function recoverMessage(
  channel: WatcherChannel,
  attempt: DeliveryAttempt,
) {
  if (!channel.history) return null;
  let before: string | undefined;
  let found: WatcherMessage | null = null;
  while (true) {
    const page = await channel.history({
      limit: 100,
      ...(before ? { before } : {}),
    });
    for (const message of page) {
      if (hasMessageMarker(message, `ADTeemo delivery:${attempt.nonce}`)) {
        if (found && found.id !== message.id) {
          throw new Error("Ambiguous notification receipt");
        }
        found = message;
      }
    }
    const oldest = page.at(-1);
    if (
      page.length < 100 || !oldest ||
      (oldest.createdTimestamp ?? 0) < attempt.createdAt - 1000
    ) return found;
    if (!oldest.id || oldest.id === before) {
      throw new Error("Notification history did not advance");
    }
    before = oldest.id;
  }
}

export function createMatchTrackingNotifier(
  dependencies: MatchTrackingNotifierDependencies,
) {
  async function sendOrEditWatcherMessage(
    watcher: { guildId: string; channelId: string },
    messageId: string | null | undefined,
    embed: EmbedBuilder,
    attempt?: DeliveryAttempt,
  ): Promise<NotificationResult> {
    function failure(
      reason: DeliveryReason,
      error?: unknown,
    ): NotificationResult {
      const permanent =
        [10003, 50001, 50013].includes(Number(discordCode(error))) ||
        reason === "channel_missing";
      dependencies.logger.warn("match_tracking.delivery_failed", {
        guildId: watcher.guildId,
        channelId: watcher.channelId,
        reason,
        permanent,
      }, error);
      return {
        status: permanent ? "permanent_failure" : "retryable_failure",
        reason,
      };
    }
    let channel;
    try {
      channel = await dependencies.client.channels.fetch(watcher.channelId);
    } catch (error) {
      return failure("channel_fetch", error);
    }
    if (!channel?.send) return failure("channel_missing");

    const markedEmbed = attempt
      ? withMessageMarker(embed, `ADTeemo delivery:${attempt.nonce}`)
      : embed;

    if (messageId) {
      if (!channel.messages?.fetch) return failure("message_fetch");
      let message;
      try {
        message = await channel.messages.fetch(messageId);
      } catch (error) {
        if (discordCode(error) !== 10008) {
          return failure("message_fetch", error);
        }
      }
      if (message) {
        if (!message.edit) return failure("edit");
        try {
          await message.edit({ embeds: [markedEmbed] });
          return { status: "edited", messageId: message.id ?? messageId };
        } catch (error) {
          if (discordCode(error) !== 10008) return failure("edit", error);
        }
      }
    }

    if (attempt?.uncertain) {
      try {
        const recovered = await recoverMessage(channel, attempt);
        if (recovered?.id) return { status: "sent", messageId: recovered.id };
        return failure("reconciliation");
      } catch (error) {
        return failure("reconciliation", error);
      }
    }
    try {
      const message = await channel.send({
        embeds: [markedEmbed],
        ...(attempt ? { nonce: attempt.nonce, enforceNonce: true } : {}),
      });
      return message.id
        ? { status: "sent", messageId: message.id }
        : failure("invalid_response");
    } catch (error) {
      return failure("send", error);
    }
  }
  return { sendOrEditWatcherMessage };
}
