import {
  account,
  activeGame,
  rankSnapshot,
  watcher,
} from "./testing/match_tracking_fixtures.ts";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  activeGameCacheKey,
  activeNotificationGroupKey,
  currentStateFromWatcher,
  decideActiveGame,
  decideResult,
  isResultFetchTimedOut,
  matchCacheKey,
  matchIdForGame,
  matchIdParts,
  observeMayhemGame,
  pendingMatchState,
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
    assertEquals(
      matchIdForGame(account({ platform: "ph2", region: "sea" }), 12345),
      "SG2_12345",
    );
    assertEquals(matchIdParts("PH2_12345"), {
      platform: "PH2",
      gameId: "12345",
    });

    assertEquals(activeGameCacheKey(riotAccount), "jp1:puuid-1");
    assertEquals(matchCacheKey(riotAccount, "JP1_12345"), "asia:JP1_12345");
  });

  test("同じguild/channel/gameIdでもplatformが違うとき、通知group keyを分離する", () => {
    const target = watcher({ guildId: "guild-1", channelId: "channel-1" });

    assertEquals(
      activeNotificationGroupKey(target, "JP1_12345"),
      "guild-1:channel-1:JP1_12345",
    );
    assertEquals(
      activeNotificationGroupKey(target, "KR_12345"),
      "guild-1:channel-1:KR_12345",
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
      currentGameMode: null,
      currentGameObservation: null,
      currentMatchId: null,
      currentNotificationMessageId: null,
      gameStartedAt: null,
      lastInGameNotifiedAt: null,
    });
    assertEquals(pendingResultFromWatcher(target), {
      matchId: "JP1_12345",
      gameMode: null,
      observation: null,
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

test("Mayhemを観測すると、PUUIDが一致する本人のチャンピオンと確認時点の経過時間だけを保持する", () => {
  const now = new Date("2026-09-28T00:10:00Z");
  const game = {
    ...activeGame(),
    gameMode: "KIWI",
    gameStartTime: now.getTime() - 605_000,
    participants: [{ puuid: "other", championId: 99, teamId: 100 }, {
      puuid: "puuid-1",
      championId: 17,
      teamId: 100,
    }],
  };
  assertEquals(observeMayhemGame("puuid-1", null, game, now), {
    championId: 17,
    elapsedSeconds: 605,
  });
  const saved = watcher({
    currentGameId: String(game.gameId),
    currentGameObservation: { championId: 17, elapsedSeconds: 605 },
  });
  const missing = {
    ...game,
    gameStartTime: 0,
    gameLength: undefined,
    participants: [{ puuid: "other", championId: 99, teamId: 100 }],
  };
  assertEquals(
    observeMayhemGame(
      saved.riotAccountPuuid,
      saved.currentGameObservation,
      missing,
      now,
    ),
    {
      championId: 17,
      elapsedSeconds: 605,
    },
  );
  assertEquals(
    observeMayhemGame(saved.riotAccountPuuid, null, {
      ...missing,
      gameId: 67890,
    }, now),
    null,
  );
  assertEquals(
    observeMayhemGame(saved.riotAccountPuuid, saved.currentGameObservation, {
      ...game,
      gameMode: "CLASSIC",
    }, now),
    null,
  );
});

describe("試合監視の判断正本", () => {
  test("開始・進行・観測保存・終了・IDLEを、保存状態と事実と時刻だけから決める", () => {
    // Arrange
    const now = new Date("2026-01-01T01:00:00Z");
    const input = {
      watcher: watcher(),
      account: account(),
      activeGame: activeGame(),
      notificationLastInGameNotifiedAt: null,
      inGameNotifyIntervalMs: 300_000,
      now,
    };
    const running = watcher({
      lastState: "IN_GAME",
      currentGameId: "12345",
      currentMatchId: "JP1_12345",
      lastInGameNotifiedAt: new Date(now.getTime() - 300_000),
    });

    // Act / Assert
    assertEquals(decideActiveGame(input).kind, "started");
    assertEquals(
      decideActiveGame({ ...input, watcher: running }).kind,
      "progress",
    );
    assertEquals(
      decideActiveGame({
        ...input,
        watcher: running,
        notificationLastInGameNotifiedAt: new Date(now.getTime() - 299_999),
      }).kind,
      "observed",
    );
    assertEquals(
      decideActiveGame({ ...input, watcher: running, activeGame: null }).kind,
      "ended",
    );
    assertEquals(decideActiveGame({ ...input, activeGame: null }), {
      kind: "idle",
      current: null,
    });
  });

  test("旧platformの同じnumeric IDは別試合として、前の結果と新currentを分離する", () => {
    // Arrange
    const target = watcher({
      lastState: "IN_GAME",
      currentGameId: "12345",
      currentMatchId: "PH2_12345",
      currentGameMode: "KIWI",
      currentGameObservation: { championId: 17, elapsedSeconds: 3600 },
    });

    // Act
    const decision = decideActiveGame({
      watcher: target,
      account: account({ platform: "sg2", region: "sea" }),
      activeGame: activeGame(),
      notificationLastInGameNotifiedAt: null,
      inGameNotifyIntervalMs: 300_000,
      now: new Date("2026-01-01T01:00:00Z"),
    });

    // Assert
    assertEquals(decision.kind, "started");
    if (decision.kind !== "started") throw new Error("Expected new game");
    assertEquals(decision.previous?.matchId, "PH2_12345");
    assertEquals(decision.current.currentMatchId, "SG2_12345");
    assertEquals(decision.current.currentGameObservation, null);
  });

  test("結果期限の境界と403・一時失敗を区別し、pending消去の型にcurrentを含めない", () => {
    // Arrange
    const pending = {
      matchId: "JP1_12345",
      messageId: "old",
      startedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const input = {
      pending,
      now: new Date("2026-01-01T03:00:00Z"),
      resultFetchTimeoutMs: 10_800_000,
    };

    // Act / Assert
    assertEquals(decideResult(input), { kind: "timeout" });
    assertEquals(
      decideResult({ ...input, now: new Date(input.now.getTime() - 1) }),
      { kind: "inspect" },
    );
    assertEquals(
      decideResult({
        ...input,
        inspection: {
          success: false,
          status: 502,
          code: "RIOT_MATCH_ACCESS_DENIED",
          error: "denied",
        },
      }),
      { kind: "unavailable" },
    );
    assertEquals(
      decideResult({
        ...input,
        inspection: {
          success: false,
          status: 502,
          code: "RIOT_API_UNAVAILABLE",
          error: "temporary",
        },
      }),
      { kind: "pending", failed: true },
    );
    assertEquals(Object.keys(pendingMatchState(null)).sort(), [
      "pendingResultGameMode",
      "pendingResultMatchId",
      "pendingResultNotificationMessageId",
      "pendingResultObservation",
      "pendingResultStartedAt",
    ]);
  });
});
