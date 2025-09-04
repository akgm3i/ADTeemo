import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import {
  assertSpyCall,
  assertSpyCalls,
  spy,
  stub,
} from "jsr:@std/testing/mock";
import { execute } from "./create-custom-game.ts";
import { newMockInteractionBuilder } from "../test_utils.ts";
import {
  ChannelType,
  EmojiIdentifierResolvable,
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventEntityType,
  GuildScheduledEventManager,
  GuildScheduledEventPrivacyLevel,
  Message,
  MessageCreateOptions,
  MessagePayload,
  MessageReaction,
  TextBasedChannel,
} from "discord.js";

describe("Create Custom Game Command", () => {
  describe("execute", () => {
    const mockNow = new Date("2025-09-03T10:00:00Z"); // Wednesday

    describe("正常系", () => {
      it("有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const reactSpy = spy(
          (
            _emoji: EmojiIdentifierResolvable,
          ): Promise<MessageReaction> => Promise.resolve({} as MessageReaction),
        );

        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> =>
            Promise.resolve({ react: reactSpy } as unknown as Message),
        );

        const createEventSpy = spy(
          (
            _options: GuildScheduledEventCreateOptions,
          ): Promise<GuildScheduledEvent> =>
            Promise.resolve({} as GuildScheduledEvent),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;

        const mockScheduledEvents = {
          create: createEventSpy,
        } as unknown as GuildScheduledEventManager;

        const mockGuild = {
          id: "mock-guild-id",
          scheduledEvents: mockScheduledEvents,
        } as unknown as Guild;

        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "09/13";
            if (name === "start-time") return "21:00";
            return null;
          })
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        // Execute
        await execute(interaction);

        // Assertions
        const expectedDate = new Date("2025-09-13T12:00:00.000Z");
        assertSpyCall(createEventSpy, 0, {
          args: [{
            name: "週末カスタム",
            scheduledStartTime: expectedDate,
            scheduledEndTime: new Date("2025-09-13T14:59:00.000Z"),
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.External,
            entityMetadata: { location: "カスタムゲーム" },
          }],
        });

        const expectedMessage = `### ⚔️ カスタムゲーム参加者募集 ⚔️

@Custom

**2025/09/13 21:00** からカスタムゲーム **週末カスタム** を開催します！
参加希望の方は、希望するロールのリアクションを押してください。

複数ロールでの参加も可能です。

主催者: <@test-user-id>`;
        assertSpyCall(sendSpy, 0, { args: [expectedMessage] });
        assertSpyCalls(reactSpy, 5);

        assertSpyCalls(interaction.reply, 1);
        assertEquals(
          interaction.reply.calls[0].args[0].content,
          "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。",
        );
      });

      it("過去の日付が指定された場合、翌年の日付として扱いイベントを作成する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const reactSpy = spy(
          (
            _emoji: EmojiIdentifierResolvable,
          ): Promise<MessageReaction> => Promise.resolve({} as MessageReaction),
        );
        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> =>
            Promise.resolve({ react: reactSpy } as unknown as Message),
        );
        const createEventSpy = spy(
          (
            _options: GuildScheduledEventCreateOptions,
          ): Promise<GuildScheduledEvent> =>
            Promise.resolve({} as GuildScheduledEvent),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;
        const mockScheduledEvents = {
          create: createEventSpy,
        } as unknown as GuildScheduledEventManager;
        const mockGuild = {
          id: "mock-guild-id",
          scheduledEvents: mockScheduledEvents,
        } as unknown as Guild;

        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "新年カスタム";
            if (name === "start-date") return "01/15";
            if (name === "start-time") return "12:00";
            return null;
          })
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        await execute(interaction);

        const nextYear = mockNow.getFullYear() + 1;
        const expectedDate = new Date(`${nextYear}-01-15T03:00:00.000Z`);

        assertSpyCall(createEventSpy, 0, {
          args: [{
            name: "新年カスタム",
            scheduledStartTime: expectedDate,
            scheduledEndTime: new Date("2026-01-15T14:59:00.000Z"),
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.External,
            entityMetadata: { location: "カスタムゲーム" },
          }],
        });
      });

      it("開始日時が1ヶ月以上先の場合、警告メッセージ付きで成功応答を返す", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        const reactSpy = spy(
          (
            _emoji: EmojiIdentifierResolvable,
          ): Promise<MessageReaction> => Promise.resolve({} as MessageReaction),
        );
        const sendSpy = spy(
          (
            _options: string | MessagePayload | MessageCreateOptions,
          ): Promise<Message> =>
            Promise.resolve({ react: reactSpy } as unknown as Message),
        );
        const createEventSpy = spy(
          (
            _options: GuildScheduledEventCreateOptions,
          ): Promise<GuildScheduledEvent> =>
            Promise.resolve({} as GuildScheduledEvent),
        );

        const mockChannel = {
          type: ChannelType.GuildText,
          send: sendSpy,
        } as unknown as TextBasedChannel;
        const mockScheduledEvents = {
          create: createEventSpy,
        } as unknown as GuildScheduledEventManager;
        const mockGuild = {
          id: "mock-guild-id",
          scheduledEvents: mockScheduledEvents,
        } as unknown as Guild;

        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "未来のカスタム";
            if (name === "start-date") return "12/25";
            if (name === "start-time") return "12:00";
            return null;
          })
          .build();

        Object.assign(interaction, {
          channel: mockChannel,
          inGuild: () => true,
        });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0, {
          args: [{
            content:
              "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。\n⚠️ 警告: 開始日時が1ヶ月以上先です。",
            ephemeral: true,
          }],
        });
      });
    });

    describe("異常系", () => {
      it("日付のフォーマットが不正な場合、エラーメッセージを返信する", async () => {
        const createEventSpy = spy(
          (
            _options: GuildScheduledEventCreateOptions,
          ): Promise<GuildScheduledEvent> =>
            Promise.resolve({} as GuildScheduledEvent),
        );

        const mockScheduledEvents = {
          create: createEventSpy,
        } as unknown as GuildScheduledEventManager;
        const mockGuild = {
          id: "mock-guild-id",
          scheduledEvents: mockScheduledEvents,
        } as unknown as Guild;

        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "invalid-date";
            if (name === "start-time") return "21:00";
            return null;
          })
          .build();

        Object.assign(interaction, {
          inGuild: () => true,
          channel: { send: () => {} } as unknown as TextBasedChannel,
        });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0, {
          args: [{
            content:
              "日付または時刻のフォーマットが正しくありません。MM/DD HH:mmの形式で入力してください。",
            ephemeral: true,
          }],
        });
        assertSpyCalls(createEventSpy, 0);
      });

      it("DMでコマンドが実行された場合、エラーメッセージを返信する", async () => {
        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(null)
          .build();
        Object.assign(interaction, { inGuild: () => false });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0, {
          args: [{
            content: "このコマンドはサーバー内でのみ実行できます。",
            ephemeral: true,
          }],
        });
      });
    });
  });
});
