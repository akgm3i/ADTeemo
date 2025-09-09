import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCall, assertSpyCallArg, assertSpyCallArgs, assertSpyCalls, restore, stub } from "jsr:@std/testing/mock";
import { execute } from "./cancel-custom-game.ts";
import { apiClient } from "../api_client.ts";
import { newMockChatInputCommandInteractionBuilder } from "../test_utils.ts";
import {
  Collection,
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventManager,
  GuildScheduledEventStatus,
  MessageFlags,
} from "npm:discord.js";

describe("Command: cancel-custom-game", () => {
  afterEach(() => {
    restore();
  });

  describe("execute", () => {
    it("アクティブなイベントが存在する場合、イベント選択用のセレクトメニューを表示する", async () => {
      const mockDbEvents = [
        {
          id: 1,
          name: "Active Event",
          discordScheduledEventId: "active-event-id",
          createdAt: new Date().toISOString(),
          guildId: "g",
          creatorId: "c",
          recruitmentMessageId: "m",
        },
        {
          id: 2,
          name: "Finished Event",
          discordScheduledEventId: "finished-event-id",
          createdAt: new Date().toISOString(),
          guildId: "g",
          creatorId: "c",
          recruitmentMessageId: "m",
        },
      ];
      using getCustomGameEventsStub = stub(
        apiClient,
        "getCustomGameEventsByCreatorId",
        (id) =>
          Promise.resolve({ success: true, events: mockDbEvents, error: null }),
      );

      const mockDiscordEvents = new Collection<string, GuildScheduledEvent>();
      mockDiscordEvents.set("active-event-id", {
        id: "active-event-id",
        status: GuildScheduledEventStatus.Scheduled,
      } as GuildScheduledEvent);
      mockDiscordEvents.set("finished-event-id", {
        id: "finished-event-id",
        status: GuildScheduledEventStatus.Completed,
      } as GuildScheduledEvent);

      const mockScheduledEvents = {
        fetch: () => Promise.resolve(mockDiscordEvents),
      } as unknown as GuildScheduledEventManager;

      const mockGuild = {
        id: "mock-guild-id",
        scheduledEvents: mockScheduledEvents,
      } as unknown as Guild;

      const interaction = newMockChatInputCommandInteractionBuilder(
        "cancel-custom-game",
      )
        .withGuild(mockGuild)
        .build();
      Object.assign(interaction, { inGuild: () => true });

      await execute(interaction);

      assertSpyCallArgs(getCustomGameEventsStub, 0, ['test-user-id'])
      assertSpyCallArgs(interaction.deferReply, 0, [{ flags: MessageFlags.Ephemeral }]);
      assertSpyCalls(interaction.editReply, 1);
      const replyOptions = interaction.editReply.calls[0].args[0];
      assertEquals(replyOptions.content, "Select an event to cancel:");
      const selectMenu = JSON.parse(
        JSON.stringify(replyOptions.components[0].components[0]),
      );
      assertEquals(selectMenu.options.length, 1);
      assertEquals(selectMenu.options[0].label, "Active Event");
      assertEquals(selectMenu.options[0].value, "active-event-id:m");
    });

    it("アクティブなイベントが存在しない場合、その旨をメッセージで表示する", async () => {
      const mockDbEvents = [
        {
          id: 1,
          name: "Finished Event",
          discordScheduledEventId: "finished-event-id",
          createdAt: new Date().toISOString(),
          guildId: "g",
          creatorId: "c",
          recruitmentMessageId: "m",
        },
      ];
      stub(
        apiClient,
        "getCustomGameEventsByCreatorId",
        () =>
          Promise.resolve({ success: true, events: mockDbEvents, error: null }),
      );

      const mockDiscordEvents = new Collection<string, GuildScheduledEvent>();
      mockDiscordEvents.set("finished-event-id", {
        id: "finished-event-id",
        status: GuildScheduledEventStatus.Completed,
      } as GuildScheduledEvent);

      const mockScheduledEvents = {
        fetch: () => Promise.resolve(mockDiscordEvents),
      } as unknown as GuildScheduledEventManager;

      const mockGuild = {
        id: "mock-guild-id",
        scheduledEvents: mockScheduledEvents,
      } as unknown as Guild;

      const interaction = newMockChatInputCommandInteractionBuilder(
        "cancel-custom-game",
      )
        .withGuild(mockGuild)
        .build();
      Object.assign(interaction, { inGuild: () => true });

      await execute(interaction);

      assertSpyCall(interaction.deferReply, 0, {
        args: [{ flags: MessageFlags.Ephemeral }],
      });
      assertSpyCall(interaction.editReply, 0, {
        args: ["You have no active events to cancel."],
      });
    });
  });
});
