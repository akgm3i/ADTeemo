import { afterEach, describe, it } from "@std/testing/bdd";
import { assertSpyCalls, restore, spy, stub } from "@std/testing/mock";
import {
  type ChatInputCommandInteraction,
  Message,
  TextBasedChannel,
} from "discord.js";
import { apiClient, type MatchParticipant } from "../api_client.ts";
import { execute } from "./record-match.ts";
import { newMockChatInputCommandInteractionBuilder } from "../test_utils.ts";
import { assertEquals } from "@std/assert";
import { matchTracker } from "../features/match_tracking.ts";
import { statCollector } from "../features/stat_collector.ts";
import type { Lane } from "@adteemo/api/schema";

describe("/record-match command", () => {
  const mockParticipants: {
    user: { id: string; username: string };
    lane: Lane;
    team: "BLUE" | "RED";
  }[] = [
    { user: { id: "user1", username: "Player1" }, lane: "Top", team: "BLUE" },
    {
      user: { id: "user2", username: "Player2" },
      lane: "Jungle",
      team: "BLUE",
    },
  ];

  afterEach(() => {
    restore();
  });

  it("対話フローが正常に完了し、全プレイヤーのデータがAPIに送信される", async () => {
    using _ = stub(
      matchTracker,
      "getActiveParticipants",
      () => Promise.resolve(mockParticipants),
    );
    const apiClientStub = stub(
      apiClient,
      "createMatchParticipant",
      () => Promise.resolve({ success: true, id: 1, error: null }),
    );

    let askCount = 0;
    const askValues: (string | number)[] = [
      "10/1/1",
      200,
      12000,
      "5/5/5",
      150,
      11000,
    ];
    stub(statCollector, "askForStat", () => {
      return Promise.resolve(askValues[askCount++]);
    });

    const mockChannel = {
      isTextBased: () => true,
    } as Partial<TextBasedChannel>;

    const interaction = newMockChatInputCommandInteractionBuilder(
      "record-match",
    )
      .withStringOption((name) => (name === "winning_team" ? "BLUE" : null))
      .withChannel(mockChannel)
      .withDeferReply(() =>
        Promise.resolve({
          awaitMessageComponent: () =>
            Promise.resolve({
              customId: "confirm_record_match",
              update: spy(),
              isButton: () => true,
            }),
        } as unknown as Message)
      )
      .build();

    await execute(interaction as unknown as ChatInputCommandInteraction);

    assertSpyCalls(apiClientStub, 2);
    const firstCallArgs = apiClientStub.calls[0].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(firstCallArgs[1].kills, 10);
    assertEquals(firstCallArgs[1].win, true);

    const secondCallArgs = apiClientStub.calls[1].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(secondCallArgs[1].kills, 5);
    assertEquals(secondCallArgs[1].win, true);
  });
});