import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { Collection } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { execute } from "./setup-custom-game.ts";

describe("setup-custom-game", () => {
  test("管理権限がない場合、ギルド設定を保存せず拒否する", async () => {
    const interaction = new MockInteractionBuilder("setup-custom-game").build();
    let saved = false;
    using _save = stub(apiClient, "setCustomGameSettings", () => {
      saved = true;
      throw new Error("must not save");
    });
    let reply = "";
    using _reply = stub(interaction, "reply", (options) => {
      reply = JSON.stringify(options);
      return Promise.resolve(undefined as never);
    });
    await execute(interaction);
    assertEquals(saved, false);
    assertStringIncludes(reply, "サーバー管理");
  });

  test("管理者が募集とVCを選んで保存すると、ギルドとchannel・role IDの組合せをAPIへ渡す", async () => {
    const roles = new Collection(
      ["Top", "JG", "Mid", "Bot", "Sup"].map((
        name,
      ) => [name, { id: `role-${name}`, name }]),
    );
    const interaction = new MockInteractionBuilder("setup-custom-game")
      .withGuild({ id: "guild", roles: { cache: roles } })
      .withChannelOption("recruitment", { id: "recruit" })
      .withChannelOption("lobby", { id: "lobby" })
      .withChannelOption("red", { id: "red" })
      .withChannelOption("blue", { id: "blue" }).build();
    Object.defineProperty(interaction, "memberPermissions", {
      value: { has: () => true },
    });
    let saved: unknown;
    using _save = stub(
      apiClient,
      "setCustomGameSettings",
      (guildId, settings) => {
        saved = { guildId, settings };
        return Promise.resolve({ success: true, settings });
      },
    );
    using _defer = stub(
      interaction,
      "deferReply",
      () => Promise.resolve(undefined as never),
    );
    using _edit = stub(
      interaction,
      "editReply",
      () => Promise.resolve(undefined as never),
    );
    await execute(interaction);
    assertEquals(saved, {
      guildId: "guild",
      settings: {
        recruitmentChannelId: "recruit",
        lobbyChannelId: "lobby",
        redChannelId: "red",
        blueChannelId: "blue",
        roleIds: {
          Top: "role-Top",
          Jungle: "role-JG",
          Middle: "role-Mid",
          Bottom: "role-Bot",
          Support: "role-Sup",
        },
      },
    });
  });
});
