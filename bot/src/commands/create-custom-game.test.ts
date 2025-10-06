import { afterEach, beforeEach, describe, test } from "@std/testing/bdd";
import {
  assertSpyCall,
  assertSpyCalls,
  Spy,
  spy,
  stub,
} from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { data, execute } from "./create-custom-game.ts";
import {
  Channel,
  ChannelType,
  GuildScheduledEventCreateOptions,
  Message,
  MessageFlags,
} from "discord.js";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import { assertEquals } from "@std/assert";
import { parse } from "@std/datetime";
import { apiClient } from "../api_client.ts";

describe("Create Custom Game Command", () => {
  describe("定義", () => {
    test("コマンド名、説明、オプションが期待通りに設定されている", () => {
      const json = data.toJSON();

      assertEquals(json.name, "create-custom-game");
      assertEquals(
        json.description,
        "カスタムゲームのイベントを作成して参加募集を始めます。",
      );

      const options = json.options ?? [];
      assertEquals(options.map((option) => option.name), [
        "title",
        "date",
        "time",
        "voice",
      ]);

      const optionByName = new Map(
        options.map((option) => [option.name, option]),
      );
      assertEquals(optionByName.get("title")?.description, "イベント名");
      assertEquals(optionByName.get("date")?.description, "開始日 (MM/DD形式)");
      assertEquals(
        optionByName.get("time")?.description,
        "開始時刻 (HH:mm形式)",
      );
      const voiceOption = optionByName.get("voice");
      assertEquals(voiceOption?.description, "使用するボイスチャンネル");
      assertEquals(voiceOption?.type, 7); // 7 = Channel option
    });
  });

  let time: FakeTime;
  const mockNow = new Date("2025-09-03T10:00:00Z"); // It's a Wednesday

  beforeEach(() => {
    time = new FakeTime(mockNow);
  });

  afterEach(() => {
    time.restore();
  });

  describe("execute", () => {
    describe("正常系", () => {
      test("有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する", async () => {
        // Arrange
        using _apiStub = stub(
          apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true }),
        );
        using _formatSpy = spy(messageHandler, "formatMessage");
        const mockGuild = new MockGuildBuilder().build();
        const createScheduledEventSpy = spy(
          mockGuild.scheduledEvents,
          "create",
        );
        const reactSpy = spy(() => Promise.resolve({} as Message));
        const sendSpy = spy(() =>
          Promise.resolve(
            { id: "mock-message-id", react: reactSpy } as unknown as Message,
          )
        );
        const mockChannel = { id: "c-id", send: sendSpy } as unknown as Channel;
        const mockVoiceChannel = {
          id: "vc-id",
          type: ChannelType.GuildVoice,
        } as unknown as Channel;
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withChannel(mockChannel)
          .withStringOption("title", "週末カスタム")
          .withStringOption("date", "09/13")
          .withStringOption("time", "21:00")
          .withChannelOption("voice", mockVoiceChannel)
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;
        using deferSpy = spy(interaction, "deferReply");
        using editSpy = spy(interaction, "editReply");

        // Act
        await execute(interaction);

        // Assert
        const expectedDate = parse("2025/09/13 21:00", "yyyy/MM/dd HH:mm");
        assertSpyCall(createScheduledEventSpy, 0);
        const createEventArgs = createScheduledEventSpy.calls[0]
          .args[0] as GuildScheduledEventCreateOptions;
        assertEquals(createEventArgs.name, "週末カスタム");
        assertEquals(createEventArgs.scheduledStartTime, expectedDate);
        assertSpyCall(sendSpy, 0);
        assertSpyCalls(reactSpy, 5);
        assertSpyCall(deferSpy, 0);
        assertSpyCall(editSpy, 0);
        const createApiCall = (apiClient.createCustomGameEvent as Spy).calls[0];
        assertEquals(createApiCall.args[0].name, "週末カスタム");
        assertEquals(createApiCall.args[0].scheduledStartAt, expectedDate);
      });

      test("過去の日付が指定された場合、翌年の日付として扱いイベントを作成する", async () => {
        // Arrange
        using _ = stub(
          apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true }),
        );
        const mockGuild = new MockGuildBuilder().build();
        const createScheduledEventSpy = spy(
          mockGuild.scheduledEvents,
          "create",
        );
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withChannel(
            {
              send: () =>
                Promise.resolve({ react: spy() } as unknown as Message),
            } as unknown as Channel,
          )
          .withStringOption("title", "新年カスタム")
          .withStringOption("date", "01/15")
          .withStringOption("time", "12:00")
          .withChannelOption(
            "voice",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;

        // Act
        await execute(interaction);

        // Assert
        const nextYear = mockNow.getFullYear() + 1;
        const expectedDate = parse(
          `${nextYear}/01/15 12:00`,
          "yyyy/MM/dd HH:mm",
        );
        assertSpyCall(createScheduledEventSpy, 0);
        const callArgs = createScheduledEventSpy.calls[0]
          .args[0] as GuildScheduledEventCreateOptions;
        assertEquals(callArgs.scheduledStartTime, expectedDate);
      });

      test("開始日時が1ヶ月以上先の場合、警告メッセージ付きで成功応答を返す", async () => {
        // Arrange
        using _ = stub(
          apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true }),
        );
        using formatSpy = spy(messageHandler, "formatMessage");
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(new MockGuildBuilder().build())
          .withChannel(
            {
              send: () =>
                Promise.resolve({ react: spy() } as unknown as Message),
            } as unknown as Channel,
          )
          .withStringOption("title", "未来のカスタム")
          .withStringOption("date", "12/25")
          .withStringOption("time", "12:00")
          .withChannelOption(
            "voice",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;
        using editSpy = spy(interaction, "editReply");

        // Act
        await execute(interaction);

        // Assert
        assertSpyCall(editSpy, 0);
        assertSpyCall(formatSpy, 0, {
          args: [messageKeys.customGame.create.success],
        });
        assertSpyCall(formatSpy, 1, {
          args: [messageKeys.customGame.create.info.dateTooFarWarning],
        });
      });
    });

    describe("異常系", () => {
      test("日付のフォーマットが不正な場合、エラーメッセージを返信する", async () => {
        // Arrange
        const mockGuild = new MockGuildBuilder().build();
        const createScheduledEventSpy = spy(
          mockGuild.scheduledEvents,
          "create",
        );
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withChannel(
            {
              send: spy(() => Promise.resolve({} as Message)),
            } as unknown as Channel,
          )
          .withStringOption("title", "Test")
          .withStringOption("date", "invalid-date")
          .withStringOption("time", "21:00")
          .withChannelOption(
            "voice",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;
        using replySpy = spy(interaction, "reply");
        using deferSpy = spy(interaction, "deferReply");
        using editSpy = spy(interaction, "editReply");
        using formatSpy = stub(
          messageHandler,
          "formatMessage",
          () => "mocked error message",
        );

        // Act
        await execute(interaction);

        // Assert
        assertSpyCall(deferSpy, 0, {
          args: [{ flags: MessageFlags.Ephemeral }],
        });
        assertSpyCall(editSpy, 0, {
          args: ["mocked error message"],
        });
        assertSpyCalls(replySpy, 0);
        assertSpyCall(formatSpy, 0, {
          args: [
            messageKeys.customGame.create.error.invalidDateTimeFormat,
          ],
        });
        assertSpyCalls(createScheduledEventSpy, 0);
      });

      test("DMでコマンドが実行された場合、エラーメッセージを返信する", async () => {
        // Arrange
        const interaction = new MockInteractionBuilder().withGuild(null)
          .setIsChatInputCommand(true)
          .build();
        (interaction as { inGuild: () => false }).inGuild = () => false;
        using replySpy = spy(interaction, "reply");
        using formatSpy = stub(
          messageHandler,
          "formatMessage",
          () => "mocked guild only message",
        );

        // Act
        await execute(interaction);

        // Assert
        assertSpyCall(replySpy, 0, {
          args: [{
            content: "mocked guild only message",
            flags: MessageFlags.Ephemeral,
          }],
        });
        assertSpyCall(formatSpy, 0, {
          args: [messageKeys.common.info.guildOnlyCommand],
        });
      });
    });
  });
});
