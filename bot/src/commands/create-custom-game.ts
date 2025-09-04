import {
  CommandInteraction,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  SlashCommandBuilder,
} from "discord.js";

function parseDate(dateStr: string, timeStr: string): Date | null {
  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{1,2})$/);

  if (!dateMatch || !timeMatch) return null;

  const [, month, day] = dateMatch.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const now = new Date();
  let year = now.getFullYear();

  const tempDate = new Date();
  tempDate.setFullYear(year, month - 1, day);
  tempDate.setHours(hours, minutes, 0, 0);

  if (tempDate < now) {
    year += 1;
  }

  const isoString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+09:00`;
  return new Date(isoString);
}

function formatDate(date: Date): string {
  const datePart = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo'
  }).format(date);

  const timePart = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo'
  }).format(date);

  const dayOfWeek = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short', timeZone: 'Asia/Tokyo'
  }).format(date);

  return `${datePart}(${dayOfWeek}) ${timePart}`;
}

export const data = new SlashCommandBuilder()
  .setName("create-custom-game")
  .setDescription("新しいカスタムゲームのイベントを作成し、参加者の募集を開始します。")
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
      .setDescription("開始時刻 (HH:MM形式)")
      .setRequired(true)
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({ content: "このコマンドはサーバー内でのみ実行できます。", ephemeral: true });
    return;
  }

  const eventName = interaction.options.getString("event-name", true);
  const dateStr = interaction.options.getString("start-date", true);
  const timeStr = interaction.options.getString("start-time", true);

  const scheduledStartTime = parseDate(dateStr, timeStr);
  if (!scheduledStartTime) {
    await interaction.reply({ content: "日付または時刻のフォーマットが正しくありません。MM/DD HH:MMの形式で入力してください。", ephemeral: true });
    return;
  }

  await interaction.guild.scheduledEvents.create({
    name: eventName,
    scheduledStartTime: scheduledStartTime,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: "カスタムゲーム" },
  });

  const displayDate = formatDate(scheduledStartTime);

  const recruitmentMessageContent = `### ⚔️ カスタムゲーム参加者募集 ⚔️

@Custom

**${displayDate}** からカスタムゲームを開催します！
参加希望の方は、希望するロールのリアクションを押してください。

複数ロールでの参加も可能です。

主催者: <@${interaction.user.id}>`;

  const message = await interaction.channel.send(recruitmentMessageContent);

  await message.react("🇹");
  await message.react("🇯");
  await message.react("🇲");
  await message.react("🇧");
  await message.react("🇸");

  let replyContent = "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。";
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

  if (scheduledStartTime > oneMonthFromNow) {
    replyContent += "\n⚠️ 警告: 開始日時が1ヶ月以上先です。";
  }

  await interaction.reply({
    content: replyContent,
    ephemeral: true,
  });
}
