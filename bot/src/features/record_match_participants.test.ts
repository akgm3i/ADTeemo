import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { recordMatchParticipantProvider } from "./record_match_participants.ts";

describe("record-match participant provider", () => {
  test("暫定providerがrecord-match用の固定参加者を返す", async () => {
    // Act
    const participants = await recordMatchParticipantProvider
      .getActiveParticipants();

    // Assert
    assertEquals(participants.length, 10);
    assertEquals(participants[0], {
      user: { id: "user1", username: "Player1" },
      lane: "Top",
      team: "BLUE",
    });
    assertEquals(participants[9], {
      user: { id: "user10", username: "Player10" },
      lane: "Support",
      team: "RED",
    });
  });
});
