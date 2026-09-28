import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { Events } from "discord.js";
import { apiClient } from "./api_client.ts";
import { client } from "./main.ts";
import { MockGuildBuilder } from "./test_utils.ts";

describe("GuildAvailableと起動時membership同期", () => {
  test("READY前のGuildAvailableでは、初期同期と重複するメンバー取得を行わない", async () => {
    // Arrange
    using time = new FakeTime();
    const guild = new MockGuildBuilder().build();
    using _ready = stub(client, "isReady", () => false);
    using _cached = stub(client.guilds.cache, "has", () => true);
    using fetchMembers = spy(guild.members, "fetch");
    using save = stub(
      apiClient,
      "syncGuildMatchWatchMembers",
      () => Promise.resolve({ success: true, limitedAccountCount: 0 }),
    );

    // Act
    client.emit(Events.GuildAvailable, guild);
    await time.runMicrotasks();

    // Assert
    assertSpyCalls(fetchMembers, 0);
    assertSpyCalls(save, 0);
  });

  test("READY後にguildが復旧したときは、完全snapshotを取得して再同期する", async () => {
    // Arrange
    using time = new FakeTime();
    const guild = new MockGuildBuilder().build();
    using _ready = stub(client, "isReady", () => true);
    using _cached = stub(client.guilds.cache, "has", () => true);
    using fetchMembers = spy(guild.members, "fetch");
    using save = stub(
      apiClient,
      "syncGuildMatchWatchMembers",
      () => Promise.resolve({ success: true, limitedAccountCount: 0 }),
    );

    // Act
    client.emit(Events.GuildAvailable, guild);
    await time.runMicrotasks();

    // Assert
    assertSpyCalls(fetchMembers, 1);
    assertSpyCalls(save, 1);
    assertSpyCall(save, 0, { args: [guild.id, []] });
  });
});
