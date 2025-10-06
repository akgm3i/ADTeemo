import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { type Lane, lanes } from "@adteemo/api/schema";
import { ROLE_DISPLAY_NAMES } from "../constants.ts";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("set-main-role")
  .setDescription("カスタムゲームでのメインロールを登録します。")
  .addStringOption((option) =>
    option.setName("role")
      .setDescription("メインロールとして登録するロール")
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
      messageHandler.formatMessage(
        messageKeys.userManagement.setMainRole.success,
        { role },
      ),
    );
  } else {
    await interaction.editReply(
      messageHandler.formatMessage(
        messageKeys.userManagement.setMainRole.failure,
        {
          error: result.error || "",
        },
      ),
    );
  }
}
