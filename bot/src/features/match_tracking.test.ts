import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Client } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/schema";
import { riotApi } from "@adteemo/api/riot-api";
import { riotStaticData } from "@adteemo/api/riot-static-data";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { matchTracker } from "./match_tracking.ts";
import { afterEach, beforeEach } from "@std/testing/bdd";

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
    currentNotificationMessageId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
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

function clientWithSend(
  send: () => Promise<unknown> = () => Promise.resolve({ id: "message-new" }),
) {
  const message = {
    id: "message-existing",
    edit: () => Promise.resolve(),
  };
  const channel = {
    send,
    messages: {
      fetch: () => Promise.resolve(message),
    },
  };
  const sendSpy = spy(channel, "send");
  const editSpy = spy(message, "edit");
  const client = {
    channels: {
      fetch: () => Promise.resolve(channel),
    },
  } as unknown as Client;
  return { client, sendSpy, editSpy };
}

describe("match_tracking.ts", () => {
  const staticDataStubs: { restore(): void }[] = [];

  beforeEach(() => {
    staticDataStubs.push(
      stub(
        riotStaticData,
        "getChampionNameById",
        () => Promise.resolve("ティーモ"),
      ),
      stub(
        riotStaticData,
        "getQueueNameById",
        () => Promise.resolve("ランクソロ/デュオ"),
      ),
      stub(
        riotStaticData,
        "getMapNameById",
        () => Promise.resolve("サモナーズリフト"),
      ),
      stub(
        riotStaticData,
        "getGameModeName",
        () => Promise.resolve("クラシック"),
      ),
    );
  });

  afterEach(() => {
    for (const staticDataStub of staticDataStubs.splice(0)) {
      staticDataStub.restore();
    }
  });

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
    assertEquals(
      updateStub.calls[0].args[2].currentNotificationMessageId,
      "message-new",
    );
  });

  test("試合中通知間隔を過ぎたとき、既存投稿を編集する", async () => {
    const originalInterval = Deno.env.get(
      "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
    );
    Deno.env.set("MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS", "1");
    try {
      const { client, sendSpy, editSpy } = clientWithSend();
      using _getWatchersStub = stub(
        apiClient,
        "getEnabledMatchWatchers",
        () =>
          Promise.resolve({
            success: true as const,
            watchers: [watcher({
              lastState: "IN_GAME",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
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

      assertSpyCalls(sendSpy, 0);
      assertSpyCalls(editSpy, 1);
      assertEquals(updateStub.calls[0].args[2].lastState, "IN_GAME");
      assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
      assertEquals(
        updateStub.calls[0].args[2].currentNotificationMessageId,
        "message-existing",
      );
    } finally {
      if (originalInterval === undefined) {
        Deno.env.delete("MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS");
      } else {
        Deno.env.set(
          "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
          originalInterval,
        );
      }
    }
  });

  test("試合終了後にMatch-v5が取得できたとき、終了通知と戦績通知を送る", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "IN_GAME",
            currentGameId: "12345",
            currentNotificationMessageId: "message-existing",
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

    assertSpyCalls(sendSpy, 0);
    assertSpyCalls(editSpy, 2);
    assertSpyCall(getMatchStub, 0, { args: ["asia", "JP1_12345"] });
    assertEquals(updateStub.calls.at(-1)?.args[2].lastState, "IDLE");
    assertEquals(updateStub.calls.at(-1)?.args[2].currentGameId, null);
    assertEquals(
      updateStub.calls.at(-1)?.args[2].currentNotificationMessageId,
      null,
    );
  });

  test("結果取得待ちが一定時間を超えたとき、Match-v5を再試行せずIDLEへ戻す", async () => {
    const { client, sendSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "FETCHING_RESULT",
            currentGameId: "12345",
            currentMatchId: "JP1_12345",
            gameStartedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
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

    assertSpyCalls(getMatchStub, 0);
    assertSpyCalls(sendSpy, 1);
    assertEquals(updateStub.calls[0].args[2].lastState, "IDLE");
    assertEquals(updateStub.calls[0].args[2].currentGameId, null);
    assertEquals(updateStub.calls[0].args[2].currentMatchId, null);
    assertEquals(updateStub.calls[0].args[2].gameStartedAt, null);
    assertEquals(updateStub.calls[0].args[2].pendingResultMatchId, null);
  });

  test("試合中のままgameIdが変わったとき、旧試合を結果取得待ちにして新試合開始を投稿する", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "IN_GAME",
            currentGameId: "12345",
            currentNotificationMessageId: "message-existing",
            gameStartedAt: new Date(Date.now() - 120_000),
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
      () => Promise.resolve(activeGame(67890)),
    );
    using getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(null),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(editSpy, 1);
    assertSpyCalls(sendSpy, 1);
    assertSpyCall(getMatchStub, 0, { args: ["asia", "JP1_12345"] });
    assertEquals(updateStub.calls[0].args[2].currentGameId, "67890");
    assertEquals(updateStub.calls[0].args[2].pendingResultMatchId, "JP1_12345");
    assertEquals(
      updateStub.calls[0].args[2].currentNotificationMessageId,
      "message-new",
    );
  });

  test("pending resultがある状態でも現在の試合監視を継続する", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "IN_GAME",
            currentGameId: "67890",
            currentNotificationMessageId: "message-existing",
            pendingResultMatchId: "JP1_12345",
            pendingResultNotificationMessageId: "message-old",
            pendingResultStartedAt: new Date(Date.now() - 120_000),
            lastInGameNotifiedAt: new Date(Date.now() - 10 * 60_000),
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(null),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGame(67890)),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCall(getMatchStub, 0, { args: ["asia", "JP1_12345"] });
    assertSpyCalls(sendSpy, 0);
    assertSpyCalls(editSpy, 1);
    assertEquals(updateStub.calls.at(-1)?.args[2].currentGameId, "67890");
  });

  test("IDLEかつ試合中ではない監視対象では、DB状態更新をスキップする", async () => {
    const { client, sendSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher()],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(null),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(activeGameStub, 1);
    assertSpyCalls(sendSpy, 0);
    assertSpyCalls(updateStub, 0);
  });

  test("同一targetDiscordIdを複数guildで監視しているとき、1回の処理ではRiot取得を共有しつつ各guildの通知と状態更新を継続する", async () => {
    let sendCount = 0;
    const { client, sendSpy } = clientWithSend(() => {
      sendCount += 1;
      if (sendCount === 1) {
        return Promise.reject(new Error("Missing permissions"));
      }
      return Promise.resolve({ id: `message-new-${sendCount}` });
    });
    using _loggerStub = stub(botLogger, "error", () => {});
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({ guildId: "guild-1", channelId: "channel-1" }),
            watcher({ guildId: "guild-2", channelId: "channel-2" }),
          ],
        }),
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

    assertSpyCalls(getAccountStub, 1);
    assertSpyCalls(activeGameStub, 1);
    assertSpyCalls(sendSpy, 2);
    assertSpyCalls(updateStub, 2);
    assertEquals(updateStub.calls[0].args[0], "guild-1");
    assertEquals(updateStub.calls[0].args[1], "target-1");
    assertEquals(updateStub.calls[0].args[2].lastState, "IN_GAME");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
    assertEquals(
      updateStub.calls[0].args[2].currentNotificationMessageId,
      null,
    );
    assertEquals(updateStub.calls[1].args[0], "guild-2");
    assertEquals(updateStub.calls[1].args[1], "target-1");
    assertEquals(updateStub.calls[1].args[2].lastState, "IN_GAME");
    assertEquals(updateStub.calls[1].args[2].currentGameId, "12345");
    assertEquals(
      updateStub.calls[1].args[2].currentNotificationMessageId,
      "message-new-2",
    );
  });

  test("通知送信に失敗しても、試合開始の状態更新は継続する", async () => {
    const { client } = clientWithSend(() =>
      Promise.reject(new Error("Missing permissions"))
    );
    using _loggerStub = stub(botLogger, "error", () => {});
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () => Promise.resolve({ success: true as const, watchers: [watcher()] }),
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

    assertEquals(updateStub.calls[0].args[2].lastState, "IN_GAME");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
  });
});
