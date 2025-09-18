import {
  afterEach,
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import {
  assertSpyCalls,
  spy,
  stub,
} from "https://deno.land/std@0.224.0/testing/mock.ts";
import {
  type ChatInputCommandInteraction,
} from "discord.js";
import { apiClient, type MatchParticipant } from "../api_client.ts";
import { execute } from "./record-match.ts";
import {
  newMockChatInputCommandInteractionBuilder,
} from "../test_utils.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { matchTracker } from "../features/match_tracking.ts";
import * as statCollector from "../features/stat_collector.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import type { Lane } from "@adteemo/api/schema";

describe("/record-match command", () => {
  let interaction: ChatInputCommandInteraction;
  let apiClientStub: ReturnType<typeof stub>;
  let matchTrackingStub: ReturnType<typeof stub>;
  let askForStatStub: ReturnType<typeof stub>;

  const mockParticipants: { user: { id: string; username: string }; lane: Lane; team: "BLUE" | "RED" }[] = [
    { user: { id: "user1", username: "Player1" }, lane: "Top", team: "BLUE" },
    { user: { id: "user2", username: "Player2" }, lane: "Jungle", team: "BLUE" },
  ];

  beforeEach(() => {
    matchTrackingStub = stub(
      matchTracker,
      "getActiveParticipants",
      () => Promise.resolve(mockParticipants),
    );
  });

  afterEach(() => {
    apiClientStub?.restore();
    matchTrackingStub?.restore();
    askForStatStub?.restore();
  });

  it("対話フローが正常に完了し、全プレイヤーのデータがAPIに送信される", async () => {
    apiClientStub = stub(
      apiClient,
      "createMatchParticipant",
      () => Promise.resolve({ success: true, data: { id: 1 }, error: null }),
    );

    let askCount = 0;
    const askValues = ["10/1/1", 200, 12000, "5/5/5", 150, 11000];
    askForStatStub = stub(statCollector, "askForStat", () => {
        return Promise.resolve(askValues[askCount++]);
    });

    interaction = newMockChatInputCommandInteractionBuilder("record-match")
      .withStringOption((name) => name === "winning_team" ? "BLUE" : null)
      .build() as ChatInputCommandInteraction;

    // @ts-ignore - mock awaitMessageComponent
    interaction.awaitMessageComponent = () =>
      Promise.resolve({
        customId: "confirm_record_match",
        update: spy(),
      });

    await execute(interaction);

    await delay(100);

    assertSpyCalls(apiClientStub, 2);
    const firstCallArgs = apiClientStub.calls[0].args as [string, MatchParticipant];
    assertEquals(firstCallArgs[1].kills, 10);
    assertEquals(firstCallArgs[1].win, true);

    const secondCallArgs = apiClientStub.calls[1].args as [string, MatchParticipant];
    assertEquals(secondCallArgs[1].kills, 5);
    assertEquals(secondCallArgs[1].win, true);
  });
});
