import {
  ChannelType,
  type CommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";
export const data = new SlashCommandBuilder().setName("watch-settings")
  .setDescription("サーバー全体の試合監視と通知先を設定します。")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option.setName("mode").setDescription("監視の有効・無効").setRequired(true)
      .addChoices({ name: "有効", value: "enabled" }, {
        name: "無効",
        value: "disabled",
      })
  )
  .addChannelOption((option) =>
    option.setName("channel").setDescription("通知先（有効化時は必須）")
      .addChannelTypes(ChannelType.GuildText)
  );
export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  const channel = interaction.options.getChannel("channel");
  const enabled = interaction.options.getString("mode", true) === "enabled";
  if (
    !interaction.guild ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (enabled && !channel)
  ) {
    await interaction.reply({
      content: messageHandler.formatMessage(messageKeys.watchPolicy.permission),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // ClientReady and Gateway membership events keep the complete snapshot fresh.
  const result = await apiClient.setGuildMatchWatchSettings({
    guildId: interaction.guild.id,
    enabled,
    notificationChannelId: channel?.id ?? null,
  });
  await interaction.editReply({
    content: result.success
      ? messageHandler.formatMessage(messageKeys.watchPolicy.saved, {
        count: result.limitedAccountCount,
      })
      : messageHandler.formatMessage(messageKeys.watchPolicy.error),
  });
}
