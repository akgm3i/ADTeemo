import { messageHandler, messageKeys } from "../messages.ts";
import {
  ChannelType,
  type CommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { type Lane, lanes } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { ROLE_DISPLAY_NAMES } from "../constants.ts";

export const data = new SlashCommandBuilder().setName("setup-custom-game")
  .setDescription("カスタムゲームの募集・ロビー・チームVCを設定します。")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option.setName("recruitment").setDescription("募集チャンネル")
      .addChannelTypes(ChannelType.GuildText).setRequired(true)
  )
  .addChannelOption((option) =>
    option.setName("lobby").setDescription("集合用VC").addChannelTypes(
      ChannelType.GuildVoice,
    ).setRequired(true)
  )
  .addChannelOption((option) =>
    option.setName("red").setDescription("Red Team用VC").addChannelTypes(
      ChannelType.GuildVoice,
    ).setRequired(true)
  )
  .addChannelOption((option) =>
    option.setName("blue").setDescription("Blue Team用VC").addChannelTypes(
      ChannelType.GuildVoice,
    ).setRequired(true)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (
    !interaction.guild ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.customGame.flow.permission,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roleIds = {} as Record<Lane, string>;
  for (const lane of lanes) {
    const matching = interaction.guild.roles.cache.filter((role) =>
      role.name === ROLE_DISPLAY_NAMES[lane]
    );
    if (matching.size !== 1) {
      await interaction.editReply(
        messageHandler.formatMessage(messageKeys.customGame.flow.roles),
      );
      return;
    }
    roleIds[lane] = matching.first()!.id;
  }
  const lobbyChannelId = interaction.options.getChannel("lobby", true).id;
  const redChannelId = interaction.options.getChannel("red", true).id;
  const blueChannelId = interaction.options.getChannel("blue", true).id;
  if (new Set([lobbyChannelId, redChannelId, blueChannelId]).size !== 3) {
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.customGame.flow.distinctVc),
    );
    return;
  }
  const result = await apiClient.setCustomGameSettings(interaction.guild.id, {
    recruitmentChannelId:
      interaction.options.getChannel("recruitment", true).id,
    lobbyChannelId,
    redChannelId,
    blueChannelId,
    roleIds,
  });
  await interaction.editReply(
    result.success
      ? messageHandler.formatMessage(messageKeys.customGame.flow.saved)
      : messageHandler.formatMessage(messageKeys.customGame.flow.saveFailed),
  );
}
