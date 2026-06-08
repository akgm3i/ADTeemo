import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("watch-match")
  .setDescription("指定したメンバーのLoL試合を継続監視します。")
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("監視するメンバー")
      .setRequired(true)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (
    !interaction.inGuild() || !interaction.guildId || !interaction.channelId
  ) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser("member", true);
  const result = await apiClient.watchMatch({
    guildId: interaction.guildId,
    targetDiscordId: target.id,
    requesterId: interaction.user.id,
    channelId: interaction.channelId,
  });

  if (!result.success) {
    await interaction.editReply({
      content:
        `${target} のRiot ID連携が見つからないため、試合監視を開始できませんでした。先に /set-riot-id を実行してください。`,
    });
    return;
  }

  await interaction.editReply({
    content: `${target} の試合監視を開始しました。このチャンネルに通知します。`,
  });
}
