import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "npm:discord.js";
import { apiClient } from "../api_client.ts";

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Checks the health of the bot.");

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await apiClient.checkHealth();

  if (result.success && result.message) {
    await interaction.editReply(result.message);
  } else {
    await interaction.editReply(
      `Failed to check the bot's health. ${result.error || ""}`,
    );
  }
}
