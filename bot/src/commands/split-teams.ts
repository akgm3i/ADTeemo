import { selectOwnedCustomGameEvent } from "../features/custom_game_selection.ts";
import { type StringSelectMenuInteraction } from "discord.js";
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
import { messageHandler, messageKeys } from "../messages.ts";
import { ROLE_DISPLAY_NAMES, ROLE_EMOJIS } from "../constants.ts";
import { type Event, type Lane, lanes } from "@adteemo/api/contract";

export const data = new SlashCommandBuilder()
  .setName("split-teams")
  .setDescription("現在の参加者を自動で2チームに分けます。")
  .addIntegerOption((option) =>
    option.setName("event").setDescription(
      "対象イベントID（/start-matching で選択できます）",
    ).setMinValue(1)
  );

export async function fetchEvent(
  guildId: string,
  recruitmentChannelId: string,
  creatorId: string,
  eventId?: number,
): Promise<Event> {
  if (eventId !== undefined) {
    return await selectOwnedCustomGameEvent({
      guildId,
      recruitmentChannelId,
      creatorId,
      eventId,
    });
  }
  const eventResult = await apiClient.getEventStartingTodayByCreator(
    guildId,
    recruitmentChannelId,
    creatorId,
  );
  if (eventResult.success === false || !eventResult.event) {
    throw new Error(
      messageHandler.formatMessage(
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

export async function fetchRecruitmentMessage(
  guild: Guild,
  channelId: string,
  messageId: string,
): Promise<Message> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentChannel,
      ),
    );
  }

  const message = await (channel as TextChannel).messages.fetch(messageId);
  if (!message) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentMessage,
      ),
    );
  }
  return message;
}

export async function fetchParticipants(recruitmentMessage: Message) {
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

export function validateParticipants(
  participantsByRole: Map<Lane, User[]>,
  allParticipants: Set<User>,
) {
  const participantCount =
    new Set([...allParticipants].map((participant) => participant.id)).size;
  if (participantCount !== 10) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.split.error.invalidPlayerCount,
        {
          count: participantCount,
        },
      ),
    );
  }
  for (const lane of lanes) {
    const participants = participantsByRole.get(lane);
    if (!participants || participants.length !== 2) {
      throw new Error(
        messageHandler.formatMessage(
          messageKeys.customGame.split.error.invalidRoleCount,
          {
            role: ROLE_DISPLAY_NAMES[lane],
          },
        ),
      );
    }
  }
}

export function splitTeams(participantsByRole: Map<Lane, User[]>) {
  const teamA = new Map<Lane, User>();
  const teamB = new Map<Lane, User>();

  for (const lane of lanes) {
    const players = participantsByRole.get(lane)!;
    const shuffled = Math.random() < 0.5
      ? [...players]
      : [...players].reverse();
    teamA.set(lane, shuffled[0]);
    teamB.set(lane, shuffled[1]);
  }

  return { teamA, teamB };
}

export async function moveMembersToVoiceChannels(
  guild: Guild,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  const saved = await apiClient.getCustomGameSettings(guild.id);
  if (!saved.success) throw new Error(saved.error);
  if (!saved.settings) {
    throw new Error(
      messageHandler.formatMessage(messageKeys.customGame.flow.setupRequired),
    );
  }
  const channels = await guild.channels.fetch();
  const teamAVc = channels.find((c) =>
    c && c.id === saved.settings?.redChannelId &&
    c.type === ChannelType.GuildVoice
  );
  const teamBVc = channels.find((c) =>
    c && c.id === saved.settings?.blueChannelId &&
    c.type === ChannelType.GuildVoice
  );

  if (!teamAVc || !teamBVc) {
    throw new Error(
      messageHandler.formatMessage(
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
  if (members.size !== new Set(allParticipantIds).size) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.flow.missingParticipants,
      ),
    );
  }

  const movePromises = members.map((member: GuildMember) => {
    const targetVcId = teamAIds.has(member.id) ? teamAVc.id : teamBVc.id;
    return member.voice.setChannel(targetVcId);
  });

  await Promise.all(movePromises);
}

export async function saveParticipants(
  event: Event,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  if (!event.recruitmentChannelId) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentChannel,
      ),
    );
  }

  const participants = [
    ...lanes.map((lane) => ({
      userId: teamA.get(lane)!.id,
      team: "RED" as const,
      lane,
    })),
    ...lanes.map((lane) => ({
      userId: teamB.get(lane)!.id,
      team: "BLUE" as const,
      lane,
    })),
  ];
  const result = await apiClient.confirmCustomGameEventParticipants(event.id, {
    guildId: event.guildId,
    recruitmentChannelId: event.recruitmentChannelId,
    participants,
  });
  if (!result.success) {
    throw new Error(result.error);
  }
}

