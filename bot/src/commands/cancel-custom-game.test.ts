import { describe, test } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { assertSpyCall, spy, stub } from "@std/testing/mock";
import { data, execute } from "./cancel-custom-game.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import {
  ActionRowBuilder,
  Channel,
  InteractionEditReplyOptions,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { messageHandler, messageKeys } from "../messages.ts";
import { apiClient } from "../api_client.ts";
import type { Event } from "@adteemo/api/contract";

describe("Command: cancel-custom-game", () => {
  describe("定義", () => {
    test("コマンド名と説明が期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "cancel-custom-game");
      assertEquals(
        json.description,
        "自分が作成したカスタムゲームイベントをキャンセルします。",
      );
    });
  });

  const FIXED_DATE = new Date("2025-09-28T00:00:00.000Z");

  function eventFixture(overrides: Partial<Event> = {}): Event {
    return {
      id: 1,
      operationKey: "interaction-1",
      name: "Active Event",
      guildId: "guild-456",
      creatorId: "user-123",
      recruitmentChannelId: "channel-1",
      voiceChannelId: "voice-1",
      discordScheduledEventId: "active-event-id",
      recruitmentMessageId: "msg-1",
      phase: "RECRUITING",
      syncState: "CONSISTENT",
      revision: 0,
      discordEventDeleted: false,
      recruitmentMessageDeleted: false,
      lastFailureCode: null,
      scheduledStartAt: FIXED_DATE,
      createdAt: FIXED_DATE,
      updatedAt: null,
      ...overrides,
    };
  }

  test("募集チャンネル内に未中止イベントが存在する場合、作成途中も含めて内部event IDの選択肢を表示する", async () => {
    // Arrange
    const mockDbEvents: Event[] = [
      eventFixture(),
      eventFixture({
        id: 2,
        name: "Preparing Event",
        discordScheduledEventId: null,
        recruitmentMessageId: null,
        phase: "PREPARING",
        syncState: "CREATE_PENDING",
      }),
    ];
    using getEventsStub = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: true, events: mockDbEvents }),
    );
    const mockGuild = new MockGuildBuilder("guild-456").build();
    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .withGuild(mockGuild)
      .withChannel({ id: "channel-1" } as Channel)
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    // Act
    await execute(interaction);

    // Assert
    assertSpyCall(getEventsStub, 0, {
      args: ["guild-456", "channel-1", "user-123"],
    });
    assertSpyCall(deferSpy, 0, {
      args: [{ flags: MessageFlags.Ephemeral }],
    });
    assertSpyCall(editSpy, 0);
    const replyOptions = editSpy.calls[0]
      .args[0] as InteractionEditReplyOptions;
    const row = replyOptions.components![0] as ActionRowBuilder<
      StringSelectMenuBuilder
    >;
    const selectMenu = row.components[0];
    assertExists(selectMenu);
    const menuJSON = selectMenu.toJSON();
    assertEquals(menuJSON.options?.length, 2);
    assertEquals(menuJSON.options?.[0].label, "Active Event");
    assertEquals(menuJSON.options?.[0].value, "1");
    assertEquals(menuJSON.options?.[1].label, "Preparing Event");
    assertEquals(menuJSON.options?.[1].value, "2");
  });

  test("候補が26件ある場合、event指定で26件目を選択できる", async () => {
    // Arrange
    using _getEvents = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () =>
        Promise.resolve({
          success: true,
          events: Array.from({ length: 26 }, (_, i) =>
            eventFixture({ id: i + 1 })),
        }),
    );
    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .withGuild(new MockGuildBuilder("guild-456").build())
      .withChannel({ id: "channel-1" } as Channel)
      .withIntegerOption("event", 26)
      .build();
    using edit = spy(interaction, "editReply");
    // Act
    await execute(interaction);
    // Assert
    const reply = edit.calls[0].args[0] as InteractionEditReplyOptions;
    const row = reply.components![0] as ActionRowBuilder<
      StringSelectMenuBuilder
    >;
    assertEquals(
      row.components[0].toJSON().options.map((option) => option.value),
      ["26"],
    );
  });

  test("アクティブなイベントが存在しない場合、その旨をメッセージで表示する", async () => {
    // Arrange
    using _getEventsStub = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: true, events: [] }),
    );
    using formatMessageSpy = spy(messageHandler, "formatMessage");
    const mockGuild = new MockGuildBuilder("guild-456").build();
    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .withGuild(mockGuild)
      .withChannel({ id: "channel-1" } as Channel)
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    // Act
    await execute(interaction);

    // Assert
    assertSpyCall(deferSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.customGame.cancel.info.noActiveEvents],
    });
    assertSpyCall(editSpy, 0);
  });

  test("DBからのイベント取得に失敗した場合、エラーメッセージを表示する", async () => {
    // Arrange
    using _getEventsStub = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: false, error: "DB Error" }),
    );
    using formatMessageSpy = spy(messageHandler, "formatMessage");
    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    // Act
    await execute(interaction);

    // Assert
    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.customGame.cancel.error.fetchEvents],
    });
  });
});
