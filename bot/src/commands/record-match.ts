import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient, type CustomMatchStat } from "../api_client.ts";
import { failureKind, type FailureResult } from "../api_clients/transport.ts";
import {
  recordMatchParticipantProvider,
  RecordMatchParticipantProviderError,
} from "../features/record_match_participants.ts";
import {
  type StatCollectionResult,
  statCollector,
} from "../features/stat_collector.ts";
import { botLogger, correlationIdForInteraction } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("record-match")
  .setDescription("カスタムゲームの結果を対話形式で記録します。")
  .addStringOption((option) =>
    option.setName("winner")
      .setDescription("勝利したチーム")
      .setRequired(true)
      .addChoices(
        { name: "ブルーチーム", value: "BLUE" },
        { name: "レッドチーム", value: "RED" },
      )
  )
  .addIntegerOption((option) =>
    option.setName("game")
      .setDescription("イベント内の試合番号（省略時は1）")
      .setRequired(false)
      .setMinValue(1)
  )
  .addIntegerOption((option) =>
    option.setName("event").setDescription("記録するイベントID").setMinValue(1)
  );

type Team = "BLUE" | "RED";

type Stats = {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
};

type CollectedValue<T> =
  | { complete: true; value: T }
  | { complete: false };

function recordMatchFailureMessage(reason: string) {
  return messageHandler.formatMessage(
    messageKeys.matchManagement.recordMatch.failure,
    { error: reason },
  );
}

function isInteractionCollectorTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "InteractionCollectorError" &&
    typeof candidate.message === "string" &&
    candidate.message.endsWith("reason: time");
}

export function recordMatchFailureReason(failure: FailureResult): string {
  switch (failureKind(failure)) {
    case "http":
      if (failure.code === "INTERNAL_ERROR") {
        return messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.failureReason.database,
        );
      }
      return messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.api,
      );
    case "communication":
      return messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.communication,
      );
    case "contract":
      return messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.contract,
      );
    case "unknown":
      return messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.unknown,
      );
  }
}

