import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { formatMessage, messageKeys } from "../messages.ts";
import { matchTracker } from "../features/match_tracking.ts";
import { apiClient, type MatchParticipant } from "../api_client.ts";
import { statCollector } from "../features/stat_collector.ts";
import { v4 as uuidv4 } from "uuid";
import { MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("record-match")
  .setDescription("Records the results of a custom game through conversation.")
  .addStringOption((option) =>
    option.setName("winning_team")
      .setDescription("The team that won the game.")
      .setRequired(true)
      .addChoices(
        { name: "Blue Team", value: "BLUE" },
        { name: "Red Team", value: "RED" },
      )
  );

type Team = "BLUE" | "RED";

type Stats = {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
};

export async function execute(interaction: CommandInteraction) {
  if (
    !interaction.isChatInputCommand() ||
    !interaction.channel?.isTextBased()
  ) {
    return;
  }

  try {
    const winningTeam = interaction.options.getString(
      "winning_team",
      true,
    ) as Team;

    const reply = await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const participants = await matchTracker.getActiveParticipants();
    const allStats: Map<string, Stats> = new Map();

    for (const participant of participants) {
      const stats: Partial<Stats> = {};

      const kdaString = await statCollector.askForStat<string>(
        interaction,
        participant.user.username,
        /^\d+\/\d+\/\d+$/,
        messageKeys.matchManagement.recordMatch.promptKDA,
        messageKeys.matchManagement.recordMatch.invalidFormatKDA,
      );
      if (kdaString === null) return; // Timeout
      const [k, d, a] = kdaString.split("/").map(Number);
      stats.kills = k;
      stats.deaths = d;
      stats.assists = a;

      const cs = await statCollector.askForStat<number>(
        interaction,
        participant.user.username,
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );
      if (cs === null) return;
      stats.cs = cs;

      const gold = await statCollector.askForStat<number>(
        interaction,
        participant.user.username,
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptGold,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );
      if (gold === null) return;
      stats.gold = gold;

      allStats.set(participant.user.id, stats as Stats);
    }

    const summaryEmbed = new EmbedBuilder()
      .setTitle(
        formatMessage(messageKeys.matchManagement.recordMatch.summaryTitle),
      )
      .setDescription(
        formatMessage(
          messageKeys.matchManagement.recordMatch.summaryDescription,
        ),
      );

    for (const participant of participants) {
      const stats = allStats.get(participant.user.id);
      if (stats) {
        summaryEmbed.addFields({
          name: `${participant.user.username} (${participant.lane})`,
          value:
            `${stats.kills}/${stats.deaths}/${stats.assists} - ${stats.cs}cs - ${stats.gold}g`,
          inline: false,
        });
      }
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_record_match")
        .setLabel(
          formatMessage(messageKeys.matchManagement.recordMatch.confirmButton),
        )
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cancel_record_match")
        .setLabel(
          formatMessage(messageKeys.matchManagement.recordMatch.cancelButton),
        )
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({ embeds: [summaryEmbed], components: [row] });

    const confirmation = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 60000,
    }).catch(() => null);

    if (!confirmation) {
      await interaction.editReply({
        content: formatMessage(messageKeys.matchManagement.recordMatch.timeout),
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    if (confirmation.customId === "confirm_record_match") {
      await confirmation.update({
        content: "Submitting results...",
        embeds: [],
        components: [],
      });

      const matchId = uuidv4();
      for (const participant of participants) {
        const stats = allStats.get(participant.user.id);
        if (stats) {
          const participantData: MatchParticipant = {
            userId: participant.user.id,
            team: participant.team,
            win: participant.team === winningTeam,
            lane: participant.lane,
            ...stats,
          };
          await apiClient.createMatchParticipant(matchId, participantData);
        }
      }
      await interaction.followUp({
        content: formatMessage(messageKeys.matchManagement.recordMatch.success),
        ephemeral: true,
      });
    } else {
      await confirmation.update({
        content: formatMessage(
          messageKeys.matchManagement.recordMatch.cancelled,
        ),
        embeds: [],
        components: [],
      });
    }
  } catch (e) {
    console.error("Error in record-match command:", e);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: formatMessage(messageKeys.common.error.command),
        embeds: [],
        components: [],
      }).catch(() => {}); // Ignore error if interaction is no longer valid
    }
  }
}
