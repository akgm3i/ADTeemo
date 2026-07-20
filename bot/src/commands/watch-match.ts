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
    const content = result.status === 404 &&
        result.code === "RIOT_ACCOUNT_NOT_FOUND"
      ? messageHandler.formatMessage(
        messageKeys.matchTracking.watch.error.riotAccountRequired,
        { member: String(target) },
      )
      : messageHandler.formatMessage(
        messageKeys.matchTracking.watch.error.failure,
        { member: String(target), error: result.error },
      );
    await interaction.editReply({
      content,
    });
    return;
  }

  await interaction.editReply({
    content: messageHandler.formatMessage(
      messageKeys.matchTracking.watch.success,
      {
        member: String(target),
      },
    ),
  });
}
