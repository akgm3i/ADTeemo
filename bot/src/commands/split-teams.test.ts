import { afterEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCall, restore, type Spy, spy, stub } from "@std/testing/mock";
import {
  fetchRecruitmentMessage,
  moveMembersToVoiceChannels,
} from "./split-teams.ts";
import {
  ChannelType,
  Collection,
  Guild,
  GuildMember,
  User,
  VoiceChannel,
} from "discord.js";
import { TEAM_A_VC_NAME, TEAM_B_VC_NAME } from "../constants.ts";
import { Lane, lanes } from "@adteemo/api/schema";
import { formatMessage, messageKeys } from "../messages.ts";

describe("split-teams command", () => {
  afterEach(() => {
    restore();
  });

  describe("fetchRecruitmentMessage", () => {
    it("チャンネルが見つからない場合にエラーをスローする", async () => {
      const fetchSpy = spy(() => Promise.resolve(null));
      const guild = {
        channels: {
          fetch: fetchSpy,
        },
      } as unknown as Guild;

      await assertRejects(
        () => fetchRecruitmentMessage(guild, "channel-id", "message-id"),
        Error,
        formatMessage(messageKeys.customGame.split.error.noRecruitmentChannel),
      );

      assertSpyCall(fetchSpy, 0, { args: ["channel-id"] });
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

      const setChannelSpies = new Map<string, Spy>();
      const mockMembers = new Collection<string, GuildMember>();
      for (const user of users) {
        const setChannelSpy = spy(() => Promise.resolve());
        setChannelSpies.set(user.id, setChannelSpy);
        mockMembers.set(user.id, {
          id: user.id,
          user,
          voice: { setChannel: setChannelSpy },
        } as unknown as GuildMember);
      }

      const teamAVc = {
        id: "vc-a-id",
        name: TEAM_A_VC_NAME,
        type: ChannelType.GuildVoice,
      } as VoiceChannel;
      const teamBVc = {
        id: "vc-b-id",
        name: TEAM_B_VC_NAME,
        type: ChannelType.GuildVoice,
      } as VoiceChannel;
      const mockChannels = new Collection<string, VoiceChannel | null>();
      mockChannels.set(teamAVc.id, teamAVc);
      mockChannels.set(teamBVc.id, teamBVc);

      const guild = { channels: {}, members: {} } as Guild;
      const fetchChannelsStub = stub(
        guild.channels,
        "fetch",
        () => Promise.resolve(mockChannels),
      );
      const fetchMembersStub = stub(
        guild.members,
        "fetch",
        () => Promise.resolve(mockMembers),
      );

      await moveMembersToVoiceChannels(guild, teamA, teamB);

      assertSpyCall(fetchChannelsStub, 0);
      assertSpyCall(fetchMembersStub, 0, {
        args: [{ user: users.map((u) => u.id) }],
      });

      for (const user of teamA.values()) {
        const spy = setChannelSpies.get(user.id)!;
        assertSpyCall(spy, 0, { args: [teamAVc.id] });
      }

      for (const user of teamB.values()) {
        const spy = setChannelSpies.get(user.id)!;
        assertSpyCall(spy, 0, { args: [teamBVc.id] });
      }

      const totalCalls = Array.from(setChannelSpies.values()).reduce(
        (acc, s) => acc + s.calls.length,
        0,
      );
      assertEquals(totalCalls, 10);
    });
  });
});
