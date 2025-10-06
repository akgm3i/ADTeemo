import {
  ChannelType,
  CommandInteraction,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { format, parse } from "@std/datetime";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

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

  const event = await interaction.guild.scheduledEvents.create({
    name: eventName,
    scheduledStartTime: scheduledStartTime,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.Voice,
    channel: voiceChannel.id,
  });

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

  const displayDate = format(scheduledStartTime, "yyyy/MM/dd HH:mm");

  const recruitmentMessageContent = messageHandler.formatMessage(
    messageKeys.customGame.create.recruitmentMessage,
    {
      startTime: displayDate,
      eventName,
      organizer: `<@${interaction.user.id}>`,
    },
  );

  const message = await interaction.channel.send(recruitmentMessageContent);

  await message.react("🇹");
  await message.react("🇯");
  await message.react("🇲");
  await message.react("🇧");
  await message.react("🇸");

  await apiClient.createCustomGameEvent({
    name: eventName,
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    discordScheduledEventId: event.id,
    recruitmentMessageId: message.id,
    scheduledStartAt: scheduledStartTime,
  });
}
