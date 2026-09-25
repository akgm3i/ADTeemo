import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createMatchWatchMembershipSync } from "./match_watch_membership.ts";

describe("監視対象guild membership同期", () => {
  test("同一guildの同期が重なると、取得と保存を順序化して古いsnapshotの上書きを防ぐ", async () => {
    const events: string[] = [];
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (guildId, ids) => {
        events.push(`${guildId}:${ids.join(",")}`);
        return Promise.resolve({ success: true, limitedAccountCount: 0 });
      },
    });
    let resolve!: (ids: string[]) => void;
    const first = sync.sync("guild", () =>
      new Promise<string[]>((done) => {
        resolve = done;
      }));
    const second = sync.sync("guild", () => {
      events.push("second-fetch");
      return Promise.resolve(["new"]);
    });
    await Promise.resolve();
    resolve(["old"]);
    await Promise.all([first, second]);
    assertEquals(events, ["guild:old", "second-fetch", "guild:new"]);
  });
  test("起動時に全guildの完全snapshotを保存できた後だけworkerを開始する", async () => {
    const calls: string[] = [];
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (guildId, ids) => {
        calls.push(`saved:${guildId}:${ids}`);
        return Promise.resolve({ success: true, limitedAccountCount: 0 });
      },
    });
    await sync.initialize([{
      id: "guild",
      readMemberIds: () => {
        calls.push("fetch-all");
        return Promise.resolve(["member"]);
      },
    }], () => {
      calls.push("start");
    });
    assertEquals(calls, ["fetch-all", "saved:guild:member", "start"]);
  });
  test("起動時に一部guildの完全snapshot取得に失敗すると、workerを開始しない", async () => {
    let started = false;
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: () =>
        Promise.resolve({ success: true, limitedAccountCount: 0 }),
    });
    await assertRejects(
      () =>
        sync.initialize([{
          id: "guild",
          readMemberIds: () => Promise.reject(new Error("missing intent")),
        }], () => {
          started = true;
        }),
      Error,
      "missing intent",
    );
    assertEquals(started, false);
  });
  test("実行中の同期に失敗したらguild単位で再試行し、退出時には待機中retryを破棄する", async () => {
    const retries: (() => void)[] = [];
    let cancelled = 0;
    const saved: string[][] = [];
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (_guild, ids) => {
        saved.push(ids);
        return Promise.resolve({ success: true, limitedAccountCount: 0 });
      },
    }, {
      scheduleRetry: (callback) => {
        retries.push(callback);
        return () => {
          cancelled++;
        };
      },
    });
    let failed = true;
    const read = () =>
      failed
        ? Promise.reject(new Error("temporary"))
        : Promise.resolve(["member"]);
    await sync.refresh("guild", read);
    await sync.refresh("guild", read);
    assertEquals(retries.length, 1);
    failed = false;
    retries[0]();
    await sync.sync("guild", () => Promise.resolve(["member"]));
    assertEquals(saved.at(-1), ["member"]);
    failed = true;
    await sync.refresh("guild", read);
    sync.cancelRefresh("guild");
    assertEquals(cancelled, 1);
    await sync.sync("guild", () => Promise.resolve([]));
    assertEquals(saved.at(-1), []);
  });

  test("取得失敗時はsnapshotを空にして退出者の監視を止め、再同期は再試行できる", async () => {
    const saved: string[][] = [];
    const sync = createMatchWatchMembershipSync({
      syncGuildMatchWatchMembers: (_guildId, ids) => {
        saved.push(ids);
        return Promise.resolve({ success: true, limitedAccountCount: 0 });
      },
    });
    await assertRejects(
      () =>
        sync.sync(
          "guild",
          () => Promise.reject(new Error("Discord unavailable")),
        ),
      Error,
      "Discord unavailable",
    );
    await sync.sync("guild", () => Promise.resolve(["member"]));
    assertEquals(saved, [[], ["member"]]);
  });
});
