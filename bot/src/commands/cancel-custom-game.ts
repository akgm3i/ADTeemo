import {
  ActionRowBuilder,
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("cancel-custom-game")
  .setDescription("自分が作成したカスタムゲームイベントをキャンセルします。")
  .addIntegerOption((option) =>
    option.setName("event").setDescription(
      "キャンセルするイベントID（候補が多い場合に指定）",
    ).setMinValue(1)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }

  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const creatorId = interaction.user.id;
  const dbEventsResult = await apiClient.getCustomGameEventsByCreator(
    interaction.guild.id,
    interaction.channel.id,
    creatorId,
  );

  if (!dbEventsResult.success) {
    await interaction.editReply(
      messageHandler.formatMessage(
        messageKeys.customGame.cancel.error.fetchEvents,
      ),
    );
    return;
  }

  const eventId = interaction.options.getInteger("event");
  const events = eventId === null
    ? dbEventsResult.events
    : dbEventsResult.events.filter((event) => event.id === eventId);

  if (events.length === 0) {
    await interaction.editReply(
      messageHandler.formatMessage(
        messageKeys.customGame.cancel.info.noActiveEvents,
      ),
    );
    return;
  }

  const options = events.slice(0, 25).map((event) => ({
    label: event.name,
    value: String(event.id),
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("cancel-event-select")
    .setPlaceholder(
      messageHandler.formatMessage(
        messageKeys.customGame.cancel.info.selectPlaceholder,
      ),
    )
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>()
    .addComponents(selectMenu);

  await interaction.editReply({
    content: messageHandler.formatMessage(
      messageKeys.customGame.cancel.info.selectMessage,
    ),
    components: [row],
  });
}
