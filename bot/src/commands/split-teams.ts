import {
  ChannelType,
  ChatInputCommandInteraction,
  CommandInteraction,
  Guild,
  GuildMember,
  Message,
  SlashCommandBuilder,
  TextChannel,
  User,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { formatMessage, messageKeys } from "../messages.ts";
import {
  ROLE_DISPLAY_NAMES,
  ROLE_EMOJIS,
  TEAM_A_VC_NAME,
  TEAM_B_VC_NAME,
} from "../constants.ts";
import { type Event, type Lane, lanes } from "@adteemo/api/schema";

async function fetchEvent(creatorId: string): Promise<Event> {
  const eventResult = await testable.apiClient.getEventStartingTodayByCreatorId(
    creatorId,
  );
  if (eventResult.success === false || !eventResult.event) {
    throw new Error(
      testable.formatMessage(
        messageKeys.customGame.split.error.noEventFound,
      ),
    );
  }
  const eventFromApi = eventResult.event;
  return {
    ...eventFromApi,
    scheduledStartAt: new Date(eventFromApi.scheduledStartAt),
    createdAt: new Date(eventFromApi.createdAt),
  };
}

async function fetchRecruitmentMessage(
  guild: Guild,
  channelId: string,
  messageId: string,
): Promise<Message> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(
      testable.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentChannel,
      ),
    );
  }

  const message = await (channel as TextChannel).messages.fetch(messageId);
  if (!message) {
    throw new Error(
      testable.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentMessage,
      ),
    );
  }
  return message;
}

async function fetchParticipants(recruitmentMessage: Message) {
  const participantsByRole = new Map<Lane, User[]>();
  const allParticipants = new Set<User>();

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

function validateParticipants(
  participantsByRole: Map<Lane, User[]>,
  allParticipants: Set<User>,
) {
  if (allParticipants.size !== 10) {
    throw new Error(
      testable.formatMessage(
        messageKeys.customGame.split.error.invalidPlayerCount,
        {
          count: allParticipants.size,
        },
      ),
    );
  }
  for (const lane of lanes) {
    const participants = participantsByRole.get(lane);
    if (!participants || participants.length !== 2) {
      throw new Error(
        testable.formatMessage(
          messageKeys.customGame.split.error.invalidRoleCount,
          {
            role: ROLE_DISPLAY_NAMES[lane],
          },
        ),
      );
    }
  }
}

function splitTeams(participantsByRole: Map<Lane, User[]>) {
  const teamA = new Map<Lane, User>();
  const teamB = new Map<Lane, User>();

  for (const lane of lanes) {
    const players = participantsByRole.get(lane)!;
    const shuffled = players.sort(() => 0.5 - Math.random());
    teamA.set(lane, shuffled[0]);
    teamB.set(lane, shuffled[1]);
  }

  return { teamA, teamB };
}

async function moveMembersToVoiceChannels(
  guild: Guild,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  const channels = await guild.channels.fetch();
  const teamAVc = channels.find((c) =>
    c && c.name === TEAM_A_VC_NAME && c.type === ChannelType.GuildVoice
  );
  const teamBVc = channels.find((c) =>
    c && c.name === TEAM_B_VC_NAME && c.type === ChannelType.GuildVoice
  );

  if (!teamAVc || !teamBVc) {
    throw new Error(
      testable.formatMessage(
        messageKeys.customGame.split.error.noVoiceChannels,
      ),
    );
  }

  const teamAIds = new Set([...teamA.values()].map((u) => u.id));
  const allParticipantIds = [
    ...teamA.values(),
    ...teamB.values(),
  ].map((u) => u.id);

  const members = await guild.members.fetch({ user: allParticipantIds });

  const movePromises = members.map((member: GuildMember) => {
    const targetVcId = teamAIds.has(member.id) ? teamAVc.id : teamBVc.id;
    return member.voice.setChannel(targetVcId);
  });

  await Promise.all(movePromises);
}

function formatTeam(team: Map<Lane, User>): string {
  return lanes
    .map((lane) => {
      const user = team.get(lane);
      return `${ROLE_DISPLAY_NAMES[lane]}: <@${user!.id}>`;
    })
    .join("\n");
}

async function announceTeams(
  interaction: ChatInputCommandInteraction,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  const replyContent = testable.formatMessage(
    messageKeys.customGame.split.success,
    {
      teamA: formatTeam(teamA),
      teamB: formatTeam(teamB),
    },
  );

  await interaction.editReply(replyContent);
}

// Exported for testing purposes
export const testable = {
  apiClient,
  formatMessage,
  fetchEvent,
  fetchRecruitmentMessage,
  fetchParticipants,
  validateParticipants,
  splitTeams,
  moveMembersToVoiceChannels,
  announceTeams,
};

export const data = new SlashCommandBuilder()
  .setName("split-teams")
  .setDescription("現在の参加者でチーム分けを行います。");

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: testable.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const event = await testable.fetchEvent(interaction.user.id);
    const recruitmentMessage = await testable.fetchRecruitmentMessage(
      interaction.guild,
      interaction.channelId,
      event.recruitmentMessageId,
    );
    const { participantsByRole, allParticipants } = await testable
      .fetchParticipants(
        recruitmentMessage,
      );
    testable.validateParticipants(participantsByRole, allParticipants);
    const { teamA, teamB } = testable.splitTeams(participantsByRole);
    await testable.moveMembersToVoiceChannels(
      interaction.guild,
      teamA,
      teamB,
    );
    await testable.announceTeams(interaction, teamA, teamB);
  } catch (error) {
    await interaction.editReply(
      error instanceof Error ? error.message : "An unknown error occurred.",
    );
  }
}
