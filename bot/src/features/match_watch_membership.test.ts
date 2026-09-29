import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { createMatchWatchMembershipSync } from "./match_watch_membership.ts";

function recordingApi() {
  const saved: { guildId: string; ids: string[] }[] = [];
  return {
    saved,
    syncGuildMatchWatchMembers: (guildId: string, ids: string[]) => {
      saved.push({ guildId, ids });
      return Promise.resolve({
        success: true as const,
        limitedAccountCount: 0,
      });
    },
  };
}

const readMembers = (...ids: string[]) => () => Promise.resolve(ids);

describe("監視対象guild membership同期", () => {
  test("同じguildの復旧要求が重なると、完全snapshot取得を1回にまとめる", async () => {
    // Arrange
    const readStarted = Promise.withResolvers<void>();
    const members = Promise.withResolvers<string[]>();
    let reads = 0;
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    const read = () => {
      reads++;
      readStarted.resolve();
      return members.promise;
    };

    // Act
    const first = sync.refresh("guild", read);
    const second = sync.refresh("guild", read);
    await readStarted.promise;
    members.resolve(["member"]);
    await Promise.all([first, second]);

    // Assert
    assertEquals(reads, 1);
    assertEquals(api.saved, [{ guildId: "guild", ids: ["member"] }]);
  });

  test("完全snapshot確立後の連続参加・退出は、Discordを再取得せず最新membershipを保存する", async () => {
    // Arrange
    const api = recordingApi();
    let reads = 0;
    const sync = createMatchWatchMembershipSync(api);
    await sync.initialize([{
      id: "guild",
      readMemberIds: () => {
        reads++;
        return Promise.resolve(["departing", "staying"]);
      },
    }], () => {});

    // Act
    await Promise.all([
      sync.addMember("guild", "new"),
      sync.addMember("guild", "new"),
      sync.removeMember("guild", "departing"),
      sync.removeMember("guild", "missing"),
    ]);

    // Assert
    assertEquals(reads, 1);
    assertEquals(api.saved.at(-1), {
      guildId: "guild",
      ids: ["staying", "new"],
    });
  });

  test("完全snapshotの取得中に参加・退出すると、差分を合成して保存するまでworkerを開始しない", async () => {
    // Arrange
    const readStarted = Promise.withResolvers<void>();
    const members = Promise.withResolvers<string[]>();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    let started = false;
    const initialization = sync.initialize([{
      id: "guild",
      readMemberIds: () => {
        readStarted.resolve();
        return members.promise;
      },
    }], () => {
      started = true;
    });

    // Act
    await readStarted.promise;
    await sync.addMember("guild", "joined");
    await sync.removeMember("guild", "departed");
    assertEquals(api.saved, []);
    assertEquals(started, false);
    members.resolve(["departed", "stayed"]);
    await initialization;

    // Assert
    assertEquals(api.saved, [{ guildId: "guild", ids: ["stayed", "joined"] }]);
    assertEquals(started, true);
  });

  test("snapshot保存中の退出も続けて保存し、APIの古い応答で巻き戻さない", async () => {
    // Arrange
    const api = recordingApi();
    const saveStarted = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<void>();
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: async (guildId, ids) => {
        const result = api.syncGuildMatchWatchMembers(guildId, ids);
        if (api.saved.length === 1) {
          saveStarted.resolve();
          await saved.promise;
        }
        return await result;
      },
    });
    let started = false;
    const initialization = sync.initialize([{
      id: "guild",
      readMemberIds: readMembers("departed", "stayed"),
    }], () => {
      started = true;
    });

    // Act
    await saveStarted.promise;
    const change = sync.removeMember("guild", "departed");
    assertEquals(started, false);
    saved.resolve();
    await Promise.all([initialization, change]);

    // Assert
    assertEquals(api.saved, [
      { guildId: "guild", ids: ["departed", "stayed"] },
      { guildId: "guild", ids: ["stayed"] },
    ]);
    assertEquals(started, true);
  });

  test("一部guildの初期取得に失敗したら空snapshotを保存し、完全同期するまでworkerを開始しない", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    let failed = true;
    let started = false;
    let successfulReads = 0;
    const sync = createMatchWatchMembershipSync(api);
    const guilds = [{
      id: "healthy",
      readMemberIds: () => {
        successfulReads++;
        return Promise.resolve(["member"]);
      },
    }, {
      id: "unavailable",
      readMemberIds: () =>
        failed
          ? Promise.reject(new Error("missing intent"))
          : Promise.resolve(["restored"]),
    }];
    const start = () => {
      started = true;
    };

    // Act
    await assertRejects(
      () => sync.initialize(guilds, start),
      Error,
      "missing intent",
    );
    assertEquals(started, false);
    assertEquals(api.saved.find((s) => s.guildId === "unavailable")?.ids, []);
    failed = false;
    await time.tickAsync(30_000);
    await sync.initialize(guilds, start);

    // Assert
    assertEquals(started, true);
    assertEquals(successfulReads, 1);
    assertEquals(api.saved.at(-1), {
      guildId: "unavailable",
      ids: ["restored"],
    });
  });

  test("復旧時の全件取得はguildごとに30秒を空け、他guildの取得を待たせない", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const reads: { guildId: string; at: number }[] = [];
    const sync = createMatchWatchMembershipSync(api);
    const reader = (guildId: string) => () => {
      reads.push({ guildId, at: Date.now() });
      return Promise.resolve([guildId]);
    };
    await sync.refresh("first", reader("first"));
    const firstAt = reads[0].at;

    // Act
    const recovery = sync.refresh("first", reader("first"));
    const duplicate = sync.refresh("first", reader("first"));
    await sync.refresh("second", reader("second"));
    await time.tickAsync(29_999);
    assertEquals(reads.map((r) => r.guildId), ["first", "second"]);
    await time.tickAsync(1);
    await Promise.all([recovery, duplicate]);

    // Assert
    assertEquals(reads, [
      { guildId: "first", at: firstAt },
      { guildId: "second", at: firstAt },
      { guildId: "first", at: firstAt + 30_000 },
    ]);
  });

  test("RATE_LIMITEDのretry_afterが長いと、秒をmsへ変換して既存の取得待機を延長する", async () => {
    // Arrange
    using time = new FakeTime();
    const sync = createMatchWatchMembershipSync(recordingApi());
    let reads = 0;
    const read = () => {
      reads++;
      return Promise.resolve(["member"]);
    };
    await sync.refresh("guild", read);
    const recovery = sync.refresh("guild", read);

    // Act
    await time.tickAsync(10_000);
    sync.rateLimited("guild", 45.5);
    await time.tickAsync(45_499);
    assertEquals(reads, 1);
    await time.tickAsync(1);
    await recovery;

    // Assert
    assertEquals(reads, 2);
  });

  test("取得失敗後の参加差分だけではmembershipを再開せず、完全snapshot再取得で回復する", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    await sync.refresh("guild", readMembers("departed"));
    let fail = true;
    const recovery = sync.refresh(
      "guild",
      () => {
        return fail
          ? Promise.reject(new Error("Discord unavailable"))
          : Promise.resolve(["stayed"]);
      },
    );

    // Act
    await time.tickAsync(30_000);
    await recovery;
    await sync.addMember("guild", "joined");
    assertEquals(api.saved.at(-1), { guildId: "guild", ids: [] });
    fail = false;
    await time.tickAsync(30_000);

    // Assert
    await time.runMicrotasks();
    assertEquals(api.saved.at(-1), {
      guildId: "guild",
      ids: ["stayed", "joined"],
    });
  });

  test("API保存に失敗しても最新差分を保持し、全件再取得せず再試行する", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    let fail = false;
    let reads = 0;
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (guildId, ids) =>
        fail
          ? Promise.resolve({ success: false as const, error: "unavailable" })
          : api.syncGuildMatchWatchMembers(guildId, ids),
    });
    await sync.refresh("guild", () => {
      reads++;
      return Promise.resolve(["departed", "stayed"]);
    });

    // Act
    fail = true;
    await sync.removeMember("guild", "departed");
    await sync.addMember("guild", "joined");
    fail = false;
    await time.tickAsync(30_000);

    // Assert
    assertEquals(reads, 1);
    assertEquals(api.saved.at(-1), {
      guildId: "guild",
      ids: ["stayed", "joined"],
    });
  });

  test("初期snapshotを取得できてもAPIへ保存できなければ、workerを開始しない", async () => {
    // Arrange
    using _time = new FakeTime();
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: () =>
        Promise.resolve({ success: false, error: "unavailable" }),
    });
    let started = false;

    // Act
    await assertRejects(
      () =>
        sync.initialize([{
          id: "guild",
          readMemberIds: readMembers("member"),
        }], () => {
          started = true;
        }),
      Error,
      "persistence failed",
    );

    // Assert
    assertEquals(started, false);
  });

  test("guild退出時は実行中の全件取得を待たず空保存し、古いsnapshotやretryを復活させない", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    const members = Promise.withResolvers<string[]>();
    const readStarted = Promise.withResolvers<void>();
    let reads = 0;
    const old = sync.refresh("guild", () => {
      reads++;
      readStarted.resolve();
      return members.promise;
    });

    // Act
    await readStarted.promise;
    await sync.removeGuild("guild");
    assertEquals(api.saved, [{ guildId: "guild", ids: [] }]);
    members.reject(new Error("old fetch failed"));
    await old;
    await time.tickAsync(60_000);

    // Assert
    assertEquals(reads, 1);
    assertEquals(api.saved, [{ guildId: "guild", ids: [] }]);
  });

  test("退出後にguildへ再参加すると、取得間隔を守って新snapshotを保存し古い取得を無視する", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    const members = Promise.withResolvers<string[]>();
    const readStarted = Promise.withResolvers<void>();
    const old = sync.refresh("guild", () => {
      readStarted.resolve();
      return members.promise;
    });
    await readStarted.promise;

    // Act
    await sync.removeGuild("guild");
    const rejoined = sync.refresh("guild", readMembers("new"));
    await sync.addMember("guild", "joined");
    await time.tickAsync(30_000);
    await rejoined;
    members.resolve(["old"]);
    await old;

    // Assert
    assertEquals(api.saved.at(-1), {
      guildId: "guild",
      ids: ["new", "joined"],
    });
    assertEquals(api.saved.some((s) => s.ids.includes("old")), false);
  });

  test("待機中retryがあるguildの退出・復帰では、新世代の取得だけが実行される", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    let oldReads = 0;
    await sync.refresh("guild", () => {
      oldReads++;
      return Promise.reject(new Error("failed"));
    });

    // Act
    await sync.removeGuild("guild");
    const rejoined = sync.refresh("guild", readMembers("new"));
    await time.tickAsync(30_000);
    await rejoined;
    await time.tickAsync(30_000);

    // Assert
    assertEquals(oldReads, 1);
    assertEquals(api.saved.at(-1), { guildId: "guild", ids: ["new"] });
  });

  test("guild unavailableで空保存し、availableの完全snapshotを得るまで差分だけで復活させない", async () => {
    // Arrange
    using time = new FakeTime();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    await sync.refresh("guild", readMembers("old"));

    // Act
    await sync.suspendGuild("guild");
    await sync.addMember("guild", "joined");
    assertEquals(api.saved.at(-1), { guildId: "guild", ids: [] });
    const recovery = sync.refresh("guild", readMembers("new"));
    await time.tickAsync(30_000);
    await recovery;

    // Assert
    assertEquals(api.saved.at(-1), {
      guildId: "guild",
      ids: ["new", "joined"],
    });
  });

  test("初期取得中に新guildが加わったら、その完全snapshot保存も待ってからworkerを開始する", async () => {
    // Arrange
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync(api);
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    let started = false;
    const initialization = sync.initialize([{
      id: "first",
      readMemberIds: () => {
        firstStarted.resolve();
        return first.promise;
      },
    }], () => {
      started = true;
    });
    await firstStarted.promise;
    const joined = sync.refresh("second", () => {
      secondStarted.resolve();
      return second.promise;
    });

    // Act
    await secondStarted.promise;
    first.resolve(["first-member"]);
    assertEquals(started, false);
    second.resolve(["second-member"]);
    await Promise.all([initialization, joined]);

    // Assert
    assertEquals(started, true);
    assertEquals(api.saved, [
      { guildId: "first", ids: ["first-member"] },
      { guildId: "second", ids: ["second-member"] },
    ]);
  });
  test("取消済みのretry callbackが遅れて呼ばれても、新世代のretryを失わせない", async () => {
    // Arrange
    let now = 0;
    const callbacks: (() => void)[] = [];
    const restored = Promise.withResolvers<void>();
    const api = recordingApi();
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (guildId, ids) => {
        const result = api.syncGuildMatchWatchMembers(guildId, ids);
        if (ids.includes("restored")) restored.resolve();
        return result;
      },
    }, {
      now: () => now,
      schedule: (callback) => {
        callbacks.push(callback);
        return () => {};
      },
    });
    await sync.refresh("guild", () => Promise.reject(new Error("old failure")));
    await sync.removeGuild("guild");
    now = 30_000;
    let failed = true;
    await sync.refresh(
      "guild",
      () =>
        failed
          ? Promise.reject(new Error("new failure"))
          : Promise.resolve(["restored"]),
    );

    // Act
    callbacks[0]();
    failed = false;
    now = 60_000;
    callbacks[1]();
    await restored.promise;

    // Assert
    assertEquals(callbacks.length, 2);
    assertEquals(api.saved.at(-1), { guildId: "guild", ids: ["restored"] });
  });
});
