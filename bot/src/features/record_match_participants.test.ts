import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import type {
  CustomGameEventParticipant,
  Event,
  Lane,
} from "@adteemo/api/contract";
import type { GuildMember } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockGuildBuilder } from "../test_utils.ts";
import { recordMatchParticipantProvider } from "./record_match_participants.ts";

const lanes: Lane[] = ["Top", "Jungle", "Middle", "Bottom", "Support"];

function event(): Event {
  return {
    id: 42,
    operationKey: "interaction-42",
    name: "8月1日カスタム",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    discordScheduledEventId: "discord-event-1",
    recruitmentMessageId: "message-1",
    phase: "RECRUITING",
    syncState: "CONSISTENT",
    revision: 3,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    scheduledStartAt: new Date("2026-08-01T12:00:00+09:00"),
    createdAt: new Date("2026-08-01T09:00:00+09:00"),
    updatedAt: null,
  };
}

function roster(): CustomGameEventParticipant[] {
  return ["BLUE", "RED"].flatMap((team) =>
    lanes.map((lane, index) => ({
      eventId: 42,
      userId: `${team.toLowerCase()}-${index + 1}`,
      team: team as "BLUE" | "RED",
      lane,
      createdAt: new Date("2026-08-01T09:30:00+09:00"),
    }))
  );
}

describe("record-match participant provider", () => {
  test("ギルドと募集チャンネルに属する当日のイベントから確定済み10人を取得する", async () => {
    const activeEvent = event();
    const savedRoster = roster();
    const guildBuilder = new MockGuildBuilder("guild-1");
    for (const participant of savedRoster) {
      guildBuilder.withMember({
        id: participant.userId,
        user: {
          id: participant.userId,
          username: `name-${participant.userId}`,
        },
      } as GuildMember);
    }
    const guild = guildBuilder.build();
    using eventStub = stub(
      apiClient,
      "getEventStartingTodayByCreator",
      () => Promise.resolve({ success: true as const, event: activeEvent }),
    );
    using rosterStub = stub(
      apiClient,
      "getCustomGameEventParticipants",
      () =>
        Promise.resolve({ success: true as const, participants: savedRoster }),
    );

    const result = await recordMatchParticipantProvider.getActiveParticipants({
      guild,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
      creatorId: "creator-1",
    });

    assertEquals(result.event, activeEvent);
    assertEquals(result.participants.length, 10);
    assertEquals(result.participants[0], {
      user: { id: "blue-1", username: "name-blue-1" },
      lane: "Top",
      team: "BLUE",
    });
    assertSpyCall(eventStub, 0, {
      args: ["guild-1", "channel-1", "creator-1"],
    });
    assertSpyCall(rosterStub, 0, {
      args: [42, {
        guildId: "guild-1",
        recruitmentChannelId: "channel-1",
      }],
    });
  });

  test("当日のイベント取得が失敗した場合は固定参加者へフォールバックしない", async () => {
    const guild = new MockGuildBuilder("guild-1").build();
    using _eventStub = stub(
      apiClient,
      "getEventStartingTodayByCreator",
      () => Promise.resolve({ success: false as const, error: "not found" }),
    );

    await assertRejects(
      () =>
        recordMatchParticipantProvider.getActiveParticipants({
          guild,
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          creatorId: "creator-1",
        }),
      Error,
      "not found",
    );
  });

  test("確定済み参加者が10人でない場合は入力を開始しない", async () => {
    const guild = new MockGuildBuilder("guild-1").build();
    using _eventStub = stub(
      apiClient,
      "getEventStartingTodayByCreator",
      () => Promise.resolve({ success: true as const, event: event() }),
    );
    using _rosterStub = stub(
      apiClient,
      "getCustomGameEventParticipants",
      () =>
        Promise.resolve({
          success: true as const,
          participants: roster().slice(0, 9),
        }),
    );

    await assertRejects(
      () =>
        recordMatchParticipantProvider.getActiveParticipants({
          guild,
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          creatorId: "creator-1",
        }),
      Error,
      "10 participants",
    );
  });
});
