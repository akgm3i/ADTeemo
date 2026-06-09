import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { CommandInteraction } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { data, execute } from "./unwatch-match.ts";

describe("Command: unwatch-match", () => {
  test("コマンド名とオプションが期待通りに設定されている", () => {
    const json = data.toJSON();
    assertEquals(json.name, "unwatch-match");
    assertEquals(json.options?.map((option) => option.name), ["member"]);
  });

  test("メンバーを指定すると、監視解除APIを呼び出す", async () => {
    const interaction = new MockInteractionBuilder("unwatch-match")
      .withUserOption("member", {
        id: "target-1",
        toString: () => "<@target-1>",
      })
      .build();
    using unwatchStub = stub(
      apiClient,
      "unwatchMatch",
      () => Promise.resolve({ success: true as const }),
    );

    await execute(interaction as unknown as CommandInteraction);

    assertSpyCall(unwatchStub, 0, {
      args: ["mock-guild-id", "target-1"],
    });
  });
});
