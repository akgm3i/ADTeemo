import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { EmbedBuilder } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";
import { createMatchTrackingService } from "./match_tracking_service.ts";

function watcher(overrides: Partial<MatchWatcher> = {}): MatchWatcher {
  return {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    requesterId: "requester-1",
    channelId: "channel-1",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: null,
    ...overrides,
  };
}

describe("match_tracking_service.ts", () => {
  test("結果取得待ちのwatcherを処理するとき、BackendのResult検査を使って通知と状態更新を行う", async () => {
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
    const account = {
      discordId: "target-1",
      puuid: "puuid-1",
      gameName: "Teemo",
      tagLine: "JP1",
      platform: "jp1" as const,
      region: "asia" as const,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: null,
    };
    const match = {
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
          return Promise.resolve("message-result");
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
      { matchId: "JP1_12345" },
    ]]);
    assertEquals(activeGameInspectionCalls, []);
    assertEquals(renderedMatches.length, 1);
    assertEquals(notifications.length, 1);
    assertEquals(stateUpdates, [[
      "guild-1",
      "target-1",
      {
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

  test("watcher単位処理で例外が発生したとき、後続のwatcher処理を継続する", async () => {
    const inspectionCalls: string[] = [];
    const errors: unknown[] = [];
    const service = createMatchTrackingService({
      apiClient: {
        getEnabledMatchWatchers: () =>
          Promise.resolve({
            success: true as const,
            watchers: [
              watcher({ targetDiscordId: "target-1" }),
              watcher({ targetDiscordId: "target-2" }),
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
          });
        },
        inspectMatchWatcherResult: () => {
          throw new Error("inspectMatchWatcherResult should not be called");
        },
        updateMatchWatcherState: () =>
          Promise.resolve({ success: true as const }),
      },
      notifier: {
        sendOrEditWatcherMessage: () => Promise.resolve(null),
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
});
