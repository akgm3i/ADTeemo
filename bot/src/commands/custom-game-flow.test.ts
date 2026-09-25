import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Event } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { execute as startMatching } from "./start-matching.ts";
import { selectOwnedCustomGameEvent } from "../features/custom_game_selection.ts";
const event: Event = {
  id: 1,
  name: "future event",
  guildId: "mock-guild-id",
  creatorId: "mock-user-id",
  recruitmentChannelId: "mock-channel-id",
  operationKey: "operation",
  voiceChannelId: "lobby",
  discordScheduledEventId: "discord-event",
  recruitmentMessageId: "message",
  phase: "RECRUITING",
  syncState: "CONSISTENT",
  revision: 1,
  discordEventDeleted: false,
  recruitmentMessageDeleted: false,
  lastFailureCode: null,
  scheduledStartAt: new Date("2030-01-01T00:00:00Z"),
  createdAt: new Date(),
  updatedAt: null,
};

describe("イベント選択フロー", () => {
  test("複数の作成済みイベントがある場合、今日以外も含む選択メニューへIDを載せる", async () => {
    const interaction = new MockInteractionBuilder("start-matching").build();
    using list = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () =>
        Promise.resolve({
          success: true,
          events: [event, { ...event, id: 2, name: "second" }],
        }),
    );
    using edit = spy(interaction, "editReply");
    await startMatching(interaction);
    assertSpyCall(list, 0, {
      args: ["mock-guild-id", "mock-channel-id", "mock-user-id"],
    });
    const reply = JSON.parse(JSON.stringify(edit.calls[0].args[0]));
    assertEquals(
      reply.components[0].components[0].custom_id,
      "split-event-select",
    );
    assertEquals(
      reply.components[0].components[0].options.map((
        option: { value: string },
      ) => option.value),
      ["1", "2"],
    );
  });

  test("他人または他guild/channelのイベントIDが選ばれた場合、実行前に拒否する", async () => {
    const input = {
      guildId: event.guildId,
      recruitmentChannelId: event.recruitmentChannelId!,
      creatorId: event.creatorId,
      eventId: event.id,
    };
    for (
      const changed of [{ creatorId: "other" }, { guildId: "other" }, {
        recruitmentChannelId: "other",
      }]
    ) {
      using _list = stub(
        apiClient,
        "getCustomGameEventsByCreator",
        () =>
          Promise.resolve({
            success: true,
            events: [{ ...event, ...changed }],
          }),
      );
      await assertRejects(() => selectOwnedCustomGameEvent(input));
    }
  });

  test("イベント一覧の取得が失敗した場合、選択UIやDiscord side effectを開始しない", async () => {
    const interaction = new MockInteractionBuilder("start-matching").build();
    using _list = stub(
      apiClient,
      "getCustomGameEventsByCreator",
      () => Promise.resolve({ success: false, error: "API failed" }),
    );
    using edit = spy(interaction, "editReply");
    await startMatching(interaction);
    assertSpyCalls(edit, 1);
    assertEquals(typeof edit.calls[0].args[0], "string");
  });
});
