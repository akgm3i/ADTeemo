import {
  account,
  rankSnapshot,
  watcher,
} from "./testing/match_tracking_fixtures.ts";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  activeGameCacheKey,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  isResultFetchTimedOut,
  matchCacheKey,
  matchIdForGame,
  matchIdParts,
  pendingResultFromWatcher,
  rankDelta,
  resultMetricValues,
  selectResultNotificationMessageId,
  shouldNotifySince,
} from "./match_tracking_state.ts";

describe("match_tracking_state.ts", () => {
  test("match IDとcache keyを作るとき、platformを正規化しregionとpuuidを区別する", () => {
    const riotAccount = account({ platform: "jp1", region: "asia" });

    assertEquals(matchIdForGame(riotAccount, 12345), "JP1_12345");
    assertEquals(matchIdParts("jp1_12345"), {
      platform: "JP1",
      gameId: "12345",
    });
    assertEquals(matchIdParts("JP1"), null);
    assertEquals(activeGameCacheKey(riotAccount), "jp1:puuid-1");
    assertEquals(matchCacheKey(riotAccount, "JP1_12345"), "asia:JP1_12345");
  });

  test("同じguild/channel/gameIdでもplatformが違うとき、通知group keyを分離する", () => {
    const target = watcher({ guildId: "guild-1", channelId: "channel-1" });

    assertEquals(
      activeNotificationGroupKey(target, "jp1", 12345),
      "guild-1:channel-1:JP1:12345",
    );
    assertEquals(
      activeNotificationGroupKey(target, "kr", 12345),
      "guild-1:channel-1:KR:12345",
    );
  });

  test("legacy FETCHING_RESULTから現在状態とpending結果を作るとき、現在試合の状態をIDLEへ戻してpendingへ移す", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const target = watcher({
      lastState: "FETCHING_RESULT",
      currentGameId: "12345",
      currentMatchId: "JP1_12345",
      currentNotificationMessageId: "message-existing",
      gameStartedAt: startedAt,
      lastInGameNotifiedAt: new Date("2026-01-01T00:02:00.000Z"),
    });

    assertEquals(currentStateFromWatcher(target), {
      lastState: "IDLE",
      currentGameId: null,
      currentMatchId: null,
      currentNotificationMessageId: null,
      gameStartedAt: null,
      lastInGameNotifiedAt: null,
    });
    assertEquals(pendingResultFromWatcher(target), {
      matchId: "JP1_12345",
      messageId: "message-existing",
      startedAt,
    });
  });

  test("通知間隔と結果取得timeoutを判定するとき、渡されたclockとconfigだけを使う", () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const notifiedAt = new Date("2026-01-01T00:00:00.000Z");

    assertEquals(shouldNotifySince(null, 300_000, now), true);
    assertEquals(shouldNotifySince(notifiedAt, 300_000, now), true);
    assertEquals(shouldNotifySince(notifiedAt, 300_001, now), false);
    assertEquals(isResultFetchTimedOut(notifiedAt, 300_000, now), true);
    assertEquals(isResultFetchTimedOut(notifiedAt, 300_001, now), false);
  });

  test("結果通知の投稿IDを選ぶとき、共有投稿IDの二重利用を避けdistinctな既存投稿を優先する", () => {
    const used = new Set<string>();

    assertEquals(
      selectResultNotificationMessageId({
        groupMessageId: "message-shared",
        watcherMessageId: "message-stale",
        activeWatcherMessageId: "message-stale",
        usedMessageIds: used,
      }),
      "message-stale",
    );
    used.add("message-stale");

    assertEquals(
      selectResultNotificationMessageId({
        groupMessageId: "message-shared",
        watcherMessageId: "message-shared",
        activeWatcherMessageId: "message-shared",
        usedMessageIds: used,
      }),
      "message-shared",
    );
    used.add("message-shared");

    assertEquals(
      selectResultNotificationMessageId({
        groupMessageId: "message-shared",
        watcherMessageId: "message-shared",
        activeWatcherMessageId: "message-shared",
        usedMessageIds: used,
      }),
      null,
    );
  });

  test("rank deltaを計算するとき、division内差分とApex Tier間差分を表示可能なLP差分として扱う", () => {
    assertEquals(
      rankDelta(
        rankSnapshot({ tier: "EMERALD", rank: "IV", leaguePoints: 2 }),
        rankSnapshot({ tier: "EMERALD", rank: "IV", leaguePoints: 19 }),
      ),
      17,
    );
    assertEquals(
      rankDelta(
        rankSnapshot({ tier: "MASTER", rank: "I", leaguePoints: 150 }),
        rankSnapshot({ tier: "GRANDMASTER", rank: "I", leaguePoints: 172 }),
      ),
      22,
    );
    assertEquals(
      rankDelta(
        rankSnapshot({ tier: "EMERALD", rank: "IV", leaguePoints: 2 }),
        rankSnapshot({ tier: "EMERALD", rank: "II", leaguePoints: 19 }),
      ),
      null,
    );
  });

  test("試合結果metricを計算するとき、roleごとの責務で欠損値と時間不足をfallbackへ寄せる", () => {
    assertEquals(
      resultMetricValues({
        teamPosition: "SUPPORT",
        individualPosition: "SUPPORT",
      }, 1800),
      [],
    );
    assertEquals(
      resultMetricValues({
        teamPosition: "JUNGLE",
        individualPosition: "JUNGLE",
        neutralMinionsKilled: 120,
        totalEnemyJungleMinionsKilled: 7,
      }, 1800),
      [
        { kind: "jungleCs", value: "120" },
        { kind: "enemyJungleCs", value: "7" },
      ],
    );
    assertEquals(
      resultMetricValues({
        teamPosition: "TOP",
        individualPosition: "TOP",
        totalMinionsKilled: 180,
        neutralMinionsKilled: 12,
      }, 0),
      [
        { kind: "cs", value: "192" },
        { kind: "csPerMinute", value: "-" },
      ],
    );
    assertEquals(
      resultMetricValues({
        teamPosition: "TOP",
        individualPosition: "TOP",
      }, 1800),
      [],
    );
  });
  test("Jungleの取得済み内訳が0でも表示し、欠損した自陣内訳や中立だけの数は生成しない", () => {
    assertEquals(
      resultMetricValues({
        teamPosition: "JUNGLE",
        totalMinionsKilled: 0,
        neutralMinionsKilled: 0,
        totalEnemyJungleMinionsKilled: 0,
      }, 1800),
      [
        { kind: "cs", value: "0" },
        { kind: "csPerMinute", value: "0.0" },
        { kind: "minionCs", value: "0" },
        { kind: "jungleCs", value: "0" },
        { kind: "enemyJungleCs", value: "0" },
      ],
    );
  });
});
