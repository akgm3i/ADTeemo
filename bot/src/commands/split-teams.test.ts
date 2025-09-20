import { describe, it } from "@std/testing/bdd";
import { assertRejects } from "@std/assert";
import {
  assertSpyCall,
  assertSpyCalls,
  type Spy,
  spy,
  stub,
} from "@std/testing/mock";
import { execute, testable } from "./split-teams.ts";
import {
  ChannelType,
  Collection,
  GuildMember,
  Message,
  NonThreadGuildBasedChannel,
  User,
} from "discord.js";
import { TEAM_A_VC_NAME, TEAM_B_VC_NAME } from "../constants.ts";
import { type Event, type Lane, lanes } from "@adteemo/api/schema";
import { messageKeys } from "../messages.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";

describe("split-teams command", () => {
  describe("execute", () => {
    it("正常なフローで、各ヘルパー関数を正しい引数で呼び出す", async () => {
      const guild = new MockGuildBuilder().build();
      const interaction = new MockInteractionBuilder().withGuild(guild).build();
      (interaction as { inGuild: () => true }).inGuild = () => true;

      const event: Event = {
        id: 1,
        name: "test-event",
        guildId: "g-id",
        creatorId: "u-id",
        discordScheduledEventId: "de-id",
        recruitmentMessageId: "msg-id",
        createdAt: new Date(),
        scheduledStartAt: new Date(),
      };
      const message = {} as Message;
      const participants: {
        participantsByRole: Map<Lane, User[]>;
        allParticipants: Set<User>;
      } = {
        participantsByRole: new Map(),
        allParticipants: new Set(),
      };
      const teams = { teamA: new Map(), teamB: new Map() };

      using fetchEventStub = stub(
        testable,
        "fetchEvent",
        () => Promise.resolve(event),
      );
      using fetchMsgStub = stub(
        testable,
        "fetchRecruitmentMessage",
        () => Promise.resolve(message),
      );
      using fetchParticipantsStub = stub(
        testable,
        "fetchParticipants",
        () => Promise.resolve(participants),
      );
      using validateStub = stub(testable, "validateParticipants", () => {});
      using splitStub = stub(testable, "splitTeams", () => teams);
      using moveStub = stub(
        testable,
        "moveMembersToVoiceChannels",
        () => Promise.resolve(),
      );
      using announceStub = stub(
        testable,
        "announceTeams",
        () => Promise.resolve(),
      );
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(fetchEventStub, 0, { args: [interaction.user.id] });
      assertSpyCall(fetchMsgStub, 0, {
        args: [
          interaction.guild!,
          interaction.channelId,
          event.recruitmentMessageId,
        ],
      });
      assertSpyCall(fetchParticipantsStub, 0, { args: [message] });
      assertSpyCall(validateStub, 0, {
        args: [participants.participantsByRole, participants.allParticipants],
      });
      assertSpyCall(splitStub, 0, { args: [participants.participantsByRole] });
      assertSpyCall(moveStub, 0, {
        args: [interaction.guild!, teams.teamA, teams.teamB],
      });
      assertSpyCall(announceStub, 0, {
        args: [interaction, teams.teamA, teams.teamB],
      });
      assertSpyCalls(editSpy, 0);
    });
  });

  describe("fetchRecruitmentMessage", () => {
    it("チャンネルが見つからない場合にエラーをスローする", async () => {
      const guild = new MockGuildBuilder().build();
      using _fetchStub = stub(
        guild.channels,
        "fetch",
        () =>
          Promise.resolve(
            new Collection<string, NonThreadGuildBasedChannel | null>(),
          ),
      );
      using formatSpy = spy(testable, "formatMessage");

      await assertRejects(
        () => testable.fetchRecruitmentMessage(guild, "c-id", "m-id"),
        Error,
      );
      assertSpyCall(formatSpy, 0, {
        args: [messageKeys.customGame.split.error.noRecruitmentChannel],
      });
    });
  });

  describe("moveMembersToVoiceChannels", () => {
    it("メンバーを各チームのボイスチャンネルに正しく移動させる", async () => {
      const users: User[] = Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i}`,
      })) as User[];

      const teamA = new Map<Lane, User>();
      const teamB = new Map<Lane, User>();
      lanes.forEach((lane, i) => {
        teamA.set(lane, users[i]);
        teamB.set(lane, users[i + 5]);
      });

      const guildBuilder = new MockGuildBuilder();
      const setChannelSpies = new Map<string, Spy>();

      for (const user of users) {
        const setChannelSpy = spy(() => Promise.resolve({} as GuildMember));
        setChannelSpies.set(user.id, setChannelSpy);
        guildBuilder.withMember({
          id: user.id,
          user: user,
          voice: { setChannel: setChannelSpy },
        });
      }

      guildBuilder.withChannel({
        id: "vc-a-id",
        name: TEAM_A_VC_NAME,
        type: ChannelType.GuildVoice,
      });
      guildBuilder.withChannel({
        id: "vc-b-id",
        name: TEAM_B_VC_NAME,
        type: ChannelType.GuildVoice,
      });

      const guild = guildBuilder.build();
      const fetchMembersSpy = spy(guild.members, "fetch");

      await testable.moveMembersToVoiceChannels(guild, teamA, teamB);

      assertSpyCall(fetchMembersSpy, 0, {
        args: [{ user: users.map((u) => u.id) }],
      });

      for (const user of teamA.values()) {
        const spy = setChannelSpies.get(user.id)!;
        assertSpyCall(spy, 0, { args: ["vc-a-id"] });
      }

      for (const user of teamB.values()) {
        const spy = setChannelSpies.get(user.id)!;
        assertSpyCall(spy, 0, { args: ["vc-b-id"] });
      }
    });
  });
});
