import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("unwatch-match")
  .setDescription("指定したメンバーのLoL試合監視を停止します。")
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("監視を停止するメンバー")
      .setRequired(true)
  );

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

  const target = interaction.options.getUser("member", true);
  const result = await apiClient.unwatchMatch(interaction.guildId, target.id);

  if (!result.success) {
    await interaction.editReply({
      content: `${target} の試合監視を停止できませんでした。`,
    });
    return;
  }

  await interaction.editReply({
    content: `${target} の試合監視を停止しました。`,
  });
}
