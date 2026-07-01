import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
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
  test("watcher単位処理で例外が発生したとき、後続のwatcher処理を継続する", async () => {
    const accountCalls: string[] = [];
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
        getRiotAccount: (targetDiscordId) => {
          accountCalls.push(targetDiscordId);
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
          });
        },
        getActiveGameByPuuid: () => Promise.resolve(null),
        getMatchById: () => Promise.resolve(null),
        getLeagueEntriesByPuuid: () => Promise.resolve([]),
        upsertPendingRankSnapshots: () =>
          Promise.resolve({ success: true as const }),
        finalizeRankSnapshots: () =>
          Promise.resolve({
            success: true as const,
            snapshots: { before: [], after: [] },
          }),
        resolveOpggMatchDetail: () =>
          Promise.resolve({ success: true as const, detail: null }),
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

    assertEquals(accountCalls, ["target-1", "target-2"]);
    assertEquals(errors.length, 1);
  });
});
