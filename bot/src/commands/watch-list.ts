import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { MatchWatcher } from "@adteemo/api/schema";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const DISCORD_CONTENT_LIMIT = 2000;

export const data = new SlashCommandBuilder()
  .setName("watch-list")
  .setDescription("現在のLoL試合監視対象一覧を表示します。");

function buildWatchListContent(watchers: MatchWatcher[]) {
  if (watchers.length === 0) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.watchList.empty,
    );
  }

  const header = messageHandler.formatMessage(
    messageKeys.matchTracking.watchList.header,
  );
  const lines = watchers.map((watcher, index) => {
    const position = index + 1;
    return messageHandler.formatMessage(
      messageKeys.matchTracking.watchList.item,
      {
        position,
        targetId: watcher.targetDiscordId,
        channelId: watcher.channelId,
      },
    );
  });
  const selected = [header];

  for (const line of lines) {
    const next = [...selected, line].join("\n");
    if (next.length > DISCORD_CONTENT_LIMIT) break;
    selected.push(line);
  }

  if (lines.length === selected.length - 1) {
    return selected.join("\n");
  }

  while (selected.length > 1) {
    const omitted = lines.length - (selected.length - 1);
    const footer = messageHandler.formatMessage(
      messageKeys.matchTracking.watchList.omitted,
      { count: omitted },
    );
    const next = [...selected, footer].join("\n");
    if (next.length <= DISCORD_CONTENT_LIMIT) {
      return next;
    }
    selected.pop();
  }

  return `${header}\n${
    messageHandler.formatMessage(
      messageKeys.matchTracking.watchList.omitted,
      { count: watchers.length },
    )
  }`;
}

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await apiClient.getEnabledMatchWatchersByGuild(
    interaction.guildId,
  );

  if (!result.success) {
    await interaction.editReply({
      content: messageHandler.formatMessage(
        messageKeys.matchTracking.watchList.error.fetch,
        { error: result.error },
      ),
    });
    return;
  }

  await interaction.editReply({
    content: buildWatchListContent(result.watchers),
  });
}
