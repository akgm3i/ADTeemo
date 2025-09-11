import { afterEach, describe, it } from "@std/testing/bdd";
import {
  assertSpyCall,
  assertSpyCalls,
  restore,
  spy,
  stub,
} from "@std/testing/mock";
import { execute } from "./create-custom-game.ts";
import { apiClient } from "../api_client.ts";
import {
  newMockChatInputCommandInteractionBuilder,
  newMockGuildBuilder,
} from "../test_utils.ts";
import {
  Channel,
  ChannelType,
  EmojiIdentifierResolvable,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Message,
  MessageCreateOptions,
  MessageFlags,
  MessagePayload,
  MessageReaction,
  TextBasedChannel,
} from "discord.js";
import { t, m } from "@adteemo/messages";

describe("Create Custom Game Command", () => {
  afterEach(() => {
    restore();
  });

  describe("execute", () => {
    const mockNow = new Date("2025-09-03T10:00:00Z"); // Wednesday

    describe("正常系", () => {
      it("有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        const createEventStub = stub(
          apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true, error: null }),
        );

        // Setup
        const reactSpy = spy(
          (_emoji: EmojiIdentifierResolvable): Promise<MessageReaction> =>
            Promise.resolve({} as MessageReaction),
        );

        const mockMessage = {
          id: "mock-message-id",
          react: reactSpy,
        } as unknown as Message;

        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> => Promise.resolve(mockMessage),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;

        const mockGuildBuilder = newMockGuildBuilder();
        const mockGuild = mockGuildBuilder.build();
        const createEventSpy = mockGuildBuilder.getCreateEventSpy();

        const mockVoiceChannel = {
          id: "mock-voice-channel-id",
          type: ChannelType.GuildVoice,
        } as unknown as Channel;

        const interaction = newMockChatInputCommandInteractionBuilder(
          "create-custom-game",
        )
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "09/13";
            if (name === "start-time") return "21:00";
            return null;
          })
          .withChannelOption("voice-channel", mockVoiceChannel)
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        // Execute
        await execute(interaction);

        // Assertions
        const expectedDate = new Date("2025-09-13T21:00:00");
        assertSpyCall(createEventSpy, 0, {
          args: [{
            name: "週末カスタム",
            scheduledStartTime: expectedDate,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.Voice,
            channel: mockVoiceChannel.id,
          }],
        });

        const expectedMessage = t(m.customGame.create.recruitmentMessage, {
          startTime: "2025/09/13 21:00",
          eventName: "週末カスタム",
          organizer: "<@test-user-id>",
        });
        assertSpyCall(sendSpy, 0, { args: [expectedMessage] });
        assertSpyCalls(reactSpy, 5);

        assertSpyCall(interaction.deferReply, 0, {
          args: [{ flags: MessageFlags.Ephemeral }],
        });
        assertSpyCall(interaction.editReply, 0, {
          args: [t(m.customGame.create.success)],
        });

        assertSpyCall(createEventStub, 0, {
          args: [{
            name: "週末カスタム",
            guildId: "mock-guild-id",
            creatorId: "test-user-id",
            discordScheduledEventId: "mock-event-id",
            recruitmentMessageId: "mock-message-id",
          }],
        });
      });

      it("過去の日付が指定された場合、翌年の日付として扱いイベントを作成する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const reactSpy = spy(
          (_emoji: EmojiIdentifierResolvable): Promise<MessageReaction> =>
            Promise.resolve({} as MessageReaction),
        );
        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> =>
            Promise.resolve({ react: reactSpy } as unknown as Message),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;

        const mockGuildBuilder = newMockGuildBuilder();
        const mockGuild = mockGuildBuilder.build();
        const createEventSpy = mockGuildBuilder.getCreateEventSpy();

        const mockVoiceChannel = {
          id: "mock-voice-channel-id",
          type: ChannelType.GuildVoice,
        } as unknown as Channel;

        const interaction = newMockChatInputCommandInteractionBuilder(
          "create-custom-game",
        )
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "新年カスタム";
            if (name === "start-date") return "01/15";
            if (name === "start-time") return "12:00";
            return null;
          })
          .withChannelOption("voice-channel", mockVoiceChannel)
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        await execute(interaction);

        const nextYear = mockNow.getFullYear() + 1;
        const expectedDate = new Date(`${nextYear}-01-15T12:00:00`);

        assertSpyCall(createEventSpy, 0, {
          args: [{
            name: "新年カスタム",
            scheduledStartTime: expectedDate,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.Voice,
            channel: mockVoiceChannel.id,
          }],
        });
      });

      it("開始日時が1ヶ月以上先の場合、警告メッセージ付きで成功応答を返す", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        const reactSpy = spy(
          (_emoji: EmojiIdentifierResolvable): Promise<MessageReaction> =>
            Promise.resolve({} as MessageReaction),
        );
        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> =>
            Promise.resolve({ react: reactSpy } as unknown as Message),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;

        const mockGuildBuilder = newMockGuildBuilder();
        const mockGuild = mockGuildBuilder.build();

        const mockVoiceChannel = {
          id: "mock-voice-channel-id",
          type: ChannelType.GuildVoice,
        } as unknown as Channel;

        const interaction = newMockChatInputCommandInteractionBuilder(
          "create-custom-game",
        )
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "未来のカスタム";
            if (name === "start-date") return "12/25";
            if (name === "start-time") return "12:00";
            return null;
          })
          .withChannelOption("voice-channel", mockVoiceChannel)
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        await execute(interaction);

        assertSpyCall(interaction.editReply, 0, {
          args: [
            t(m.customGame.create.success) +
            t(m.customGame.create.info.dateTooFarWarning),
          ],
        });
      });
    });

    describe("異常系", () => {
      it("日付のフォーマットが不正な場合、エラーメッセージを返信する", async () => {
        const mockGuildBuilder = newMockGuildBuilder();
        const mockGuild = mockGuildBuilder.build();
        const createEventSpy = mockGuildBuilder.getCreateEventSpy();

        const mockVoiceChannel = {
          id: "mock-voice-channel-id",
          type: ChannelType.GuildVoice,
        } as unknown as Channel;

        const interaction = newMockChatInputCommandInteractionBuilder(
          "create-custom-game",
        )
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "invalid-date";
            if (name === "start-time") return "21:00";
            return null;
          })
          .withChannelOption("voice-channel", mockVoiceChannel)
          .build();

        Object.assign(interaction, {
          inGuild: () => true,
          channel: { send: () => {} } as unknown as TextBasedChannel,
        });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0, {
          args: [{
            content: t(m.customGame.create.error.invalidDateTimeFormat),
            flags: MessageFlags.Ephemeral,
          }],
        });
        assertSpyCalls(createEventSpy, 0);
      });

      it("DMでコマンドが実行された場合、エラーメッセージを返信する", async () => {
        const interaction = newMockChatInputCommandInteractionBuilder(
          "create-custom-game",
        )
          .withGuild(null)
          .build();
        Object.assign(interaction, { inGuild: () => false });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0, {
          args: [{
            content: t(m.common.info.guildOnlyCommand),
            flags: MessageFlags.Ephemeral,
          }],
        });
      });
    });
  });
});
