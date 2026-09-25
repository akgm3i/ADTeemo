import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { spy, stub } from "@std/testing/mock";
import type {
  CustomGameEventParticipant,
  CustomGameSettings,
  Event,
} from "@adteemo/api/contract";
import { lanes } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import { execute } from "./next-game.ts";

const settings: CustomGameSettings = {
  recruitmentChannelId: "mock-channel-id",
  lobbyChannelId: "lobby",
  redChannelId: "red",
  blueChannelId: "blue",
  roleIds: {
    Top: "top",
    Jungle: "jg",
    Middle: "mid",
    Bottom: "bot",
    Support: "sup",
  },
};
const event: Event = {
  id: 42,
  name: "custom",
  guildId: "guild",
  creatorId: "mock-user-id",
  recruitmentChannelId: "mock-channel-id",
  operationKey: "operation",
  voiceChannelId: "lobby",
  discordScheduledEventId: "scheduled",
  recruitmentMessageId: "recruitment",
  phase: "RECRUITING",
  syncState: "CONSISTENT",
  revision: 1,
  discordEventDeleted: false,
  recruitmentMessageDeleted: false,
  lastFailureCode: null,
  scheduledStartAt: new Date(),
  createdAt: new Date(),
  updatedAt: null,
};
const roster: CustomGameEventParticipant[] = (["RED", "BLUE"] as const).flatMap(
  (team) =>
    lanes.map((lane) => ({
      eventId: 42,
      userId: `${team}-${lane}`,
      team,
      lane,
      createdAt: new Date(),
    })),
);

describe("次ゲームのロビー復帰", () => {
  test("確定済み参加者をロビーへ戻す際にVC移動が失敗しても、再実行で同じ次番号を案内しロスターを変更しない", async () => {
    let unavailable = true;
    const destinations: string[] = [];
    const guild = new MockGuildBuilder("guild");
    for (const participant of roster) {
      guild.withMember({
        id: participant.userId,
        voice: {
          setChannel: (channel: unknown) => {
            if (unavailable) return Promise.reject(new Error("VC移動不可"));
            destinations.push(String(channel));
            return Promise.resolve(undefined as never);
          },
        },
      });
    }
    const interaction = new MockInteractionBuilder("next-game").withGuild(
      guild.build(),
    ).withIntegerOption("event", 42).build();
    using _events = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: true, events: [event] }),
    );
    using _settings = stub(
      apiClient,
      "getCustomGameSettings",
      () => Promise.resolve({ success: true, settings }),
    );
    using _roster = stub(
      apiClient,
      "getCustomGameEventParticipants",
      () => Promise.resolve({ success: true, participants: roster }),
    );
    using _next = stub(
      apiClient,
      "getNextCustomGameSequence",
      () => Promise.resolve({ success: true, gameSequence: 2 }),
    );
    using _save = stub(apiClient, "saveCustomGameEventParticipants", () => {
      throw new Error("must not overwrite roster");
    });
    using edit = spy(interaction, "editReply");
    await execute(interaction);
    assertStringIncludes(String(edit.calls[0].args[0]), "VC移動不可");
    unavailable = false;
    await execute(interaction);
    assertEquals(destinations, Array(10).fill("lobby"));
    assertStringIncludes(String(edit.calls[1].args[0]), "2");
    assertStringIncludes(String(edit.calls[1].args[0]), "42");
  });

  test("確定参加者の一部がguildから取得できない場合、VC移動を開始しない", async () => {
    let moved = false;
    const guild = new MockGuildBuilder("guild").withMember({
      id: roster[0].userId,
      voice: {
        setChannel: () => {
          moved = true;
          return Promise.resolve(undefined as never);
        },
      },
    }).build();
    const interaction = new MockInteractionBuilder("next-game").withGuild(guild)
      .withIntegerOption("event", 42).build();
    using _events = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: true, events: [event] }),
    );
    using _settings = stub(
      apiClient,
      "getCustomGameSettings",
      () => Promise.resolve({ success: true, settings }),
    );
    using _roster = stub(
      apiClient,
      "getCustomGameEventParticipants",
      () => Promise.resolve({ success: true, participants: roster }),
    );
    using _next = stub(
      apiClient,
      "getNextCustomGameSequence",
      () => Promise.resolve({ success: true, gameSequence: 2 }),
    );
    using edit = spy(interaction, "editReply");
    await execute(interaction);
    assertEquals(moved, false);
    assertStringIncludes(String(edit.calls[0].args[0]), "参加者");
  });
});
