import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { EmbedBuilder } from "discord.js";
import type {
  MatchWatcher,
  RiotAccount,
  RiotMatch,
} from "@adteemo/api/contract";
import { createMatchTrackingService } from "./match_tracking_service.ts";
import type { NotificationResult } from "./match_tracking_notifier.ts";

const now = new Date("2026-09-01T00:00:00Z");
const account: RiotAccount = {
  discordId: "target",
  isMain: true,
  puuid: "puuid",
  gameName: "Teemo",
  tagLine: "JP1",
  platform: "jp1",
  region: "asia",
  createdAt: now,
  updatedAt: null,
};
const aram: RiotMatch = {
  metadata: { matchId: "JP1_123", participants: ["puuid"] },
  info: {
    gameId: 123,
    gameCreation: now.getTime(),
    gameDuration: 1200,
    gameMode: "ARAM",
    gameType: "MATCHED_GAME",
    mapId: 12,
    queueId: 450,
    participants: [{
      puuid: "puuid",
      championId: 17,
      championName: "Teemo",
      teamId: 100,
      win: true,
      kills: 1,
      deaths: 2,
      assists: 3,
      totalMinionsKilled: 0,
      neutralMinionsKilled: 0,
      goldEarned: 1000,
    }],
  },
};
function harness() {
  const watcher: MatchWatcher = {
    guildId: "guild",
    targetDiscordId: "target",
    riotAccountPuuid: "puuid",
    requesterId: "owner",
    channelId: "channel",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    pendingResultMatchId: "JP1_123",
    pendingResultNotificationMessageId: "message",
    pendingResultStartedAt: now,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    createdAt: now,
    updatedAt: null,
  };
  const state = {
    failSave: false,
    delivery: { status: "edited", messageId: "message" } as NotificationResult,
    updates: 0,
    inspections: 0,
    errors: [] as string[],
  };
  const service = createMatchTrackingService({
    apiClient: {
      getEnabledMatchWatchers: () =>
        Promise.resolve({ success: true, watchers: [watcher] }),
      getRiotAccount: () => Promise.resolve({ success: true, account }),
      inspectMatchWatcherResult: () =>
        Promise.resolve({
          success: true,
          account,
          match: aram,
          rankSummary: null,
          opggDetail: null,
          notificationIntent: {
            kind: "result",
            match: aram,
            rankSummary: null,
            opggDetail: null,
          },
          stateTransition: {
            state: {
              pendingResultMatchId: null,
              pendingResultNotificationMessageId: null,
              pendingResultStartedAt: null,
            },
            messageIdField: null,
          },
        }),
      inspectMatchWatcherActiveGame: () => {
        state.inspections++;
        return Promise.resolve({
          success: true,
          account,
          activeGame: null,
          notificationIntent: null,
          stateTransition: null,
        });
      },
      updateMatchWatcherState: (_guild, _target, patch) => {
        state.updates++;
        if (state.failSave) {
          return Promise.resolve({
            success: false,
            error: "repository unavailable",
          });
        }
        Object.assign(watcher, patch);
        return Promise.resolve({ success: true });
      },
    },
    notifier: {
      sendOrEditWatcherMessage: () => Promise.resolve(state.delivery),
    },
    renderer: {
      activeGame: () => Promise.resolve(new EmbedBuilder()),
      resultPending: () => new EmbedBuilder(),
      resultFetchTimeout: () => new EmbedBuilder(),
      matchResult: () => Promise.resolve(new EmbedBuilder()),
    },
    clock: { now: () => now },
    logger: {
      warn() {},
      error: (event) => {
        state.errors.push(event);
      },
    },
    config: {
      pollIntervalMs: 60000,
      inGameNotifyIntervalMs: 300000,
      resultFetchTimeoutMs: 10800000,
      riotLongWindowLimit: 100,
      riotLongWindowMs: 120000,
    },
  });
  return { service, state, watcher };
}

describe("ARAM結果通知の復旧 (#99/#116)", () => {
  test("結果取得後の通知が失敗した場合、pendingと通知IDを保持して次tickで再試行する", async () => {
    const { service, state, watcher } = harness();
    state.delivery = { status: "retryable_failure", reason: "edit" };
    await service.processMatchWatchers();
    assertEquals(state.updates, 0);
    assertEquals(watcher.pendingResultMatchId, "JP1_123");
    assertEquals(watcher.pendingResultNotificationMessageId, "message");
    state.delivery = { status: "edited", messageId: "message" };
    await service.processMatchWatchers();
    assertEquals(watcher.pendingResultMatchId, null);
    assertEquals(watcher.lastState, "IDLE");
  });

  test("結果通知後の状態保存が失敗した場合、そのwatcherの処理を中断して再試行で監視を再開する", async () => {
    const { service, state, watcher } = harness();
    state.failSave = true;
    await service.processMatchWatchers();
    assertEquals(state.inspections, 0);
    assertEquals(watcher.pendingResultMatchId, "JP1_123");
    assertEquals(state.errors.includes("match_tracking.watcher_failed"), true);
    state.failSave = false;
    await service.processMatchWatchers();
    assertEquals(watcher.pendingResultMatchId, null);
    assertEquals(state.inspections, 1);
  });
  test("結果通知が恒久失敗した場合、失敗は記録したまま結果待ちを解除して次の監視へ進む", async () => {
    const { service, state, watcher } = harness();
    state.delivery = { status: "permanent_failure", reason: "channel_missing" };
    await service.processMatchWatchers();
    assertEquals(watcher.pendingResultMatchId, null);
    assertEquals(watcher.lastInGameNotifiedAt, null);
    assertEquals(state.inspections, 1);
    assertEquals(
      state.errors.includes("match_tracking.delivery_permanent_failure"),
      true,
    );
  });
});
