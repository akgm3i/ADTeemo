import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { Events, type GuildMember, Partials } from "discord.js";
import { apiClient } from "./api_client.ts";
import { client } from "./main.ts";
import { MockGuildBuilder } from "./test_utils.ts";

describe("GuildAvailableと起動時membership同期", () => {
  test("完全snapshot取得直後に参加と退出が続いても、再取得せず最新membershipを保存する", async () => {
    // Arrange
    using time = new FakeTime();
    const guild = new MockGuildBuilder("burst-guild").build();
    using _ready = stub(client, "isReady", () => true);
    using _cached = stub(client.guilds.cache, "has", () => true);
    using fetchMembers = spy(guild.members, "fetch");
    using save = stub(
      apiClient,
      "syncGuildMatchWatchMembers",
      () => Promise.resolve({ success: true, limitedAccountCount: 0 }),
    );
    const member = (id: string) => ({
      id,
      guild,
      user: { id, bot: false },
    } as GuildMember);

    // Act
    client.emit(Events.GuildAvailable, guild);
    await time.runMicrotasks();
    client.emit(Events.GuildMemberAdd, member("first"));
    client.emit(Events.GuildMemberAdd, member("second"));
    client.emit(Events.GuildMemberRemove, member("first"));
    await time.runMicrotasks();

    // Assert
    assertEquals(client.options.partials?.includes(Partials.GuildMember), true);
    assertSpyCalls(fetchMembers, 1);
    assertSpyCall(save, save.calls.length - 1, {
      args: [guild.id, ["second"]],
    });
  });
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
  test("guild加入では部分cacheを使わず全件取得し、Bot参加とguild退出を正しく反映する", async () => {
    // Arrange
    using time = new FakeTime();
    const guild = new MockGuildBuilder("created-guild")
      .withMember({ id: "cached-only", user: { bot: false } }).build();
    using _ready = stub(client, "isReady", () => true);
    using _cached = stub(client.guilds.cache, "has", () => true);
    using fetchMembers = spy(guild.members, "fetch");
    using save = stub(
      apiClient,
      "syncGuildMatchWatchMembers",
      () => Promise.resolve({ success: true, limitedAccountCount: 0 }),
    );

    // Act
    client.emit(Events.GuildCreate, guild);
    await time.runMicrotasks();
    client.emit(
      Events.GuildMemberAdd,
      { id: "bot", guild, user: { bot: true } } as GuildMember,
    );
    client.emit(
      Events.GuildMemberAdd,
      { id: "joined", guild, user: { bot: false } } as GuildMember,
    );
    await time.runMicrotasks();
    client.emit(Events.GuildDelete, guild);
    await time.runMicrotasks();

    // Assert
    assertSpyCalls(fetchMembers, 1);
    assertEquals(save.calls.map((call) => call.args), [
      [guild.id, []],
      [guild.id, ["joined"]],
      [guild.id, []],
    ]);
  });

  test("guild unavailableで監視を停止し、復帰時にはraw RATE_LIMITEDの秒数を守って完全再取得する", async () => {
    // Arrange
    using time = new FakeTime();
    const guild = new MockGuildBuilder("unavailable-guild").build();
    using _ready = stub(client, "isReady", () => true);
    using _cached = stub(client.guilds.cache, "has", () => true);
    using fetchMembers = spy(guild.members, "fetch");
    using save = stub(
      apiClient,
      "syncGuildMatchWatchMembers",
      () => Promise.resolve({ success: true, limitedAccountCount: 0 }),
    );
    client.emit(Events.GuildAvailable, guild);
    await time.runMicrotasks();
    client.emit(
      Events.GuildMemberAdd,
      { id: "old", guild, user: { bot: false } } as GuildMember,
    );
    await time.runMicrotasks();

    // Act
    client.emit(Events.GuildUnavailable, guild);
    await time.runMicrotasks();
    assertSpyCall(save, save.calls.length - 1, { args: [guild.id, []] });
    client.emit(Events.GuildAvailable, guild);
    client.emit(Events.Raw, {
      op: 0,
      t: "RATE_LIMITED",
      s: 1,
      d: { opcode: 8, retry_after: 45.5, meta: { guild_id: guild.id } },
    });
    await time.tickAsync(45_499);
    assertSpyCalls(fetchMembers, 1);
    await time.tickAsync(1);
    await time.runMicrotasks();

    // Assert
    assertSpyCalls(fetchMembers, 2);
    assertSpyCall(save, save.calls.length - 1, { args: [guild.id, []] });
  });
});
