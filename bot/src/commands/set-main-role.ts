import { CommandInteraction, SlashCommandBuilder } from "npm:discord.js";
import { type Lane, lanes } from "@adteemo/api/schema";
import * as apiClient from "../api_client.ts";

export const data = new SlashCommandBuilder()
  .setName("set-main-role")
  .setDescription("Sets your main role for custom games.")
  .addStringOption((option) =>
    option.setName("role")
      .setDescription("The role you want to set as your main.")
      .setRequired(true)
      .addChoices(
        ...lanes.map((lane) => ({ name: lane, value: lane })),
      )
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  const role = interaction.options.getString("role", true) as Lane;
  const userId = interaction.user.id;

  await interaction.deferReply({ ephemeral: true });

  const result = await apiClient.setMainRole(userId, role);

  if (result.success) {
    await interaction.editReply(`Your main role has been set to **${role}**.`);
  } else {
    await interaction.editReply(
      `Failed to set your main role. ${result.error || ""}`,
    );
  }
}
