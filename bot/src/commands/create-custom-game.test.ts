import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertSpyCall,
  assertSpyCalls,
  Spy,
  spy,
  stub,
} from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { execute, testable } from "./create-custom-game.ts";
import {
  Channel,
  ChannelType,
  GuildScheduledEventCreateOptions,
  Message,
  MessageFlags,
} from "discord.js";
import { messageKeys } from "../messages.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import { assertEquals } from "@std/assert";
import { parse } from "@std/datetime";

describe("Create Custom Game Command", () => {
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
      it("有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する", async () => {
        using _ = stub(
          testable.apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true, error: null }),
        );
        using _formatSpy = spy(testable, "formatMessage");

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
          .withStringOption("event-name", "週末カスタム")
          .withStringOption("start-date", "09/13")
          .withStringOption("start-time", "21:00")
          .withChannelOption("voice-channel", mockVoiceChannel)
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;

        using deferSpy = spy(interaction, "deferReply");
        using editSpy = spy(interaction, "editReply");

        await execute(interaction);

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

        const createApiCall = (testable.apiClient.createCustomGameEvent as Spy)
          .calls[0];
        assertEquals(createApiCall.args[0].name, "週末カスタム");
        assertEquals(createApiCall.args[0].scheduledStartAt, expectedDate);
      });

      it("過去の日付が指定された場合、翌年の日付として扱いイベントを作成する", async () => {
        using _ = stub(
          testable.apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true, error: null }),
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
          .withStringOption("event-name", "新年カスタム")
          .withStringOption("start-date", "01/15")
          .withStringOption("start-time", "12:00")
          .withChannelOption(
            "voice-channel",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;

        await execute(interaction);

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

      it("開始日時が1ヶ月以上先の場合、警告メッセージ付きで成功応答を返す", async () => {
        using _ = stub(
          testable.apiClient,
          "createCustomGameEvent",
          () => Promise.resolve({ success: true, error: null }),
        );
        using formatSpy = spy(testable, "formatMessage");
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(new MockGuildBuilder().build())
          .withChannel(
            {
              send: () =>
                Promise.resolve({ react: spy() } as unknown as Message),
            } as unknown as Channel,
          )
          .withStringOption("event-name", "未来のカスタム")
          .withStringOption("start-date", "12/25")
          .withStringOption("start-time", "12:00")
          .withChannelOption(
            "voice-channel",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;
        using editSpy = spy(interaction, "editReply");

        await execute(interaction);

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
      it("日付のフォーマットが不正な場合、エラーメッセージを返信する", async () => {
        const mockGuild = new MockGuildBuilder().build();
        const createScheduledEventSpy = spy(
          mockGuild.scheduledEvents,
          "create",
        );
        const interaction = new MockInteractionBuilder("create-custom-game")
          .withGuild(mockGuild)
          .withStringOption("event-name", "Test")
          .withStringOption("start-date", "invalid-date")
          .withStringOption("start-time", "21:00")
          .withChannelOption(
            "voice-channel",
            { id: "vc-id" } as unknown as Channel,
          )
          .build();
        (interaction as { inGuild: () => true }).inGuild = () => true;
        using replySpy = spy(interaction, "reply");
        using formatSpy = stub(
          testable,
          "formatMessage",
          () => "mocked error message",
        );

        await execute(interaction);

        assertSpyCall(replySpy, 0, {
          args: [{
            content: "mocked error message",
            flags: MessageFlags.Ephemeral,
          }],
        });
        assertSpyCall(formatSpy, 0, {
          args: [messageKeys.customGame.create.error.invalidDateTimeFormat],
        });
        assertSpyCalls(createScheduledEventSpy, 0);
      });

      it("DMでコマンドが実行された場合、エラーメッセージを返信する", async () => {
        const interaction = new MockInteractionBuilder().withGuild(null)
          .setIsChatInputCommand(true)
          .build();
        (interaction as { inGuild: () => false }).inGuild = () => false;
        using replySpy = spy(interaction, "reply");
        using formatSpy = stub(
          testable,
          "formatMessage",
          () => "mocked guild only message",
        );

        await execute(interaction);

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
