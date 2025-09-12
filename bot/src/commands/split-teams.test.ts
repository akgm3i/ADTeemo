import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@0.225.1/bdd";
import { assert, assertEquals } from "jsr:@std/assert@0.225.1";
import { returnsNext, spy, stub } from "jsr:@std/testing@0.225.1/mock";
import {
  ChannelType,
  Collection,
  GuildMember,
  Message,
  TextChannel,
  User,
  ChatInputCommandInteraction,
  Guild,
  VoiceChannel,
} from "discord.js";

import { command } from "./split-teams.ts";
import { apiClient } from "../api_client.ts";

describe("split-teams command", () => {
  let interaction: ChatInputCommandInteraction;
  let getTodaysEventStub: ReturnType<typeof stub>;
  let fetchChannelStub: ReturnType<typeof stub>;
  let fetchMessageStub: ReturnType<typeof stub>;
  let fetchMembersStub: ReturnType<typeof stub>;
  let members: GuildMember[];

  beforeEach(() => {
    const users = Array.from({ length: 10 }, (_, i) => ({ id: `user-${i}`, bot: false }) as User);
    members = users.map(user => ({
        id: user.id,
        user,
        voice: { setChannel: spy(() => Promise.resolve({} as GuildMember)) },
    } as unknown as GuildMember));

    const channel = {
      id: "mock-channel-id",
      type: ChannelType.GuildText,
      messages: { fetch: () => Promise.resolve({} as Message) },
    } as unknown as TextChannel;

    const guild = {
      id: "mock-guild-id",
      channels: {
        fetch: () => Promise.resolve(channel),
        cache: new Collection<string, VoiceChannel>(),
      },
      members: { fetch: () => {} },
    } as unknown as Guild;

    interaction = {
      isChatInputCommand: () => true,
      inGuild: () => true,
      guild,
      channelId: channel.id,
      user: users[0],
      deferReply: spy(() => Promise.resolve()),
      editReply: spy(() => Promise.resolve()),
    } as unknown as ChatInputCommandInteraction;

    // Stub API Client
    getTodaysEventStub = stub(apiClient, "getTodaysCustomGameEventByCreatorId", returnsNext([
        Promise.resolve({
          success: true,
          event: { recruitmentMessageId: "msg-id" },
        } as any),
    ]));

    // Stub Discord.js methods
    fetchChannelStub = stub(guild.channels, "fetch", returnsNext([Promise.resolve(channel)]));
    fetchMembersStub = stub(guild.members, "fetch", (options: any) => {
        const id = typeof options === 'string' ? options : options?.user;
        const member = members.find((m) => m.id === id);
        return Promise.resolve(member);
    });

    const reactionsMap = new Collection<string, { users: { fetch: () => Promise<Collection<string, User>> } }>();
    reactionsMap.set("🇹", { users: { fetch: () => Promise.resolve(new Collection(users.slice(0, 2).map(u => [u.id, u]))) } });
    reactionsMap.set("🇯", { users: { fetch: () => Promise.resolve(new Collection(users.slice(2, 4).map(u => [u.id, u]))) } });
    reactionsMap.set("🇲", { users: { fetch: () => Promise.resolve(new Collection(users.slice(4, 6).map(u => [u.id, u]))) } });
    reactionsMap.set("🇧", { users: { fetch: () => Promise.resolve(new Collection(users.slice(6, 8).map(u => [u.id, u]))) } });
    reactionsMap.set("🇸", { users: { fetch: () => Promise.resolve(new Collection(users.slice(8, 10).map(u => [u.id, u]))) } });

    const mockMessage = {
      reactions: { cache: reactionsMap },
    } as unknown as Message;

    fetchMessageStub = stub(channel.messages, "fetch", returnsNext([Promise.resolve(mockMessage)]));
  });

  afterEach(() => {
    getTodaysEventStub.restore();
    fetchChannelStub.restore();
    fetchMessageStub.restore();
    fetchMembersStub.restore();
  });

  it("Happy path: 10 players, 2 for each role", async () => {
    // Setup: Find VCs
    const teamAVc = { id: "vc-a", name: "Red Team", type: ChannelType.GuildVoice };
    const teamBVc = { id: "vc-b", name: "Blue Team", type: ChannelType.GuildVoice };
    interaction.guild!.channels.cache.set(teamAVc.id, teamAVc as any);
    interaction.guild!.channels.cache.set(teamBVc.id, teamBVc as any);

    // Act
    await command.execute(interaction);

    // Assert
    const editReplySpy = interaction.editReply as ReturnType<typeof spy>;
    assertEquals(editReplySpy.calls.length, 1);
    const replyArg = editReplySpy.calls[0].args[0];
    const content = typeof replyArg === 'string' ? replyArg : (replyArg as {content: string}).content;
    assert(content.includes("チーム分け完了！"));
    assert(content.includes("**Team 1 (Red Team)**"));
    assert(content.includes("**Team 2 (Blue Team)**"));

    const setChannelCalls = members.map(m => (m.voice.setChannel as ReturnType<typeof spy>).calls.length).reduce((a, b) => a + b, 0);
    assertEquals(setChannelCalls, 10);
  });
});
