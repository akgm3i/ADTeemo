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

function parseDate(dateStr: string, timeStr: string): Date | null {
  const now = new Date();
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
    "新しいカスタムゲームのイベントを作成し、参加者の募集を開始します。",
  )
  .addStringOption((option) =>
    option
      .setName("event-name")
      .setDescription("イベント名")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("start-date")
      .setDescription("開始日 (MM/DD形式)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("start-time")
      .setDescription("開始時刻 (HH:mm形式)")
      .setRequired(true)
  )
  .addChannelOption((option) =>
    option
      .setName("voice-channel")
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
      content: "このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const eventName = interaction.options.getString("event-name", true);
  const dateStr = interaction.options.getString("start-date", true);
  const timeStr = interaction.options.getString("start-time", true);
  const voiceChannel = interaction.options.getChannel("voice-channel", true);

  const scheduledStartTime = parseDate(dateStr, timeStr);
  if (!scheduledStartTime) {
    await interaction.reply({
      content:
        "日付または時刻のフォーマットが正しくありません。MM/DD HH:mmの形式で入力してください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const event = await interaction.guild.scheduledEvents.create({
    name: eventName,
    scheduledStartTime: scheduledStartTime,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.Voice,
    channel: voiceChannel.id,
  });

  let replyContent =
    "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。";
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

  if (scheduledStartTime > oneMonthFromNow) {
    replyContent += "\n⚠️ 警告: 開始日時が1ヶ月以上先です。";
  }

  await interaction.editReply(replyContent);

  const displayDate = format(scheduledStartTime, "yyyy/MM/dd HH:mm");

  const recruitmentMessageContent = `### ⚔️ カスタムゲーム参加者募集 ⚔️

@Custom

**${displayDate}** からカスタムゲーム **${eventName}** を開催します！
参加希望の方は、希望するロールのリアクションを押してください。

複数ロールでの参加も可能です。

主催者: <@${interaction.user.id}>`;

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
  });
}
