import { stub } from "@std/testing/mock";
import {
  account as accountFixture,
  match as matchFixture,
  watcher,
} from "./testing/match_tracking_fixtures.ts";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { EmbedBuilder } from "discord.js";
import { markFailureLogged } from "../api_clients/transport.ts";
import { createMatchTrackingService } from "./match_tracking_service.ts";

describe("match_tracking_service.ts", () => {
  test("結果取得待ちのwatcherを処理するとき、BackendのResult検査を使って通知と状態更新を行う", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const resultInspectionCalls: unknown[] = [];
    const activeGameInspectionCalls: unknown[] = [];
    const renderedMatches: unknown[] = [];
    const notifications: unknown[] = [];
    const stateUpdates: unknown[] = [];
    const targetWatcher = watcher({
      lastState: "FETCHING_RESULT",
      currentMatchId: "JP1_12345",
      currentNotificationMessageId: "message-existing",
      gameStartedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const account = accountFixture();
    const match = matchFixture();
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [targetWatcher],
          }),
        getRiotAccount: () => {
          throw new Error("getRiotAccount should not be called");
        },
        inspectMatchWatcherActiveGame: (...args) => {
          activeGameInspectionCalls.push(args);
          throw new Error("inspectMatchWatcherActiveGame should not be called");
        },
        inspectMatchWatcherResult: (...args) => {
          resultInspectionCalls.push(args);
          return Promise.resolve({
            success: true as const,
            account,
            match,
            rankSummary: null,
            opggDetail: null,
            notificationIntent: {
              kind: "result" as const,
              match,
              rankSummary: null,
              opggDetail: null,
            },
            stateTransition: null,
          });
        },
        updateMatchWatcherState: (...args) => {
          stateUpdates.push(args);
          return Promise.resolve({ success: true as const });
        },
      },
      notifier: {
        sendOrEditWatcherMessage: (...args) => {
          notifications.push(args);
          return Promise.resolve({
            status: "sent" as const,
            messageId: "message-result",
          });
        },
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer.activeGame should not be called");
        },
        resultPending: () => {
          throw new Error("renderer.resultPending should not be called");
        },
        resultFetchTimeout: () => {
          throw new Error("renderer.resultFetchTimeout should not be called");
        },
        matchResult: (...args) => {
          renderedMatches.push(args);
          return Promise.resolve(new EmbedBuilder());
        },
      },
      clock: {
        now: () => new Date("2026-01-01T00:05:00Z"),
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(resultInspectionCalls, [[
      "guild-1",
      "target-1",
      {
        inspectionBatchId: "00000000-0000-4000-8000-000000000001",
        riotAccountPuuid: "puuid-1",
        matchId: "JP1_12345",
        messageId: "message-existing",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        resultFetchTimeoutMs: 10 * 60_000,
      },
    ]]);
    assertEquals(activeGameInspectionCalls, []);
    assertEquals(renderedMatches.length, 1);
    assertEquals(notifications.length, 1);
    assertEquals(stateUpdates, [[
      "guild-1",
      "target-1",
      {
        riotAccountPuuid: "puuid-1",
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        pendingResultMatchId: null,
        pendingResultNotificationMessageId: null,
        pendingResultStartedAt: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
        lastCheckedAt: new Date("2026-01-01T00:05:00Z"),
      },
    ]]);
  });

  test("BackendのResult検査がmatchだけを返す旧形式のとき、結果通知として処理してpendingを解除する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const renderedMatches: unknown[] = [];
    const notifications: unknown[] = [];
    const stateUpdates: unknown[] = [];
    const targetWatcher = watcher({
      lastState: "FETCHING_RESULT",
      currentMatchId: "JP1_12345",
      currentNotificationMessageId: "message-existing",
      gameStartedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const account = accountFixture();
    const match = matchFixture();
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [targetWatcher],
          }),
        getRiotAccount: () => {
          throw new Error("getRiotAccount should not be called");
        },
        inspectMatchWatcherActiveGame: () => {
          throw new Error("inspectMatchWatcherActiveGame should not be called");
        },
        inspectMatchWatcherResult: () =>
          Promise.resolve({
            success: true as const,
            account,
            match,
            rankSummary: null,
            opggDetail: null,
            notificationIntent: null,
            stateTransition: null,
          }),
        updateMatchWatcherState: (...args) => {
          stateUpdates.push(args);
          return Promise.resolve({ success: true as const });
        },
      },
      notifier: {
        sendOrEditWatcherMessage: (...args) => {
          notifications.push(args);
          return Promise.resolve({
            status: "sent" as const,
            messageId: "message-result",
          });
        },
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer.activeGame should not be called");
        },
        resultPending: () => {
          throw new Error("renderer.resultPending should not be called");
        },
        resultFetchTimeout: () => {
          throw new Error("renderer.resultFetchTimeout should not be called");
        },
        matchResult: (...args) => {
          renderedMatches.push(args);
          return Promise.resolve(new EmbedBuilder());
        },
      },
      clock: {
        now: () => new Date("2026-01-01T00:05:00Z"),
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(renderedMatches.length, 1);
    assertEquals(notifications.length, 1);
    assertEquals(stateUpdates, [[
      "guild-1",
      "target-1",
      {
        riotAccountPuuid: "puuid-1",
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        pendingResultMatchId: null,
        pendingResultNotificationMessageId: null,
        pendingResultStartedAt: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
        lastCheckedAt: new Date("2026-01-01T00:05:00Z"),
      },
    ]]);
  });

  test("gameId変更後に旧試合結果が取得できたとき、BackendのResult transitionで新試合状態を消さない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const stateUpdates: unknown[] = [];
    const now = new Date("2026-01-01T00:05:00Z");
    const targetWatcher = watcher({
      lastState: "IN_GAME",
      currentGameId: "12345",
      currentNotificationMessageId: "message-active-old",
      gameStartedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const account = accountFixture();
    const nextActiveGame = {
      gameId: 67890,
      gameType: "MATCHED_GAME",
      gameStartTime: now.getTime(),
      mapId: 11,
      gameMode: "CLASSIC",
      gameQueueConfigId: 420,
      participants: [{
        puuid: "puuid-1",
        championId: 17,
        teamId: 100,
      }],
    };
    const previousMatch = {
      metadata: {
        matchId: "JP1_12345",
        participants: ["puuid-1"],
      },
      info: {
        gameId: 12345,
        gameCreation: 1_700_000_000_000,
        gameDuration: 1800,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        mapId: 11,
        queueId: 420,
        participants: [{
          puuid: "puuid-1",
          championId: 17,
          championName: "Teemo",
          teamId: 100,
          win: true,
          kills: 10,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          goldEarned: 12345,
        }],
      },
    };
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [targetWatcher],
          }),
        getRiotAccount: () =>
          Promise.resolve({ success: true as const, account }),
        inspectMatchWatcherActiveGame: () =>
          Promise.resolve({
            success: true as const,
            account,
            activeGame: nextActiveGame,
            notificationIntent: {
              kind: "started" as const,
              activeGame: nextActiveGame,
            },
            stateTransition: null,
          }),
        inspectMatchWatcherResult: () =>
          Promise.resolve({
            success: true as const,
            account,
            match: previousMatch,
            rankSummary: null,
            opggDetail: null,
            notificationIntent: {
              kind: "result" as const,
              match: previousMatch,
              rankSummary: null,
              opggDetail: null,
            },
            stateTransition: {
              state: {
                lastState: "IDLE" as const,
                currentGameId: null,
                currentMatchId: null,
                pendingResultMatchId: null,
                pendingResultNotificationMessageId: null,
                pendingResultStartedAt: null,
                lastCheckedAt: now,
              },
              messageIdField: null,
            },
          }),
        updateMatchWatcherState: (...args) => {
          stateUpdates.push(args);
          return Promise.resolve({ success: true as const });
        },
      },
      notifier: {
        sendOrEditWatcherMessage: () =>
          Promise.resolve({
            status: "sent" as const,
            messageId: "message-new",
          }),
      },
      renderer: {
        activeGame: () => Promise.resolve(new EmbedBuilder()),
        resultPending: () => new EmbedBuilder(),
        resultFetchTimeout: () => new EmbedBuilder(),
        matchResult: () => Promise.resolve(new EmbedBuilder()),
      },
      clock: { now: () => now },
      logger: {
        warn: () => {},
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    const finalState = stateUpdates.at(-1) as [
      string,
      string,
      Record<string, unknown>,
    ];
    assertEquals(finalState[2].lastState, "IN_GAME");
    assertEquals(finalState[2].currentGameId, "67890");
    assertEquals(finalState[2].currentNotificationMessageId, "message-new");
    assertEquals(finalState[2].pendingResultMatchId, null);
  });

  test("試合終了直後にpending通知IDが確定したとき、そのIDでBackendのResult検査と状態更新を行う", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const resultInspectionCalls: unknown[] = [];
    const stateUpdates: unknown[] = [];
    const now = new Date("2026-01-01T00:05:00Z");
    const targetWatcher = watcher({
      lastState: "IN_GAME",
      currentGameId: "12345",
      currentNotificationMessageId: null,
      gameStartedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const account = accountFixture();
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [targetWatcher],
          }),
        getRiotAccount: () =>
          Promise.resolve({ success: true as const, account }),
        inspectMatchWatcherActiveGame: () =>
          Promise.resolve({
            success: true as const,
            account,
            activeGame: null,
            notificationIntent: {
              kind: "resultPending" as const,
              matchId: "JP1_12345",
            },
            stateTransition: null,
          }),
        inspectMatchWatcherResult: (...args) => {
          resultInspectionCalls.push(args);
          return Promise.resolve({
            success: true as const,
            account,
            match: null,
            rankSummary: null,
            opggDetail: null,
            notificationIntent: null,
            stateTransition: null,
          });
        },
        updateMatchWatcherState: (...args) => {
          stateUpdates.push(args);
          return Promise.resolve({ success: true as const });
        },
      },
      notifier: {
        sendOrEditWatcherMessage: () =>
          Promise.resolve({
            status: "sent" as const,
            messageId: "message-pending-new",
          }),
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer.activeGame should not be called");
        },
        resultPending: () => new EmbedBuilder(),
        resultFetchTimeout: () => new EmbedBuilder(),
        matchResult: () => {
          throw new Error("renderer.matchResult should not be called");
        },
      },
      clock: { now: () => now },
      logger: {
        warn: () => {},
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(resultInspectionCalls, [[
      "guild-1",
      "target-1",
      {
        inspectionBatchId: "00000000-0000-4000-8000-000000000001",
        riotAccountPuuid: "puuid-1",
        matchId: "JP1_12345",
        messageId: "message-pending-new",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        resultFetchTimeoutMs: 10 * 60_000,
      },
    ]]);
    assertEquals(stateUpdates.at(-1), [
      "guild-1",
      "target-1",
      {
        riotAccountPuuid: "puuid-1",
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
        pendingResultMatchId: "JP1_12345",
        pendingResultNotificationMessageId: "message-pending-new",
        pendingResultStartedAt: new Date("2026-01-01T00:00:00Z"),
        lastCheckedAt: now,
      },
    ]);
  });

  test("同一targetとmatchIdでもguildごとに異なるmessageIdでBackend Result検査を行う", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const resultInspectionCalls: unknown[] = [];
    const targetWatchers = [
      watcher({
        guildId: "guild-1",
        lastState: "FETCHING_RESULT",
        currentMatchId: "JP1_12345",
        currentNotificationMessageId: "message-existing-1",
        gameStartedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      watcher({
        guildId: "guild-2",
        channelId: "channel-2",
        lastState: "FETCHING_RESULT",
        currentMatchId: "JP1_12345",
        currentNotificationMessageId: "message-existing-2",
        gameStartedAt: new Date("2026-01-01T00:01:00Z"),
      }),
    ];
    const account = accountFixture();
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: targetWatchers,
          }),
        getRiotAccount: () =>
          Promise.resolve({ success: true as const, account }),
        inspectMatchWatcherActiveGame: () => {
          throw new Error("inspectMatchWatcherActiveGame should not be called");
        },
        inspectMatchWatcherResult: (...args) => {
          resultInspectionCalls.push(args);
          return Promise.resolve({
            success: true as const,
            account,
            match: null,
            rankSummary: null,
            opggDetail: null,
            notificationIntent: null,
            stateTransition: null,
          });
        },
        updateMatchWatcherState: () =>
          Promise.resolve({ success: true as const }),
      },
      notifier: {
        sendOrEditWatcherMessage: () =>
          Promise.resolve({
            status: "skipped" as const,
            reason: "backoff" as const,
          }),
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer.activeGame should not be called");
        },
        resultPending: () => {
          throw new Error("renderer.resultPending should not be called");
        },
        resultFetchTimeout: () => {
          throw new Error("renderer.resultFetchTimeout should not be called");
        },
        matchResult: () => {
          throw new Error("renderer.matchResult should not be called");
        },
      },
      clock: {
        now: () => new Date("2026-01-01T00:05:00Z"),
      },
      logger: {
        warn: () => {},
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(resultInspectionCalls, [[
      "guild-1",
      "target-1",
      {
        inspectionBatchId: "00000000-0000-4000-8000-000000000001",
        riotAccountPuuid: "puuid-1",
        matchId: "JP1_12345",
        messageId: "message-existing-1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        resultFetchTimeoutMs: 10 * 60_000,
      },
    ], [
      "guild-2",
      "target-1",
      {
        inspectionBatchId: "00000000-0000-4000-8000-000000000001",
        riotAccountPuuid: "puuid-1",
        matchId: "JP1_12345",
        messageId: "message-existing-2",
        startedAt: new Date("2026-01-01T00:01:00Z"),
        resultFetchTimeoutMs: 10 * 60_000,
      },
    ]]);
  });

  test("watcher検査が404または502で失敗したとき、未連携と上流障害を安全なstatusとreasonで区別する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const warnings: Array<[string, Record<string, unknown> | undefined]> = [];
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [
              watcher({
                targetDiscordId: "result-target",
                lastState: "FETCHING_RESULT",
                currentMatchId: "JP1_12345",
                currentNotificationMessageId: "message-result",
                gameStartedAt: new Date("2026-01-01T00:00:00Z"),
              }),
              watcher({
                targetDiscordId: "active-game-target",
                riotAccountPuuid: "active-puuid",
              }),
              watcher({
                targetDiscordId: "missing-target",
                riotAccountPuuid: "missing-puuid",
              }),
            ],
          }),
        getRiotAccount: () => {
          throw new Error("getRiotAccount should not be called");
        },
        inspectMatchWatcherActiveGame: (_guildId, targetDiscordId) =>
          targetDiscordId === "missing-target"
            ? Promise.resolve({
              success: false as const,
              error: "Riot account not found",
              code: "RIOT_ACCOUNT_NOT_FOUND" as const,
              status: 404 as const,
            })
            : Promise.resolve({
              success: false as const,
              error: "provider body must not be logged",
              code: "RIOT_API_UNAVAILABLE" as const,
              status: 502 as const,
            }),
        inspectMatchWatcherResult: () =>
          Promise.resolve({
            success: false as const,
            error: "provider body must not be logged",
            code: "RIOT_API_UNAVAILABLE" as const,
            status: 502 as const,
          }),
        updateMatchWatcherState: () => {
          throw new Error("updateMatchWatcherState should not be called");
        },
      },
      notifier: {
        sendOrEditWatcherMessage: () => {
          throw new Error("notifier should not be called");
        },
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer.activeGame should not be called");
        },
        resultPending: () => {
          throw new Error("renderer.resultPending should not be called");
        },
        resultFetchTimeout: () => {
          throw new Error("renderer.resultFetchTimeout should not be called");
        },
        matchResult: () => {
          throw new Error("renderer.matchResult should not be called");
        },
      },
      clock: {
        now: () => new Date("2026-01-01T00:05:00Z"),
      },
      logger: {
        warn: (event, metadata) => warnings.push([event, metadata]),
        error: () => {},
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10 * 60_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(warnings, [[
      "match_tracking.watcher_inspection_failed",
      {
        guildId: "guild-1",
        targetDiscordId: "result-target",
        operation: "result",
        status: 502,
        reason: "upstream_failure",
      },
    ], [
      "match_tracking.watcher_inspection_failed",
      {
        guildId: "guild-1",
        targetDiscordId: "active-game-target",
        operation: "active_game",
        status: 502,
        reason: "upstream_failure",
      },
    ], [
      "match_tracking.riot_account_not_found",
      {
        guildId: "guild-1",
        targetDiscordId: "missing-target",
        operation: "active_game",
        status: 404,
        reason: "riot_account_not_found",
      },
    ]]);
  });

  test("watcher単位処理で例外が発生したとき、後続のwatcher処理を継続する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const inspectionCalls: string[] = [];
    const errors: unknown[] = [];
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [
              watcher({ targetDiscordId: "target-1" }),
              watcher({
                targetDiscordId: "target-2",
                riotAccountPuuid: "puuid-2",
              }),
            ],
          }),
        getRiotAccount: () => {
          throw new Error("getRiotAccount should not be called");
        },
        inspectMatchWatcherActiveGame: (_guildId, targetDiscordId) => {
          inspectionCalls.push(targetDiscordId);
          if (targetDiscordId === "target-1") {
            throw new Error("temporary failure");
          }
          return Promise.resolve({
            success: true as const,
            account: {
              isMain: true,
              discordId: targetDiscordId,
              puuid: `puuid-${targetDiscordId}`,
              gameName: "Teemo",
              tagLine: "JP1",
              platform: "jp1",
              region: "asia",
              createdAt: new Date("2026-01-01T00:00:00Z"),
              updatedAt: null,
            },
            activeGame: null,
            notificationIntent: null,
            stateTransition: null,
          });
        },
        inspectMatchWatcherResult: () => {
          throw new Error("inspectMatchWatcherResult should not be called");
        },
        updateMatchWatcherState: () =>
          Promise.resolve({ success: true as const }),
      },
      notifier: {
        sendOrEditWatcherMessage: () =>
          Promise.resolve({
            status: "skipped" as const,
            reason: "backoff" as const,
          }),
      },
      renderer: {
        activeGame: () => {
          throw new Error("renderer should not be called");
        },
        resultPending: () => {
          throw new Error("renderer should not be called");
        },
        resultFetchTimeout: () => {
          throw new Error("renderer should not be called");
        },
        matchResult: () => {
          throw new Error("renderer should not be called");
        },
      },
      clock: {
        now: () => new Date("2026-01-01T00:00:00Z"),
      },
      logger: {
        warn: () => {},
        error: (_message, _metadata, error) => errors.push(error),
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(inspectionCalls, ["target-1", "target-2"]);
    assertEquals(errors.length, 1);
  });

  test("transportで記録済みの取得失敗は、worker境界で重複記録しない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const events: string[] = [];
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve(markFailureLogged({
            success: false as const,
            error: "Failed to communicate with API",
          })),
        getRiotAccount: () => {
          throw new Error("getRiotAccount should not be called");
        },
        inspectMatchWatcherActiveGame: () => {
          throw new Error("inspectMatchWatcherActiveGame should not be called");
        },
        inspectMatchWatcherResult: () => {
          throw new Error("inspectMatchWatcherResult should not be called");
        },
        updateMatchWatcherState: () => {
          throw new Error("updateMatchWatcherState should not be called");
        },
      },
      notifier: {
        sendOrEditWatcherMessage: () =>
          Promise.resolve({
            status: "skipped" as const,
            reason: "backoff" as const,
          }),
      },
      renderer: {
        activeGame: () => Promise.resolve(new EmbedBuilder()),
        resultPending: () => new EmbedBuilder(),
        resultFetchTimeout: () => new EmbedBuilder(),
        matchResult: () => Promise.resolve(new EmbedBuilder()),
      },
      clock: { now: () => new Date("2026-01-01T00:00:00Z") },
      logger: {
        warn: (event) => events.push(event),
        error: (event) => events.push(event),
      },
      config: {
        pollIntervalMs: 60_000,
        inGameNotifyIntervalMs: 300_000,
        resultFetchTimeoutMs: 10_000,
        riotLongWindowLimit: 100,
        riotLongWindowMs: 120_000,
      },
    });

    await service.processMatchWatchers();

    assertEquals(events, []);
  });
});
