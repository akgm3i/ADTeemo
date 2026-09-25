import { messageHandler, messageKeys } from "../messages.ts";
import {
  type CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { selectOwnedCustomGameEvent } from "../features/custom_game_selection.ts";

export const data = new SlashCommandBuilder().setName("next-game")
  .setDescription(
    "同じイベントの参加者をロビーへ戻し、次ゲームの記録番号を確認します。",
  )
  .addIntegerOption((option) =>
    option.setName("event").setDescription("対象イベントID").setRequired(true)
      .setMinValue(1)
  );
export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const event = await selectOwnedCustomGameEvent({
      guildId: interaction.guild.id,
      recruitmentChannelId: interaction.channelId,
      creatorId: interaction.user.id,
      eventId: interaction.options.getInteger("event", true),
    });
    const scope = {
      guildId: interaction.guild.id,
      recruitmentChannelId: interaction.channelId,
    };
    const [settings, roster, next] = await Promise.all([
      apiClient.getCustomGameSettings(scope.guildId),
      apiClient.getCustomGameEventParticipants(event.id, scope),
      apiClient.getNextCustomGameSequence(event.id, scope),
    ]);
    if (!settings.success || !roster.success || !next.success) {
      throw new Error(
        messageHandler.formatMessage(
          messageKeys.customGame.flow.nextFetchFailed,
        ),
      );
    }
    if (!settings.settings) {
      throw new Error(
        messageHandler.formatMessage(messageKeys.customGame.flow.setupRequired),
      );
    }
    const members = await interaction.guild.members.fetch({
      user: roster.participants.map((participant) => participant.userId),
    });
    if (members.size !== roster.participants.length) {
      throw new Error(
        messageHandler.formatMessage(
          messageKeys.customGame.flow.missingParticipants,
        ),
      );
    }
    await Promise.all(
      members.map((member) =>
        member.voice.setChannel(settings.settings!.lobbyChannelId)
      ),
    );
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.customGame.flow.nextReady, {
        game: next.gameSequence,
        eventId: event.id,
      }),
    );
  } catch (error) {
    await interaction.editReply(
      error instanceof Error
        ? error.message
        : messageHandler.formatMessage(messageKeys.customGame.flow.nextFailed),
    );
  }
}
