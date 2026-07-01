import type { EmbedBuilder } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";

export type WatcherMessage = {
  id?: string;
  edit?: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};
export type WatcherChannel = {
  send?: (options: { embeds: EmbedBuilder[] }) => Promise<WatcherMessage>;
  messages?: {
    fetch?: (messageId: string) => Promise<WatcherMessage>;
  };
};
export type MatchTrackingNotifierDependencies = {
  client: {
    channels: {
      fetch: (channelId: string) => Promise<WatcherChannel | null>;
    };
  };
  logger: {
    warn: (message: string, metadata?: Record<string, unknown>) => void;
    error: (
      message: string,
      metadata?: Record<string, unknown>,
      error?: unknown,
    ) => void;
  };
};

export function createMatchTrackingNotifier(
  dependencies: MatchTrackingNotifierDependencies,
) {
  async function sendOrEditWatcherMessage(
    watcher: MatchWatcher,
    messageId: string | null | undefined,
    embed: EmbedBuilder,
  ) {
    try {
      const channel = await dependencies.client.channels.fetch(
        watcher.channelId,
      );
      if (!channel?.send) {
        dependencies.logger.warn("match_tracking.channel_not_found", {
          guildId: watcher.guildId,
          channelId: watcher.channelId,
        });
        return messageId ?? null;
      }

      if (messageId && channel.messages?.fetch) {
        try {
          const message = await channel.messages.fetch(messageId);
          if (!message.edit) {
            throw new Error("message.edit is not available");
          }
          await message.edit({ embeds: [embed] });
          return message.id ?? messageId;
        } catch (error) {
          dependencies.logger.warn("match_tracking.edit_message_failed", {
            guildId: watcher.guildId,
            channelId: watcher.channelId,
            messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const message = await channel.send({ embeds: [embed] });
      return message.id ?? null;
    } catch (error) {
      dependencies.logger.error("match_tracking.send_message_failed", {
        guildId: watcher.guildId,
        channelId: watcher.channelId,
      }, error);
      return messageId ?? null;
    }
  }

  return { sendOrEditWatcherMessage };
}