function formatTeam(team: Map<Lane, User>): string {
  return lanes
    .map((lane) => {
      const user = team.get(lane);
      return `${ROLE_DISPLAY_NAMES[lane]}: <@${user!.id}>`;
    })
    .join("\n");
}

export async function announceTeams(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  teamA: Map<Lane, User>,
  teamB: Map<Lane, User>,
) {
  const replyContent = messageHandler.formatMessage(
    messageKeys.customGame.split.success,
    {
      teamA: formatTeam(teamA),
      teamB: formatTeam(teamB),
    },
  );

  await interaction.editReply(replyContent);
}

export async function loadConfirmedTeams(guild: Guild, event: Event) {
  if (!event.recruitmentChannelId) {
    throw new Error("Recruitment channel missing");
  }
  const result = await apiClient.getCustomGameEventParticipants(event.id, {
    guildId: event.guildId,
    recruitmentChannelId: event.recruitmentChannelId,
  });
  if (!result.success) throw new Error(result.error);
  if (result.participants.length === 0) return null;
  if (result.participants.length !== 10) {
    throw new Error("Confirmed roster is incomplete");
  }
  const teamA = new Map<Lane, User>();
  const teamB = new Map<Lane, User>();
  for (const participant of result.participants) {
    const member = await guild.members.fetch(participant.userId);
    (participant.team === "RED" ? teamA : teamB).set(
      participant.lane,
      member.user,
    );
  }
  return { teamA, teamB };
}

export const splitTeamHandlers = {
  loadConfirmedTeams,
  fetchEvent,
  fetchRecruitmentMessage,
  fetchParticipants,
  validateParticipants,
  splitTeams,
  saveParticipants,
  moveMembersToVoiceChannels,
  announceTeams,
};

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const event = await splitTeamHandlers.fetchEvent(
      interaction.guildId,
      interaction.channelId,
      interaction.user.id,
      ...(interaction.options.getInteger("event") !== null
        ? [interaction.options.getInteger("event")!]
        : []),
    );
    await runEventMatching(interaction, event);
  } catch (error) {
    await interaction.editReply(
      error instanceof Error ? error.message : "An unknown error occurred.",
    );
  }
}

export async function runEventMatching(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  event: Event,
) {
  if (!interaction.guild) throw new Error("Guild is required");
  if (!event.recruitmentChannelId || !event.recruitmentMessageId) {
    throw new Error(
      messageHandler.formatMessage(
        messageKeys.customGame.split.error.noRecruitmentMessage,
      ),
    );
  }
  let teams = await splitTeamHandlers.loadConfirmedTeams(
    interaction.guild,
    event,
  );
  if (!teams) {
    const recruitmentMessage = await splitTeamHandlers.fetchRecruitmentMessage(
      interaction.guild,
      event.recruitmentChannelId,
      event.recruitmentMessageId,
    );
    const { participantsByRole, allParticipants } = await splitTeamHandlers
      .fetchParticipants(recruitmentMessage);
    splitTeamHandlers.validateParticipants(participantsByRole, allParticipants);
    teams = splitTeamHandlers.splitTeams(participantsByRole);
    await splitTeamHandlers.saveParticipants(event, teams.teamA, teams.teamB);
  }
  const { teamA, teamB } = teams;
  await splitTeamHandlers.moveMembersToVoiceChannels(
    interaction.guild,
    teamA,
    teamB,
  );
  await splitTeamHandlers.announceTeams(interaction, teamA, teamB);
}

export async function handleMatchingSelection(
  interaction: StringSelectMenuInteraction,
) {
  await interaction.deferUpdate();
  try {
    if (!interaction.guild) throw new Error("Guild is required");
    const event = await selectOwnedCustomGameEvent({
      guildId: interaction.guild.id,
      recruitmentChannelId: interaction.channelId,
      creatorId: interaction.user.id,
      eventId: Number(interaction.values[0]),
    });
    await runEventMatching(interaction, event);
  } catch (error) {
    await interaction.editReply({
      content: error instanceof Error
        ? error.message
        : messageHandler.formatMessage(
          messageKeys.customGame.flow.matchingFailed,
        ),
      components: [],
    });
  }
}
