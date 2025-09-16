import {
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  Message,
  SlashCommandBuilder,
  TextChannel,
  User,
} from "discord.js";
import { Command } from "../types.ts";
import { apiClient } from "../api_client.ts";
import { formatMessage, messageKeys } from "../messages.ts";
import {
  ROLE_DISPLAY_NAMES,
  ROLE_EMOJIS,
  TEAM_A_VC_NAME,
  TEAM_B_VC_NAME,
} from "../constants.ts";
import type { Event, Lane } from "@adteemo/api/schema";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("split-teams")
    .setDescription("現在の参加者でチーム分けを行います。"),
  execute: async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: formatMessage(messageKeys.common.info.guildOnlyCommand),
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    try {
      // 1. コマンド実行者に関連するイベントを取得
      const event = await fetchEvent(interaction.user.id);

      // 2. 参加者募集メッセージを取得
      const recruitmentMessage = await fetchRecruitmentMessage(
        interaction.guild,
        interaction.channelId,
        event.recruitmentMessageId,
      );

      // 3. リアクションから参加者情報を取得・検証
      const { participantsByRole, allParticipants } = await fetchParticipants(
        recruitmentMessage,
      );
      validateParticipants(participantsByRole, allParticipants);

      // 4. チーム分けを実行
      const { teamA, teamB } = splitTeams(participantsByRole);

      // 5. メンバーをボイスチャンネルに移動
      await moveMembersToVoiceChannels(interaction.guild, teamA, teamB);

      // 6. 結果をアナウンス
      await announceTeams(interaction, teamA, teamB);
    } catch (error) {
      // エラーが発生した場合は、ユーザーにエラーメッセージを送信
      await interaction.editReply(
        error instanceof Error ? error.message : "An unknown error occurred.",
      );
    }
  },
};

/**
 * コマンド実行者のIDに基づいて、本日開始のイベントを取得します。
 * @param creatorId - イベント作成者のDiscordユーザーID
 * @returns イベント情報
 * @throws イベントが見つからない場合にエラーをスローします。
 */
async function fetchEvent(creatorId: string): Promise<Event> {
  const eventResult = await apiClient.getEventStartingTodayByCreatorId(
    creatorId,
  );
  if (eventResult.success === false || !eventResult.event) {
    throw new Error(
      formatMessage(messageKeys.customGame.split.error.noEventFound),
    );
  }

  // APIクライアント(JSON)からのレスポンスでは日付が文字列のため、Dateオブジェクトに変換する
  const eventFromApi = eventResult.event;
  return {
    ...eventFromApi,
    scheduledStartAt: new Date(eventFromApi.scheduledStartAt),
    createdAt: new Date(eventFromApi.createdAt),
  };
}

/**
 * 参加者募集メッセージを取得します。
 * @param guild - サーバー(Guild)オブジェクト
 * @param channelId - チャンネルID
 * @param messageId - メッセージID
 * @returns Discordメッセージオブジェクト
 * @throws チャンネルまたはメッセージが見つからない場合にエラーをスローします。
 */
async function fetchRecruitmentMessage(
  guild: Guild,
  channelId: string,
  messageId: string,
): Promise<Message> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("Error: Could not find the recruitment channel.");
  }

  const message = await (channel as TextChannel).messages.fetch(messageId);
  if (!message) {
    throw new Error(
      formatMessage(messageKeys.customGame.split.error.noRecruitmentMessage),
    );
  }
  return message;
}

/**
 * 募集メッセージのリアクションから参加者情報を取得します。
 * @param recruitmentMessage - 参加者募集メッセージ
 * @returns レーンごとの参加者リストと、全参加者のSet
 */
async function fetchParticipants(recruitmentMessage: Message) {
  const participantsByRole = new Map<Lane, User[]>();
  const allParticipants = new Set<User>();
  const lanes = Object.keys(ROLE_EMOJIS) as Lane[];

  // 各ロールのリアクションを並行して取得
  const reactionPromises = lanes.map(async (lane) => {
    const emoji = ROLE_EMOJIS[lane];
    const reaction = recruitmentMessage.reactions.cache.get(emoji);
    if (!reaction) {
      participantsByRole.set(lane, []);
      return;
    }
    const users = await reaction.users.fetch();
    const participants = users.filter((user) => !user.bot);
    participantsByRole.set(lane, [...participants.values()]);
    participants.forEach((p) => allParticipants.add(p));
  });

  await Promise.all(reactionPromises);

  return { participantsByRole, allParticipants };
}

