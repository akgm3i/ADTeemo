import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Client } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/schema";
import { riotApi } from "@adteemo/api/riot-api";
import { apiClient } from "../api_client.ts";
import { matchTracker } from "./match_tracking.ts";

function watcher(overrides: Partial<MatchWatcher> = {}): MatchWatcher {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    requesterId: "requester-1",
    channelId: "channel-1",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function account(): RiotAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    discordId: "target-1",
    puuid: "puuid-1",
    gameName: "Teemo",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
    createdAt: now,
    updatedAt: now,
  };
}

function activeGame(gameId = 12345) {
  return {
    gameId,
    gameType: "MATCHED_GAME",
    gameStartTime: Date.now() - 120_000,
    gameLength: 120,
    mapId: 11,
    gameMode: "CLASSIC",
    gameQueueConfigId: 420,
    participants: [{
      puuid: "puuid-1",
      championId: 17,
      teamId: 100,
    }],
  };
}

function match() {
  return {
    metadata: {
      matchId: "JP1_12345",
      participants: ["puuid-1"],
    },
    info: {
      gameId: 12345,
      gameCreation: Date.now() - 2_000_000,
      gameDuration: 1800,
      gameEndTimestamp: Date.now(),
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      mapId: 11,
      queueId: 420,
      participants: [{
        puuid: "puuid-1",
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
}

function clientWithSend() {
  const channel = {
    send: () => Promise.resolve(),
  };
  const sendSpy = spy(channel, "send");
  const client = {
    channels: {
      fetch: () => Promise.resolve(channel),
    },
  } as unknown as Client;
  return { client, sendSpy };
}

describe("match_tracking.ts", () => {
  test("idleの監視対象が試合中になったとき、開始通知を送りIN_GAMEへ更新する", async () => {
    const { client, sendSpy } = clientWithSend();
    using getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () => Promise.resolve({ success: true as const, watchers: [watcher()] }),
    );
    using getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGame()),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(getWatchersStub, 1);
    assertSpyCalls(getAccountStub, 1);
    assertSpyCalls(activeGameStub, 1);
    assertSpyCalls(sendSpy, 1);
    assertEquals(updateStub.calls[0].args[0], "guild-1");
    assertEquals(updateStub.calls[0].args[1], "target-1");
    assertEquals(updateStub.calls[0].args[2].lastState, "IN_GAME");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
    assertEquals(updateStub.calls[0].args[2].currentMatchId, null);
  });

  test("試合中通知間隔を過ぎたとき、概要更新を送る", async () => {
    Deno.env.set("MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS", "1");
    const { client, sendSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "IN_GAME",
            currentGameId: "12345",
            lastInGameNotifiedAt: new Date(Date.now() - 10_000),
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGame()),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(sendSpy, 1);
    assertEquals(updateStub.calls[0].args[2].lastState, "IN_GAME");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
  });

  test("試合終了後にMatch-v5が取得できたとき、終了通知と戦績通知を送る", async () => {
    const { client, sendSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "IN_GAME",
            currentGameId: "12345",
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(null),
    );
    using getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(match()),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(sendSpy, 2);
    assertSpyCall(getMatchStub, 0, { args: ["asia", "JP1_12345"] });
    assertEquals(updateStub.calls.at(-1)?.args[2].lastState, "IDLE");
    assertEquals(updateStub.calls.at(-1)?.args[2].currentGameId, null);
  });
});
