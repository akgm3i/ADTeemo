import {
  ActionRowBuilder,
  CommandInteraction,
  GuildScheduledEventStatus,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { CustomGameEvent } from "../types.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("cancel-custom-game")
  .setDescription("Cancels a custom game event you created.");

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const creatorId = interaction.user.id;
  const dbEventsResult = await apiClient.getCustomGameEventsByCreatorId(
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

  if (!interaction.guild) {
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.common.info.guildOnlyCommand),
    );
    return;
  }

  const discordEvents = await interaction.guild.scheduledEvents.fetch();
  const activeEvents = (dbEventsResult.events as CustomGameEvent[]).filter(
    (dbEvent: CustomGameEvent) => {
      const discordEvent = discordEvents.get(dbEvent.discordScheduledEventId);
      return discordEvent &&
        discordEvent.status !== GuildScheduledEventStatus.Completed &&
        discordEvent.status !== GuildScheduledEventStatus.Canceled;
    },
  );

  if (activeEvents.length === 0) {
    await interaction.editReply(
      messageHandler.formatMessage(
        messageKeys.customGame.cancel.info.noActiveEvents,
      ),
    );
    return;
  }

  const options = activeEvents.map((event: CustomGameEvent) => ({
    label: event.name,
    value: `${event.discordScheduledEventId}:${event.recruitmentMessageId}`,
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
