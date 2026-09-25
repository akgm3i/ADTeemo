import { assertSpyCall, stub } from "@std/testing/mock";
import { describe, test } from "@std/testing/bdd";
import type { CommandInteraction } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { execute } from "./watch-preference.ts";
describe("本人の監視opt-out", () => {
  test("opt-outを選ぶと、実行者と現在guildだけを停止する", async () => {
    const interaction = new MockInteractionBuilder("watch-preference").withUser(
      { id: "owner" },
    ).withStringOption("action", "opt-out").build();
    using update = stub(
      apiClient,
      "setMatchWatchOptOut",
      () => Promise.resolve({ success: true }),
    );
    await execute(interaction as unknown as CommandInteraction);
    assertSpyCall(update, 0, { args: ["mock-guild-id", "owner", true] });
  });
});
