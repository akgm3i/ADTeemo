import { CommandInteraction,MessageFlags, SlashCommandBuilder } from "discord.js";
import { apiClient } from "../api_client.ts";
import { formatMessage, messageKeys } from "../messages.ts";

// Exported for testing purposes
export const testable = {
  formatMessage,
};

export const data = new SlashCommandBuilder()
  .setName("set-riot-id")
  .setDescription("Riot IDを登録・更新します。(例: Faker#KR1)")
  .addStringOption((option) =>
    option
      .setName("riot-id")
      .setDescription("サモナー名#タグライン の形式で入力してください。")
      .setRequired(true)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const riotId = interaction.options.getString("riot-id", true);
  const parts = riotId.split("#");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await interaction.editReply({
        content: testable.formatMessage(messageKeys.riotAccount.link.error.invalidFormat),
      });
    return;
  }

  const [gameName, tagLine] = parts;

  const result = await apiClient.linkAccountByRiotId(
    interaction.user.id,
    gameName,
    tagLine,
  );

  if (!result.success) {
    await interaction.editReply({
      content: testable.formatMessage(messageKeys.riotAccount.link.error.generic, {
        error: result.error || "",
      })
    });
  }

  await interaction.editReply({
    content: testable.formatMessage(messageKeys.riotAccount.link.success.title)
  });
}
