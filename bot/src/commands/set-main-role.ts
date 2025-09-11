import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { type Lane, lanes } from "@adteemo/api/schema";
import { ROLE_DISPLAY_NAMES } from "../constants.ts";
import { apiClient } from "../api_client.ts";
import { t, m } from "@adteemo/messages";

export const data = new SlashCommandBuilder()
  .setName("set-main-role")
  .setDescription("Sets your main role for custom games.")
  .addStringOption((option) =>
    option.setName("role")
      .setDescription("The role you want to set as your main.")
      .setRequired(true)
      .addChoices(
        // The `lanes` array is imported directly from the API schema.
        // The `ROLE_DISPLAY_NAMES` provides the user-facing name.
        ...lanes.map((role) => ({
          name: ROLE_DISPLAY_NAMES[role],
          value: role,
        })),
      )
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  const role = interaction.options.getString("role", true) as Lane;
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await apiClient.setMainRole(userId, role);

  if (result.success) {
    await interaction.editReply(
      t(m.userManagement.setMainRole.success, { role }),
    );
  } else {
    await interaction.editReply(
      t(m.userManagement.setMainRole.failure, { error: result.error || "" }),
    );
  }
}