async function collectedValue<T>(
  interaction: CommandInteraction,
  result: StatCollectionResult<T>,
): Promise<CollectedValue<T>> {
  if (result.status === "value") {
    return { complete: true, value: result.value };
  }

  if (result.status === "failure") {
    botLogger.error("command.record_match.stat_collection_failed", {
      correlationId: correlationIdForInteraction(interaction),
      errorCategory: "remote_api",
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }, result.error);
  }
  const content = result.status === "timeout"
    ? messageHandler.formatMessage(
      messageKeys.matchManagement.recordMatch.timeout,
    )
    : result.status === "cancelled"
    ? messageHandler.formatMessage(
      messageKeys.matchManagement.recordMatch.cancelled,
    )
    : recordMatchFailureMessage(
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.input,
      ),
    );
  await interaction.editReply(content).catch(() => {});
  return { complete: false };
}

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (
    !interaction.inGuild() || !interaction.guild || !interaction.guildId ||
    !interaction.channel?.isTextBased()
  ) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const winningTeam = interaction.options.getString("winner", true) as Team;
    const gameSequence = interaction.options.getInteger("game") ?? 1;
    const activeMatch = await recordMatchParticipantProvider
      .getActiveParticipants({
        guild: interaction.guild,
        guildId: interaction.guildId,
        recruitmentChannelId: interaction.channelId,
        creatorId: interaction.user.id,
        ...(interaction.options.getInteger("event") !== null
          ? { eventId: interaction.options.getInteger("event")! }
          : {}),
      });
    const { event, participants } = activeMatch;
    const allStats = new Map<string, Stats>();

    for (const participant of participants) {
      const kdaResult = await collectedValue(
        interaction,
        await statCollector.askForStat<string>(
          interaction,
          participant.user.username,
          /^\d+\/\d+\/\d+$/,
          messageKeys.matchManagement.recordMatch.promptKDA,
          messageKeys.matchManagement.recordMatch.invalidFormatKDA,
        ),
      );
      if (!kdaResult.complete) return;
      const [kills, deaths, assists] = kdaResult.value.split("/").map(Number);

      const csResult = await collectedValue(
        interaction,
        await statCollector.askForStat<number>(
          interaction,
          participant.user.username,
          /^\d+$/,
          messageKeys.matchManagement.recordMatch.promptCS,
          messageKeys.matchManagement.recordMatch.invalidFormatNumber,
        ),
      );
      if (!csResult.complete) return;

      const goldResult = await collectedValue(
        interaction,
        await statCollector.askForStat<number>(
          interaction,
          participant.user.username,
          /^\d+$/,
          messageKeys.matchManagement.recordMatch.promptGold,
          messageKeys.matchManagement.recordMatch.invalidFormatNumber,
        ),
      );
      if (!goldResult.complete) return;

      allStats.set(participant.user.id, {
        kills,
        deaths,
        assists,
        cs: csResult.value,
        gold: goldResult.value,
      });
    }

    const summaryEmbed = new EmbedBuilder()
      .setTitle(
        messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.summaryTitle,
        ),
      )
      .setDescription(
        messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.summaryDescription,
        ),
      );

    for (const participant of participants) {
      const stats = allStats.get(participant.user.id)!;
      summaryEmbed.addFields({
        name: `${participant.user.username} (${participant.lane})`,
        value:
          `${stats.kills}/${stats.deaths}/${stats.assists} - ${stats.cs}cs - ${stats.gold}g`,
        inline: false,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_record_match")
        .setLabel(
          messageHandler.formatMessage(
            messageKeys.matchManagement.recordMatch.confirmButton,
          ),
        )
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cancel_record_match")
        .setLabel(
          messageHandler.formatMessage(
            messageKeys.matchManagement.recordMatch.cancelButton,
          ),
        )
        .setStyle(ButtonStyle.Danger),
    );

    const reply = await interaction.editReply({
      embeds: [summaryEmbed],
      components: [row],
    });
    const confirmationResult = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 60000,
    }).then(
      (confirmation) => ({ status: "value" as const, confirmation }),
      (error: unknown) =>
        isInteractionCollectorTimeout(error)
          ? { status: "timeout" as const }
          : { status: "failure" as const, error },
    );

    if (confirmationResult.status === "timeout") {
      await interaction.editReply({
        content: messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.timeout,
        ),
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    if (confirmationResult.status === "failure") {
      botLogger.error("command.record_match.confirmation_failed", {
        correlationId: correlationIdForInteraction(interaction),
        errorCategory: "remote_api",
        guildId: interaction.guildId,
        userId: interaction.user.id,
      }, confirmationResult.error);
      await interaction.editReply({
        content: recordMatchFailureMessage(
          messageHandler.formatMessage(
            messageKeys.matchManagement.recordMatch.failureReason.input,
          ),
        ),
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    const { confirmation } = confirmationResult;

    if (confirmation.customId !== "confirm_record_match") {
      await confirmation.update({
        content: messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.cancelled,
        ),
        embeds: [],
        components: [],
      });
      return;
    }

    await confirmation.update({
      content: messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.start,
      ),
      embeds: [],
      components: [],
    });
    const stats: CustomMatchStat[] = participants.map((participant) => ({
      userId: participant.user.id,
      ...allStats.get(participant.user.id)!,
    }));
    const result = await apiClient.recordCustomMatch({
      eventId: event.id,
      guildId: interaction.guildId,
      recruitmentChannelId: interaction.channelId,
      gameSequence,
      winner: winningTeam,
      stats,
    });
    if (!result.success) {
      await interaction.followUp({
        content: recordMatchFailureMessage(recordMatchFailureReason(result)),
        ephemeral: true,
      });
      return;
    }

    await interaction.followUp({
      content: messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.success,
      ),
      ephemeral: true,
    });
  } catch (error) {
    botLogger.error("command.record_match.failed", {
      correlationId: correlationIdForInteraction(interaction),
      errorCategory: "unexpected",
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }, error);
    const reason = error instanceof RecordMatchParticipantProviderError
      ? recordMatchFailureReason(error.failure)
      : messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.unknown,
      );
    const content = recordMatchFailureMessage(reason);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content,
        embeds: [],
        components: [],
      }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
}
