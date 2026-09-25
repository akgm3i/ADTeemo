import {
  ChannelType,
  CommandInteraction,
  type Message,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { format, parse } from "@std/datetime";
import { apiClient } from "../api_client.ts";
import { ROLE_EMOJIS } from "../constants.ts";
import {
  findCustomGameRecruitmentMessage,
  findCustomGameScheduledEvent,
  findOrCreateCustomGameRecruitmentMessage,
  findOrCreateCustomGameScheduledEvent,
} from "../features/custom_game_event_discord.ts";
import { createCustomGameEventSaga } from "../features/custom_game_event_saga.ts";
import { botLogger, correlationIdForInteraction } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const customGameEventSaga = createCustomGameEventSaga(apiClient);

function parseDate(dateStr: string, timeStr: string): Date | null {
  const now = new Date(Date.now());
  const year = now.getFullYear();

  let targetDate: Date;
  try {
    targetDate = parse(`${year}/${dateStr} ${timeStr}`, "yyyy/MM/dd HH:mm");
  } catch {
    return null;
  }

  if (targetDate < now) {
    targetDate.setFullYear(targetDate.getFullYear() + 1);
  }

  return targetDate;
}

export const data = new SlashCommandBuilder()
  .setName("create-custom-game")
  .setDescription(
    "カスタムゲームのイベントを作成して参加募集を始めます。",
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("イベント名")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("date")
      .setDescription("開始日 (MM/DD形式)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("time")
      .setDescription("開始時刻 (HH:mm形式)")
      .setRequired(true)
  )
  .addChannelOption((option) =>
    option
      .setName("voice")
      .setDescription("使用するボイスチャンネル")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildVoice)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  const recruitmentChannel = interaction.channel;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const eventName = interaction.options.getString("title", true);
  const dateStr = interaction.options.getString("date", true);
  const timeStr = interaction.options.getString("time", true);
  const voiceChannel = interaction.options.getChannel("voice", true);

  const scheduledStartTime = parseDate(dateStr, timeStr);
  if (!scheduledStartTime) {
    await interaction.editReply(
      messageHandler.formatMessage(
        messageKeys.customGame.create.error.invalidDateTimeFormat,
      ),
    );
    return;
  }

  const displayDate = format(scheduledStartTime, "yyyy/MM/dd HH:mm");

  const recruitmentMessageContent = messageHandler.formatMessage(
    messageKeys.customGame.create.recruitmentMessage,
    {
      startTime: displayDate,
      eventName,
      organizer: `<@${interaction.user.id}>`,
    },
  );

  let createdRecruitmentMessage: Message | null = null;
  const result = await customGameEventSaga.create({
    operationKey: interaction.id,
    name: eventName,
    guildId: guild.id,
    creatorId: interaction.user.id,
    recruitmentChannelId: recruitmentChannel.id,
    voiceChannelId: voiceChannel.id,
    scheduledStartAt: scheduledStartTime,
    recruitmentMessageContent,
  }, {
    createScheduledEvent: async (input) => {
      const event = await findOrCreateCustomGameScheduledEvent(guild, input);
      return { id: event.id };
    },
    createRecruitmentMessage: async ({ content, nonce, createdAfter }) => {
      const message = await findOrCreateCustomGameRecruitmentMessage(
        recruitmentChannel,
        {
          operationKey: nonce,
          content,
          createdAfter,
        },
      );
      createdRecruitmentMessage = message;
      return { id: message.id };
    },
    addRecruitmentReactions: async (messageId) => {
      const message = createdRecruitmentMessage?.id === messageId
        ? createdRecruitmentMessage
        : await recruitmentChannel.messages.fetch(messageId);
      for (const emoji of Object.values(ROLE_EMOJIS)) {
        await message.react(emoji);
      }
    },
    findScheduledEvent: async ({ operationKey }) => {
      const event = await findCustomGameScheduledEvent(guild, operationKey);
      return event ? { id: event.id } : null;
    },
    findRecruitmentMessage: async (lookupInput) => {
      const message = await findCustomGameRecruitmentMessage(
        recruitmentChannel.messages,
        lookupInput,
      );
      return message ? { id: message.id } : null;
    },
    deleteScheduledEvent: async (discordScheduledEventId) => {
      await guild.scheduledEvents.delete(discordScheduledEventId);
    },
    deleteRecruitmentMessage: async (recruitmentMessageId) => {
      if (createdRecruitmentMessage?.id === recruitmentMessageId) {
        await createdRecruitmentMessage.delete();
        return;
      }
      await recruitmentChannel.messages.delete(recruitmentMessageId);
    },
  });

  if (!result.success) {
    botLogger.error(
      "custom_game.create.saga_failed",
      {
        correlationId: correlationIdForInteraction(interaction),
        errorCategory: "remote_api",
        guildId: guild.id,
        channelId: recruitmentChannel.id,
        failedStep: result.error.primaryFailure.step,
        recoveryFailureCount: result.error.recoveryFailures.length,
      },
      result.error,
    );
    await interaction.editReply(
      messageHandler.formatMessage(messageKeys.common.error.command),
    );
    return;
  }

  let replyContent = messageHandler.formatMessage(
    messageKeys.customGame.create.success,
  );
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

  if (scheduledStartTime > oneMonthFromNow) {
    replyContent += messageHandler.formatMessage(
      messageKeys.customGame.create.info.dateTooFarWarning,
    );
  }

  await interaction.editReply(replyContent);
}
