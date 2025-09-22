import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { apiClient } from "../api_client.ts";
import { Command } from "../types.ts";

// Exported for testing purposes
export const testable = {
  apiClient,
};

export async function execute(interaction: CommandInteraction) {
  const discordId = interaction.user.id;

  const result = await testable.apiClient.getLoginUrl(discordId);

  if (!result.success || !result.url) {
    await interaction.reply({
      content: `エラーが発生しました: ${
        result.error || "URLが取得できませんでした。"
      }`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content:
      `Riot Gamesアカウントと連携するには、以下のリンクにアクセスして認証を完了してください。\n\n${result.url}`,
    ephemeral: true,
  });
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("link-riot-account")
    .setDescription("Riot GamesアカウントをBotに連携します。"),
  execute,
};
