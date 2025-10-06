import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Botとバックエンドの稼働状況を確認します。");

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await apiClient.checkHealth();

  if (!result.success) {
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.health.error.failure, {
        error: result.error,
      }),
    );
    return;
  }

  await interaction.editReply(result.message);
}
