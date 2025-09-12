import {
  ChannelType,
  GuildMember,
  SlashCommandBuilder,
  User,
} from "discord.js";
import { Command } from "../types.ts";
import { apiClient } from "../api_client.ts";
import { formatMessage, messageKeys } from "../messages.ts";
import { ROLE_DISPLAY_NAMES } from "../constants.ts";
import type { Lane } from "@adteemo/api/schema";

const TEAM_A_VC_NAME = "Red Team";
const TEAM_B_VC_NAME = "Blue Team";

const ROLE_EMOJIS: Record<Lane, string> = {
  Top: "🇹",
  Jungle: "🇯",
  Middle: "🇲",
  Bottom: "🇧",
  Support: "🇸",
};

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("split-teams")
    .setDescription("現在の参加者でチーム分けを行います。"),
  execute: async (interaction) => {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: formatMessage(messageKeys.common.info.guildOnlyCommand),
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    // 1. Fetch event for today by the creator
    const eventResult = await apiClient.getTodaysCustomGameEventByCreatorId(
      interaction.user.id,
    );
    if (eventResult.success === false || !eventResult.event) {
      await interaction.editReply(
        formatMessage(messageKeys.customGame.split.error.noEventFound),
      );
      return;
    }
    const event = eventResult.event;

    // 2. Fetch recruitment message and its reactions
    const recruitmentChannel = await interaction.guild.channels.fetch(
      interaction.channelId,
    );
    if (
      !recruitmentChannel ||
      !(recruitmentChannel.type === ChannelType.GuildText)
    ) {
      await interaction.editReply("Error: Could not find the channel.");
      return;
    }

    const recruitmentMessage = await recruitmentChannel.messages.fetch(
      event.recruitmentMessageId,
    );
    if (!recruitmentMessage) {
      await interaction.editReply(
        formatMessage(messageKeys.customGame.split.error.noRecruitmentMessage),
      );
      return;
    }

    // 3. Fetch participants from reactions
    const participantsByRole = new Map<Lane, User[]>();
    const allParticipants = new Set<User>();

    for (const lane of Object.keys(ROLE_EMOJIS) as Lane[]) {
      const emoji = ROLE_EMOJIS[lane];
      const reaction = recruitmentMessage.reactions.cache.get(emoji);
      if (!reaction) {
        participantsByRole.set(lane, []);
        continue;
      }
      const users = await reaction.users.fetch();
      const participants = users.filter((user) => !user.bot).map((user) =>
        user
      );
      participantsByRole.set(lane, participants);
      participants.forEach((p) => allParticipants.add(p));
    }

    // 4. Validate participant counts
    if (allParticipants.size !== 10) {
      await interaction.editReply(
        formatMessage(messageKeys.customGame.split.error.invalidPlayerCount, {
          count: allParticipants.size,
        }),
      );
      return;
    }

    for (const lane of Object.keys(ROLE_EMOJIS) as Lane[]) {
      if (participantsByRole.get(lane)?.length !== 2) {
        await interaction.editReply(
          formatMessage(messageKeys.customGame.split.error.invalidRoleCount, {
            role: ROLE_DISPLAY_NAMES[lane],
          }),
        );
        return;
      }
    }

    // 5. Split teams
    const teamA = new Map<Lane, User>();
    const teamB = new Map<Lane, User>();

    for (const lane of Object.keys(ROLE_EMOJIS) as Lane[]) {
      const players = participantsByRole.get(lane)!;
      const shuffled = players.sort(() => 0.5 - Math.random());
      teamA.set(lane, shuffled[0]);
      teamB.set(lane, shuffled[1]);
    }

    // 6. Move members to voice channels
    const teamAVc = interaction.guild.channels.cache.find((c) =>
      c.name === TEAM_A_VC_NAME && c.type === ChannelType.GuildVoice
    );
    const teamBVc = interaction.guild.channels.cache.find((c) =>
      c.name === TEAM_B_VC_NAME && c.type === ChannelType.GuildVoice
    );

    if (!teamAVc || !teamBVc) {
      await interaction.editReply(
        formatMessage(messageKeys.customGame.split.error.noVoiceChannels),
      );
      return;
    }

    const movePromises: Promise<GuildMember>[] = [];
    for (const user of allParticipants) {
      const member = await interaction.guild.members.fetch(user.id);
      if (member) {
        const targetVcId = [...teamA.values()].map((u) =>
            u.id
          ).includes(user.id)
          ? teamAVc.id
          : teamBVc.id;
        movePromises.push(member.voice.setChannel(targetVcId));
      }
    }
    await Promise.all(movePromises);

    // 7. Announce results
    const formatTeam = (team: Map<Lane, User>) => {
      let result = "";
      for (const [lane, user] of team.entries()) {
        result += `${ROLE_DISPLAY_NAMES[lane]}: <@${user.id}>\n`;
      }
      return result;
    };

    const replyContent = formatMessage(messageKeys.customGame.split.success, {
      teamA: formatTeam(teamA),
      teamB: formatTeam(teamB),
    });

    await interaction.editReply(replyContent);
  },
};
