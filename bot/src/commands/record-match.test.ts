import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import {
  type ChatInputCommandInteraction,
  InteractionResponse,
  Message,
} from "discord.js";
import { apiClient, type MatchParticipant } from "../api_client.ts";
import { execute } from "./record-match.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { assertEquals } from "@std/assert";
import type { Lane } from "@adteemo/api/schema";
import { matchTracker } from "../features/match_tracking.ts";
import { statCollector } from "../features/stat_collector.ts";

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

  test("対話フローが正常に完了し、全プレイヤーのデータがAPIに送信される", async () => {
    // Arrange
    using _getActiveParticipantsStub = stub(
      matchTracker,
      "getActiveParticipants",
      () => Promise.resolve(mockParticipants),
    );
    using createParticipantStub = stub(
      apiClient,
      "createMatchParticipant",
      () => Promise.resolve({ success: true, id: 1, error: null }),
    );
    const mockMatchId: `${string}-${string}-${string}-${string}-${string}` =
      "a1b2c3d4-e5f6-7890-1234-567890abcdef";
    using _uuidStub = stub(crypto, "randomUUID", () => mockMatchId);

    let askCount = 0;
    const askValues: (string | number)[] = [
      "10/1/1",
      200,
      12000,
      "5/5/5",
      150,
      11000,
    ];
    using _askForStatStub = stub(statCollector, "askForStat", () => {
      return Promise.resolve(askValues[askCount++]);
    });

    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winning_team", "BLUE")
      .build();

    const mockReply = {
      awaitMessageComponent: () =>
        Promise.resolve({
          customId: "confirm_record_match",
          update: spy(),
        }),
    } as unknown as Message;

    using _deferReplyStub = stub(
      interaction,
      "deferReply",
      () => Promise.resolve(mockReply as unknown as InteractionResponse),
    );
    using followUpSpy = spy(interaction, "followUp");

    (interaction.channel as { isTextBased: () => true }).isTextBased = () =>
      true;

    // Act
    await execute(interaction as ChatInputCommandInteraction);

    // Assert
    assertSpyCalls(createParticipantStub, 2);

    const firstCallArgs = createParticipantStub.calls[0].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(firstCallArgs[0], mockMatchId);
    assertEquals(firstCallArgs[1].userId, "user1");
    assertEquals(firstCallArgs[1].kills, 10);
    assertEquals(firstCallArgs[1].win, true);

    const secondCallArgs = createParticipantStub.calls[1].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(secondCallArgs[0], mockMatchId);
    assertEquals(secondCallArgs[1].userId, "user2");
    assertEquals(secondCallArgs[1].kills, 5);
    assertEquals(secondCallArgs[1].win, true);

    assertSpyCall(followUpSpy, 0);
  });

  // TODO: Add tests for cancellation and timeout scenarios
});
