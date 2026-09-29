import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { failureKind, type FailureResult } from "../api_clients/transport.ts";
import {
  recordMatchParticipantProvider,
  RecordMatchParticipantProviderError,
} from "../features/record_match_participants.ts";
import {
  createStatSession,
  statCollector,
  type StatSession,
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

const keys = messageKeys.matchManagement.recordMatch;

function failureMessage(reason: string) {
  return messageHandler.formatMessage(keys.failure, { error: reason });
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
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let session: StatSession | undefined;
  let saveAttempted = false;
  try {
    const winner = interaction.options.getString("winner", true) as
      | "BLUE"
      | "RED";
    const gameSequence = interaction.options.getInteger("game") ?? 1;
    const { event, participants } = await recordMatchParticipantProvider
      .getActiveParticipants({
        guild: interaction.guild,
        guildId: interaction.guildId,
        recruitmentChannelId: interaction.channelId,
        creatorId: interaction.user.id,
        ...(interaction.options.getInteger("event") !== null
          ? { eventId: interaction.options.getInteger("event")! }
          : {}),
      });
    session = createStatSession(interaction, {
      eventId: event.id,
      gameSequence,
      winner,
    });
    const collected = await statCollector.collectStats(session, participants);
    if (collected.status !== "complete") {
      if (collected.status === "failure") {
        botLogger.error("command.record_match.stat_collection_failed", {
          correlationId: correlationIdForInteraction(interaction),
          errorCategory: "remote_api",
          guildId: interaction.guildId,
          userId: interaction.user.id,
        }, collected.error);
      }
      await session.render(
        collected.status === "failure"
          ? failureMessage(
            messageHandler.formatMessage(keys.failureReason.input),
          )
          : messageHandler.formatMessage(
            collected.status === "cancelled" ? keys.cancelled : keys.expired,
          ),
      );
      return;
    }
    // Keep this exact payload across explicit retries, including uncertain commits.
    const payload = {
      eventId: event.id,
      guildId: interaction.guildId,
      recruitmentChannelId: interaction.channelId,
      gameSequence,
      winner,
      stats: collected.stats,
    };
    let content = messageHandler.formatMessage(keys.summaryDescription);
    let label = messageHandler.formatMessage(keys.confirmButton);
    while (true) {
      const confirmation = await session.waitForButton(
        content,
        "confirm_record_match",
        label,
      );
      if (confirmation.status !== "value") {
        await session.render(
          messageHandler.formatMessage(
            saveAttempted
              ? keys.saveUnconfirmed
              : confirmation.status === "cancelled"
              ? keys.cancelled
              : keys.expired,
          ),
        );
        return;
      }
      // Acknowledge the fresh confirmation before the Backend request starts.
      await session.accept(confirmation.button);
      await session.render(messageHandler.formatMessage(keys.saving));
      saveAttempted = true;
      const result = await apiClient.recordCustomMatch(payload);
      if (result.success) {
        await session.render(messageHandler.formatMessage(keys.success));
        return;
      }
      content = failureMessage(recordMatchFailureReason(result)) + "\n" +
        messageHandler.formatMessage(keys.retrySave);
      label = messageHandler.formatMessage(keys.retryButton);
    }
  } catch (error) {
    botLogger.error("command.record_match.failed", {
      correlationId: correlationIdForInteraction(interaction),
      errorCategory: "unexpected",
      guildId: interaction.guildId,
      userId: interaction.user.id,
    }, error);
    const reason = error instanceof RecordMatchParticipantProviderError
      ? recordMatchFailureReason(error.failure)
      : messageHandler.formatMessage(keys.failureReason.input);
    const content = saveAttempted
      ? messageHandler.formatMessage(keys.saveUnconfirmed)
      : failureMessage(reason);
    if (session) await session.render(content).catch(() => {});
    else {await interaction.editReply({ content, embeds: [], components: [] })
        .catch(() => {});}
  }
}