/**
 * 参加者の人数が適切か検証します。
 * @param participantsByRole - レーンごとの参加者リスト
 * @param allParticipants - 全参加者のSet
 * @throws 人数が不適切な場合にエラーをスローします。
 */
function validateParticipants(
  participantsByRole: Map<Lane, User[]>,
  allParticipants: Set<User>,
) {
  // 全体の参加者数が10人であるか
  if (allParticipants.size !== 10) {
    throw new Error(
      formatMessage(messageKeys.customGame.split.error.invalidPlayerCount, {
        count: allParticipants.size,
      }),
    );
  }

  // 各ロールの参加者数が2人であるか
  for (const lane of Object.keys(ROLE_EMOJIS) as Lane[]) {
    const participants = participantsByRole.get(lane);
    if (!participants || participants.length !== 2) {
      throw new Error(
        formatMessage(messageKeys.customGame.split.error.invalidRoleCount, {
          role: ROLE_DISPLAY_NAMES[lane],
        }),
      );
    }
  }
}

/**
 * 参加者を2つのチームにランダムに分割します。
 * @param participantsByRole - レーンごとの参加者リスト
 * @returns チームAとチームBのマップ
 */
function splitTeams(participantsByRole: Map<Lane, User[]>) {
  const teamA = new Map<Lane, User>();
  const teamB = new Map<Lane, User>();

  for (const lane of Object.keys(ROLE_EMOJIS) as Lane[]) {
    const players = participantsByRole.get(lane)!;
    // プレイヤーをシャッフルしてチームに割り当て
    const shuffled = players.sort(() => 0.5 - Math.random());
    teamA.set(lane, shuffled[0]);
    teamB.set(lane, shuffled[1]);
  }

  return { teamA, teamB };
}

/**
 * メンバーを各チームのボイスチャンネルに移動させます。
 * @param guild - サーバー(Guild)オブジェクト
 * @param teamA - チームAのマップ
 * @param teamB - チームBのマップ
 * @throws ボイスチャンネルが見つからない場合にエラーをスローします。
 */
async function moveMembersToVoiceChannels(
  guild: Guild,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  // チームのボイスチャンネルを名前で検索
  const teamAVc = guild.channels.cache.find((c) =>
    c.name === TEAM_A_VC_NAME && c.type === ChannelType.GuildVoice
  );
  const teamBVc = guild.channels.cache.find((c) =>
    c.name === TEAM_B_VC_NAME && c.type === ChannelType.GuildVoice
  );

  if (!teamAVc || !teamBVc) {
    throw new Error(
      formatMessage(messageKeys.customGame.split.error.noVoiceChannels),
    );
  }

  const teamAIds = new Set([...teamA.values()].map((u) => u.id));
  const allParticipantIds = [
    ...teamA.values(),
    ...teamB.values(),
  ].map((u) => u.id);

  // 全参加者のGuildMemberオブジェクトを一括で取得
  const members = await guild.members.fetch({ user: allParticipantIds });

  // 各メンバーを対応するチームのVCに移動させる処理を並列で実行
  const movePromises = members.map((member: GuildMember) => {
    const targetVcId = teamAIds.has(member.id) ? teamAVc.id : teamBVc.id;
    return member.voice.setChannel(targetVcId);
  });

  await Promise.all(movePromises);
}

/**
 * チームの情報を整形して文字列として返します。
 * @param team - チームのマップ
 * @returns 整形されたチーム情報
 */
function formatTeam(team: Map<Lane, User>): string {
  return (Object.keys(ROLE_EMOJIS) as Lane[])
    .map((lane) => {
      const user = team.get(lane);
      return `${ROLE_DISPLAY_NAMES[lane]}: <@${user!.id}>`;
    })
    .join("\n");
}

/**
 * チーム分けの結果をDiscordにアナウンスします。
 * @param interaction - コマンドインタラクション
 * @param teamA - チームAのマップ
 * @param teamB - チームBのマップ
 */
async function announceTeams(
  interaction: ChatInputCommandInteraction,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  const replyContent = formatMessage(messageKeys.customGame.split.success, {
    teamA: formatTeam(teamA),
    teamB: formatTeam(teamB),
  });

  await interaction.editReply(replyContent);
}
