import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";
import { execute } from "./create-custom-game.ts";
import { newMockInteractionBuilder } from "../test_utils.ts";
import { ChannelType, GuildScheduledEventManager } from "discord.js";

describe("Create Custom Game Command", () => {
  describe("execute", () => {
    const mockNow = new Date("2025-09-03T10:00:00Z"); // Wednesday

    describe("正常系", () => {
      it("有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const reactSpy = spy(() => Promise.resolve());
        const mockMessage = { react: reactSpy };
        const sendSpy = spy(() => Promise.resolve(mockMessage));
        const mockChannel = { send: sendSpy, type: ChannelType.GuildText };
        const createEventSpy = spy(() => Promise.resolve());
        const mockGuild = {
          id: "mock-guild-id",
          scheduledEvents: { create: createEventSpy } as unknown as GuildScheduledEventManager,
          valueOf: () => "mock-guild-id",
        };
        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "09/13"; // Within one month
            if (name === "start-time") return "21:00";
            return null;
          })
          .build();
        Object.assign(interaction, { channel: mockChannel, inGuild: () => true });

        // Execute
        await execute(interaction);

        // Assertions
        const expectedDate = new Date("2025-09-13T12:00:00.000Z");
        assertSpyCall(createEventSpy, 0);
        assertEquals(createEventSpy.calls[0].args[0].name, "週末カスタム");
        assertEquals(createEventSpy.calls[0].args[0].scheduledStartTime, expectedDate);

        const expectedMessage = `### ⚔️ カスタムゲーム参加者募集 ⚔️

@Custom

**2025/09/13(土) 21:00** からカスタムゲームを開催します！
参加希望の方は、希望するロールのリアクションを押してください。

複数ロールでの参加も可能です。

主催者: <@test-user-id>`;
        assertSpyCall(sendSpy, 0);
        assertEquals(sendSpy.calls[0].args[0], expectedMessage);

        assertSpyCall(interaction.reply, 0);
        assertEquals(interaction.reply.calls[0].args[0].content, "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。");
      });

      it("過去の日付が指定された場合、翌年の日付として扱いイベントを作成する", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const createEventSpy = spy(() => Promise.resolve());
        const mockGuild = { id: "mock-guild-id", scheduledEvents: { create: createEventSpy } as any, valueOf: () => "mock-guild-id" };
        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "新年カスタム";
            if (name === "start-date") return "01/15";
            if (name === "start-time") return "12:00";
            return null;
          })
          .build();
        Object.assign(interaction, { channel: { send: spy(() => Promise.resolve({ react: spy() })) }, inGuild: () => true });

        // Execute
        await execute(interaction);

        // Assertions
        assertSpyCall(createEventSpy, 0);
        const nextYear = mockNow.getFullYear() + 1; // 2026
        const expectedDate = new Date(`${nextYear}-01-15T03:00:00.000Z`);
        assertEquals(createEventSpy.calls[0].args[0].scheduledStartTime, expectedDate);
      });

      it("開始日時が1ヶ月以上先の場合、警告メッセージ付きで成功応答を返す", async () => {
        using _dateMock = stub(Date, "now", () => mockNow.getTime());

        // Setup
        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild({ id: "mock-guild-id", scheduledEvents: { create: spy() } as any, valueOf: () => "mock-guild-id" })
          .withStringOption((name) => {
            if (name === "event-name") return "未来のカスタム";
            if (name === "start-date") return "12/25"; // More than 1 month away
            if (name === "start-time") return "12:00";
            return null;
          })
          .build();
        Object.assign(interaction, { channel: { send: spy(() => Promise.resolve({ react: spy() })) }, inGuild: () => true });

        // Execute
        await execute(interaction);

        // Assertions
        assertSpyCall(interaction.reply, 0);
        assertEquals(
          interaction.reply.calls[0].args[0].content,
          "カスタムゲームのイベントを作成しました。募集メッセージを投稿します。\n⚠️ 警告: 開始日時が1ヶ月以上先です。"
        );
      });
    });

    describe("異常系", () => {
      it("日付のフォーマットが不正な場合、エラーメッセージを返信する", async () => {
        // ... (this test doesn't depend on Date.now, so no mock needed)
        const createEventSpy = spy(() => Promise.resolve());
        const mockGuild = { id: "mock-guild-id", scheduledEvents: { create: createEventSpy } as any, valueOf: () => "mock-guild-id" };
        const interaction = newMockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption((name) => {
            if (name === "event-name") return "週末カスタム";
            if (name === "start-date") return "invalid-date";
            if (name === "start-time") return "21:00";
            return null;
          })
          .build();
        Object.assign(interaction, { channel: { send: spy() }, inGuild: () => true });

        await execute(interaction);

        assertSpyCall(interaction.reply, 0);
        assertEquals(interaction.reply.calls[0].args[0].content, "日付または時刻のフォーマットが正しくありません。MM/DD HH:MMの形式で入力してください。");
        assertSpyCalls(createEventSpy, 0);
      });

      it("DMでコマンドが実行された場合、エラーメッセージを返信する", async () => {
        // ... (this test doesn't depend on Date.now, so no mock needed)
        const interaction = newMockInteractionBuilder("create-custom-game").withGuild(null).build();
        Object.assign(interaction, { inGuild: () => false });
        await execute(interaction);
        assertSpyCall(interaction.reply, 0);
        assertEquals(interaction.reply.calls[0].args[0].content, "このコマンドはサーバー内でのみ実行できます。");
      });
    });
  });
});
