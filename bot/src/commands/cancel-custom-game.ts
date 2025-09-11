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
    await interaction.editReply("Failed to fetch your events.");
    return;
  }

  if (!interaction.guild) {
    await interaction.editReply("This command can only be used in a server.");
    return;
  }

  const discordEvents = await interaction.guild.scheduledEvents.fetch();
  const activeEvents = (dbEventsResult.events as CustomGameEvent[]).filter((
    dbEvent: CustomGameEvent,
  ) => {
    const discordEvent = discordEvents.get(dbEvent.discordScheduledEventId);
    return discordEvent &&
      discordEvent.status !== GuildScheduledEventStatus.Completed &&
      discordEvent.status !== GuildScheduledEventStatus.Canceled;
  });

  if (activeEvents.length === 0) {
    await interaction.editReply("You have no active events to cancel.");
    return;
  }

  const options = activeEvents.map((event: CustomGameEvent) => ({
    label: event.name,
    value: `${event.discordScheduledEventId}:${event.recruitmentMessageId}`,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("cancel-event-select")
    .setPlaceholder("Select an event to cancel")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>()
    .addComponents(selectMenu);

  await interaction.editReply({
    content: "Select an event to cancel:",
    components: [row],
  });
}
