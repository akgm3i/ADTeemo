import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import {
  type ChatInputCommandInteraction,
  InteractionResponse,
  Message,
} from "discord.js";
import { type MatchParticipant } from "../api_client.ts";
import { execute, testable } from "./record-match.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { assertEquals } from "@std/assert";
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

  it("対話フローが正常に完了し、全プレイヤーのデータがAPIに送信される", async () => {
    using _ = stub(
      testable.matchTracker,
      "getActiveParticipants",
      () => Promise.resolve(mockParticipants),
    );
    const createParticipantStub = stub(
      testable.apiClient,
      "createMatchParticipant",
      () => Promise.resolve({ success: true, id: 1, error: null }),
    );
    using _uuidStub = stub(testable, "uuidv4", () => "mock-match-id");

    let askCount = 0;
    const askValues: (string | number)[] = [
      "10/1/1",
      200,
      12000,
      "5/5/5",
      150,
      11000,
    ];
    stub(testable.statCollector, "askForStat", () => {
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

    await execute(interaction as ChatInputCommandInteraction);

    assertSpyCalls(createParticipantStub, 2);

    const firstCallArgs = createParticipantStub.calls[0].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(firstCallArgs[0], "mock-match-id");
    assertEquals(firstCallArgs[1].userId, "user1");
    assertEquals(firstCallArgs[1].kills, 10);
    assertEquals(firstCallArgs[1].win, true);

    const secondCallArgs = createParticipantStub.calls[1].args as [
      string,
      MatchParticipant,
    ];
    assertEquals(secondCallArgs[0], "mock-match-id");
    assertEquals(secondCallArgs[1].userId, "user2");
    assertEquals(secondCallArgs[1].kills, 5);
    assertEquals(secondCallArgs[1].win, true);

    assertSpyCall(followUpSpy, 0);
  });

  // TODO: Add tests for cancellation and timeout scenarios
});
