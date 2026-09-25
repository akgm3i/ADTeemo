import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import type {
  CommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { account as riotAccount } from "../features/testing/match_tracking_fixtures.ts";
import { execute, handleRiotAccountSelection } from "./riot-accounts.ts";

describe("複数accountの管理コマンド", () => {
  test("本人の一覧を開くと、mainとsubを区別した表示と選択肢を返す", async () => {
    const interaction = new MockInteractionBuilder("riot-accounts").withUser({
      id: "owner",
    }).withStringOption("action", "main").build();
    using list = stub(
      apiClient,
      "getRiotAccounts",
      () =>
        Promise.resolve({
          success: true,
          accounts: [
            riotAccount({ gameName: "Main", puuid: "main", isMain: true }),
            riotAccount({ gameName: "Sub", puuid: "sub", isMain: false }),
          ],
        }),
    );
    using reply = stub(
      interaction,
      "editReply",
      () => Promise.resolve({} as never),
    );
    await execute(interaction as unknown as CommandInteraction);
    assertSpyCall(list, 0, { args: ["owner"] });
    const message = reply.calls[0].args[0] as unknown as {
      content: string;
      components: {
        toJSON(): { components: { options: { value: string }[] }[] };
      }[];
    };
    assertStringIncludes(message.content, "Main");
    assertStringIncludes(message.content, "Sub");
    assertEquals(
      message.components[0].toJSON().components[0].options.map((option) =>
        option.value
      ),
      ["main", "sub"],
    );
  });
  test("本人がmain選択を確定すると、選んだPUUIDだけを本人scopeで変更する", async () => {
    using select = stub(
      apiClient,
      "setMainRiotAccount",
      () => Promise.resolve({ success: true }),
    );
    const interaction = {
      customId: "riot-accounts:main:owner",
      user: { id: "owner" },
      values: ["sub"],
      deferUpdate: () => Promise.resolve(),
      editReply: () => Promise.resolve(),
    };
    await handleRiotAccountSelection(
      interaction as unknown as StringSelectMenuInteraction,
    );
    assertSpyCall(select, 0, { args: ["owner", "sub"] });
  });
  test("本人が解除を確定すると、選んだPUUIDだけを解除する", async () => {
    using remove = stub(
      apiClient,
      "deleteRiotAccount",
      () => Promise.resolve({ success: true }),
    );
    const interaction = {
      customId: "riot-accounts:remove:owner",
      user: { id: "owner" },
      values: ["sub"],
      deferUpdate: () => Promise.resolve(),
      editReply: () => Promise.resolve(),
    };
    await handleRiotAccountSelection(
      interaction as unknown as StringSelectMenuInteraction,
    );
    assertSpyCall(remove, 0, { args: ["owner", "sub"] });
  });
  test("他人の選択UIを操作しても、変更APIを呼ばない", async () => {
    using remove = stub(apiClient, "deleteRiotAccount", () => {
      throw new Error("unexpected delete");
    });
    const interaction = {
      customId: "riot-accounts:remove:owner",
      user: { id: "other" },
      values: ["sub"],
      reply: () => Promise.resolve(),
    };
    await handleRiotAccountSelection(
      interaction as unknown as StringSelectMenuInteraction,
    );
    assertSpyCalls(remove, 0);
  });
});
