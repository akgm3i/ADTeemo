import { messageHandler, messageKeys } from "../messages.ts";
import {
  ActionRowBuilder,
  type CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";

export const data = new SlashCommandBuilder().setName("start-matching")
  .setDescription("作成済みイベントを選び、参加者を確定してチーム分けします。");
export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await apiClient.getCustomGameEventsByCreator(
    interaction.guild.id,
    interaction.channelId,
    interaction.user.id,
  );
  if (!result.success) {
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.customGame.flow.fetchFailed),
    );
    return;
  }
  const events = result.events.filter((event) =>
    event.phase === "RECRUITING" && event.syncState === "CONSISTENT"
  );
  if (!events.length) {
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.customGame.flow.noEvents),
    );
    return;
  }
  const select = new StringSelectMenuBuilder().setCustomId("split-event-select")
    .setPlaceholder(
      messageHandler.formatMessage(
        messageKeys.customGame.flow.selectPlaceholder,
      ),
    ).addOptions(
      events.slice(0, 25).map((event) => ({
        label: `${event.id}: ${event.name}`.slice(0, 100),
        value: String(event.id),
      })),
    );
  await interaction.editReply({
    content: messageHandler.formatMessage(
      messageKeys.customGame.flow.selectPrompt,
    ),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
  });
}
