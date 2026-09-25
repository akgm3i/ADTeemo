import {
  type CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";
export const data = new SlashCommandBuilder().setName("watch-preference")
  .setDescription("このサーバーで自分の全アカウントの監視を停止・再開します。")
  .addStringOption((option) =>
    option.setName("action").setDescription("監視の設定").setRequired(true)
      .addChoices({ name: "停止する", value: "opt-out" }, {
        name: "監視を許可する",
        value: "opt-in",
      })
  );
export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const optOut = interaction.options.getString("action", true) === "opt-out";
  const result = await apiClient.setMatchWatchOptOut(
    interaction.guildId,
    interaction.user.id,
    optOut,
  );
  await interaction.editReply({
    content: messageHandler.formatMessage(
      result.success
        ? (optOut
          ? messageKeys.watchPolicy.optOut
          : messageKeys.watchPolicy.optIn)
        : messageKeys.watchPolicy.error,
    ),
  });
}
