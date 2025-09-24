import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { apiClient } from "../api_client.ts";
import { formatMessage, messageKeys } from "../messages.ts";

// Exported for testing purposes
export const testable = {
  apiClient,
};

export const data = new SlashCommandBuilder()
  .setName("link-riot-account")
  .setDescription("Riot GamesアカウントをBotに連携します。");

export async function execute(interaction: CommandInteraction) {
  const discordId = interaction.user.id;

  const result = await testable.apiClient.getLoginUrl(discordId);

  if (!result.success || !result.url) {
    await interaction.reply({
      content: formatMessage(messageKeys.riotAccount.link.error.generic, {
        error: result.error ||
          formatMessage(messageKeys.riotAccount.link.error.urlNotFound),
      }),
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: formatMessage(messageKeys.riotAccount.link.instructions, {
      url: result.url,
    }),
    ephemeral: true,
  });
}
