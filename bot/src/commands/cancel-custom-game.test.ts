import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { assertSpyCall, spy, stub } from "@std/testing/mock";
import { execute, testable } from "./cancel-custom-game.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import {
  ActionRowBuilder,
  GuildScheduledEventStatus,
  InteractionEditReplyOptions,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { messageKeys } from "../messages.ts";
import { CustomGameEvent } from "../types.ts";

describe("Command: cancel-custom-game", () => {
  it("アクティブなイベントが存在する場合、イベント選択用のセレクトメニューを表示する", async () => {
    const mockDbEvents: CustomGameEvent[] = [
      {
        id: 1,
        name: "Active Event",
        discordScheduledEventId: "active-event-id",
        recruitmentMessageId: "msg-1",
        creatorId: "user-123",
        guildId: "guild-456",
        scheduledStartAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        name: "Finished Event",
        discordScheduledEventId: "finished-event-id",
        recruitmentMessageId: "msg-2",
        creatorId: "user-123",
        guildId: "guild-456",
        scheduledStartAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];
    using getEventsStub = stub(
      testable.apiClient,
      "getCustomGameEventsByCreatorId",
      () =>
        Promise.resolve({ success: true, events: mockDbEvents, error: null }),
    );

    const mockGuild = new MockGuildBuilder("guild-456")
      .withScheduledEvent({
        id: "active-event-id",
        status: GuildScheduledEventStatus.Scheduled,
      })
      .withScheduledEvent({
        id: "finished-event-id",
        status: GuildScheduledEventStatus.Completed,
      })
      .build();

    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .withGuild(mockGuild)
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(getEventsStub, 0, { args: ["user-123"] });
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
    assertEquals(menuJSON.options?.length, 1);
    assertEquals(menuJSON.options?.[0].label, "Active Event");
    assertEquals(menuJSON.options?.[0].value, "active-event-id:msg-1");
  });

  it("アクティブなイベントが存在しない場合、その旨をメッセージで表示する", async () => {
    using _getEventsStub = stub(
      testable.apiClient,
      "getCustomGameEventsByCreatorId",
      () => Promise.resolve({ success: true, events: [], error: null }),
    );
    using formatMessageSpy = spy(testable, "formatMessage");

    const mockGuild = new MockGuildBuilder("guild-456").build();
    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .withGuild(mockGuild)
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(deferSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.customGame.cancel.info.noActiveEvents],
    });
    assertSpyCall(editSpy, 0);
  });

  it("DBからのイベント取得に失敗した場合、エラーメッセージを表示する", async () => {
    using _getEventsStub = stub(
      testable.apiClient,
      "getCustomGameEventsByCreatorId",
      () => Promise.resolve({ success: false, events: [], error: "DB Error" }),
    );
    using formatMessageSpy = spy(testable, "formatMessage");

    const interaction = new MockInteractionBuilder("cancel-custom-game")
      .withUser({ id: "user-123" })
      .build();
    (interaction as { inGuild: () => true }).inGuild = () => true;
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.customGame.cancel.error.fetchEvents],
    });
  });
});
