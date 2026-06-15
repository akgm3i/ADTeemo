import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Client } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/schema";
import { riotApi } from "@adteemo/api/riot-api";
import { riotStaticData } from "@adteemo/api/riot-static-data";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";
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

function account(overrides: Partial<RiotAccount> = {}): RiotAccount {
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
    ...overrides,
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

function activeGameWithParticipants(puuids: string[], gameId = 12345) {
  return {
    ...activeGame(gameId),
    participants: puuids.map((puuid, index) => ({
      puuid,
      championId: 17 + index,
      teamId: 100,
    })),
  };
}

function activeGameForPuuid(puuid: string, gameId = 12345) {
  const game = activeGame(gameId);
  game.participants[0].puuid = puuid;
  return game;
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
}

function clientWithSend(
  send: (options: unknown) => Promise<unknown> = () =>
    Promise.resolve({ id: "message-new" }),
) {
  const message = {
    id: "message-existing",
    edit: (options: { embeds: { toJSON(): unknown }[] }) =>
      Promise.resolve(options),
  };
  const channel = {
    send,
    messages: {
      fetch: (messageId: string) =>
        Promise.resolve({ ...message, id: messageId }),
    },
  };
  const sendSpy = spy(channel, "send");
  const fetchSpy = spy(channel.messages, "fetch");
  const editSpy = spy(message, "edit");
  const client = {
    channels: {
      fetch: () => Promise.resolve(channel),
    },
  } as unknown as Client;
  return { client, sendSpy, fetchSpy, editSpy };
}

function editedEmbedFieldValue(
  editSpy: { calls: unknown[] },
  callIndex: number,
  fieldName: string,
) {
  const call = editSpy.calls[callIndex] as unknown as {
    args: [
      {
        embeds: { toJSON(): { fields?: { name: string; value: string }[] } }[];
      },
    ];
  };
  const resultEmbed = call.args[0].embeds[0].toJSON();
  return resultEmbed.fields?.find((field) => field.name === fieldName)?.value;
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

  test("同じギルドとチャンネルで複数の監視対象が同じ試合を開始したとき、開始通知を1回だけ送り同じ投稿IDへ更新する", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({ targetDiscordId: "target-1" }),
            watcher({ targetDiscordId: "target-2" }),
          ],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-1" ? "puuid-1" : "puuid-2",
            gameName: discordId === "target-1" ? "Teemo" : "Tristana",
          }),
        }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGameWithParticipants(["puuid-1", "puuid-2"])),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(sendSpy, 1);
    assertSpyCalls(editSpy, 1);
    assertEquals(updateStub.calls.length, 2);
    assertEquals(
      updateStub.calls.map((call) => call.args[2].currentNotificationMessageId),
      ["message-new", "message-new"],
    );
    const editedEmbed = editSpy.calls[0].args[0].embeds[0].toJSON() as {
      description?: string;
    };
    assertEquals(
      editedEmbed.description?.includes("<@target-1>"),
      true,
    );
    assertEquals(
      editedEmbed.description?.includes("<@target-2>"),
      true,
    );
  });

  test("後続tickで同じ投稿IDの試合に監視対象が増えたとき、既存投稿を編集して対象者一覧を更新する", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({ targetDiscordId: "target-2" }),
            watcher({
              targetDiscordId: "target-1",
              lastState: "IN_GAME",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
              lastInGameNotifiedAt: new Date(),
            }),
          ],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-1" ? "puuid-1" : "puuid-2",
            gameName: discordId === "target-1" ? "Teemo" : "Tristana",
          }),
        }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGameWithParticipants(["puuid-1", "puuid-2"])),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(sendSpy, 0);
    assertSpyCalls(editSpy, 1);
    const target2Update = updateStub.calls.find((call) =>
      call.args[1] === "target-2"
    );
    assertEquals(
      target2Update?.args[2].currentNotificationMessageId,
      "message-existing",
    );
    const editedEmbed = editSpy.calls[0].args[0].embeds[0].toJSON() as {
      description?: string;
    };
    assertEquals(
      editedEmbed.description?.includes("<@target-1>"),
      true,
    );
    assertEquals(
      editedEmbed.description?.includes("<@target-2>"),
      true,
    );
  });

  test("共有投稿IDを保持した後続監視対象だけが残ったとき、既存投稿を編集して進行中通知を継続する", async () => {
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
              targetDiscordId: "target-2",
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
        () =>
          Promise.resolve({
            success: true as const,
            account: account({
              discordId: "target-2",
              puuid: "puuid-2",
              gameName: "Tristana",
            }),
          }),
      );
      using _activeGameStub = stub(
        riotApi,
        "getActiveGameByPuuid",
        () => Promise.resolve(activeGameWithParticipants(["puuid-2"])),
      );
      using updateStub = stub(
        apiClient,
        "updateMatchWatcherState",
        () => Promise.resolve({ success: true as const }),
      );

      await matchTracker.processMatchWatchers(client);

      assertSpyCalls(sendSpy, 0);
      assertSpyCalls(editSpy, 1);
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

  test("同じgameIdでもギルドまたはチャンネルが違うとき、開始通知を統合しない", async () => {
    const { client, sendSpy, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({ targetDiscordId: "target-1", guildId: "guild-1" }),
            watcher({ targetDiscordId: "target-2", guildId: "guild-2" }),
            watcher({
              targetDiscordId: "target-3",
              guildId: "guild-1",
              channelId: "channel-2",
            }),
          ],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: `puuid-${discordId.at(-1)}`,
            gameName: discordId,
          }),
        }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () =>
        Promise.resolve(
          activeGameWithParticipants(["puuid-1", "puuid-2", "puuid-3"]),
        ),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(sendSpy, 3);
    assertSpyCalls(editSpy, 0);
    assertEquals(updateStub.calls.length, 3);
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

  test("同じ開始通知を共有した複数監視対象の試合終了時、後続の結果通知は共有投稿を上書きしない", async () => {
    const { client, sendSpy, fetchSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({
              targetDiscordId: "target-1",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
              lastState: "IN_GAME",
            }),
            watcher({
              targetDiscordId: "target-2",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
              lastState: "IN_GAME",
            }),
          ],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-1" ? "puuid-1" : "puuid-2",
            gameName: discordId === "target-1" ? "Teemo" : "Tristana",
          }),
        }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(null),
    );
    using _getMatchStub = stub(
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

    assertSpyCalls(sendSpy, 1);
    assertEquals(
      fetchSpy.calls.filter((call) => call.args[0] === "message-existing")
        .length,
      2,
    );
    assertEquals(updateStub.calls.at(-1)?.args[1], "target-2");
    assertEquals(updateStub.calls.at(-1)?.args[2].lastState, "IDLE");
    assertEquals(
      updateStub.calls.at(-1)?.args[2].currentNotificationMessageId,
      null,
    );
  });

  test("ja_JPの試合結果ではchampionIdからチャンピオン名を表示する", async () => {
    const { client, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "FETCHING_RESULT",
            currentMatchId: "JP1_12345",
            currentNotificationMessageId: "message-existing",
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(match()),
    );
    using _updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertEquals(
      editedEmbedFieldValue(editSpy, 0, "チャンピオン"),
      "ティーモ",
    );
  });

  test("試合結果EmbedにMatch-v5から計算できるCS/minとキル関与率を表示する", async () => {
    const resultMatch = match();
    resultMatch.info.participants.push({
      puuid: "puuid-2",
      championId: 98,
      championName: "Shen",
      teamId: 100,
      win: true,
      kills: 20,
      deaths: 4,
      assists: 6,
      totalMinionsKilled: 120,
      neutralMinionsKilled: 0,
      goldEarned: 10000,
    });
    const { client, editSpy } = clientWithSend();
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
    using _getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(resultMatch),
    );
    using _updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertEquals(
      editedEmbedFieldValue(editSpy, 1, "CS/min"),
      "6.4",
    );
    assertEquals(
      editedEmbedFieldValue(editSpy, 1, "キル関与率"),
      "60.0%",
    );
  });

  test("試合結果Embedの追加戦績は試合時間やチームキルが不足してもfallback表示にする", async () => {
    const resultMatch = match();
    resultMatch.info.gameDuration = 0;
    resultMatch.info.participants[0].kills = 0;
    resultMatch.info.participants[0].assists = 0;
    const { client, editSpy } = clientWithSend();
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
    using _getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(resultMatch),
    );
    using _updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertEquals(
      editedEmbedFieldValue(editSpy, 1, "CS/min"),
      "-",
    );
    assertEquals(
      editedEmbedFieldValue(editSpy, 1, "キル関与率"),
      "-",
    );
  });

  test("静的データのチャンピオン名取得に失敗したとき、Match-v5の既存名で結果通知を完了する", async () => {
    const [championNameStub] = staticDataStubs.splice(0, 1);
    championNameStub.restore();
    const { client, editSpy } = clientWithSend();
    using _championNameFailureStub = stub(
      riotStaticData,
      "getChampionNameById",
      () => Promise.reject(new Error("Data Dragon failed")),
    );
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "FETCHING_RESULT",
            currentMatchId: "JP1_12345",
            currentNotificationMessageId: "message-existing",
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _getMatchStub = stub(
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

    assertSpyCalls(editSpy, 1);
    assertEquals(
      editedEmbedFieldValue(editSpy, 0, "チャンピオン"),
      "Teemo",
    );
    assertEquals(updateStub.calls.at(-1)?.args[2].lastState, "IDLE");
    assertEquals(updateStub.calls.at(-1)?.args[2].currentMatchId, null);
    assertEquals(updateStub.calls.at(-1)?.args[2].pendingResultMatchId, null);
  });

  test("静的データのモード名取得に失敗したとき、Match-v5の既存モードで結果通知を完了する", async () => {
    const gameModeStub = staticDataStubs.splice(3, 1)[0];
    gameModeStub.restore();
    const { client, editSpy } = clientWithSend();
    using _gameModeFailureStub = stub(
      riotStaticData,
      "getGameModeName",
      () => Promise.reject(new Error("Data Dragon failed")),
    );
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "FETCHING_RESULT",
            currentMatchId: "JP1_12345",
            currentNotificationMessageId: "message-existing",
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _getMatchStub = stub(
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

    assertSpyCalls(editSpy, 1);
    assertEquals(editedEmbedFieldValue(editSpy, 0, "モード"), "CLASSIC");
    assertEquals(updateStub.calls.at(-1)?.args[2].lastState, "IDLE");
    assertEquals(updateStub.calls.at(-1)?.args[2].pendingResultMatchId, null);
  });

  test("ja_JPの試合結果では代表キューとマップとモードを日本語表示に寄せる", async () => {
    const { client, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [watcher({
            lastState: "FETCHING_RESULT",
            currentMatchId: "JP1_12345",
            currentNotificationMessageId: "message-existing",
          })],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using _getMatchStub = stub(
      riotApi,
      "getMatchById",
      () => Promise.resolve(match()),
    );
    using _updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertEquals(
      editedEmbedFieldValue(editSpy, 0, "キュー"),
      "ランクソロ/デュオ",
    );
    assertEquals(
      editedEmbedFieldValue(editSpy, 0, "マップ"),
      "サモナーズリフト",
    );
    assertEquals(editedEmbedFieldValue(editSpy, 0, "モード"), "クラシック");
  });

  test("結果取得待ちが一定時間を超えたとき、対象者とIDLE復帰理由を通知しMatch-v5を再試行しない", async () => {
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
    const sentMessage = sendSpy.calls[0].args[0] as {
      embeds: {
        data: {
          title: string;
          description: string;
          footer: { text: string };
        };
      }[];
    };
    const sentEmbed = sentMessage.embeds[0].data;
    assertEquals(
      sentEmbed.title,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.title,
      ),
    );
    assertEquals(
      sentEmbed.description,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.description,
        { member: "<@target-1>" },
      ),
    );
    assertEquals(
      sentEmbed.footer.text,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId: "JP1_12345" },
      ),
    );
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

  test("同じ旧試合通知を共有した複数監視対象が次の試合へ進んだとき、後続の旧試合結果通知は共有投稿を上書きしない", async () => {
    const { client, sendSpy, fetchSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({
              targetDiscordId: "target-1",
              lastState: "IN_GAME",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
              gameStartedAt: new Date(Date.now() - 120_000),
            }),
            watcher({
              targetDiscordId: "target-2",
              lastState: "IN_GAME",
              currentGameId: "12345",
              currentNotificationMessageId: "message-existing",
              gameStartedAt: new Date(Date.now() - 120_000),
            }),
          ],
        }),
    );
    using _getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-1" ? "puuid-1" : "puuid-2",
            gameName: discordId === "target-1" ? "Teemo" : "Tristana",
          }),
        }),
    );
    using _activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      () =>
        Promise.resolve(
          activeGameWithParticipants(["puuid-1", "puuid-2"], 67890),
        ),
    );
    using _getMatchStub = stub(
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
    assertEquals(
      fetchSpy.calls.filter((call) => call.args[0] === "message-existing")
        .length,
      2,
    );
    const target2FinalUpdate = updateStub.calls
      .filter((call) => call.args[1] === "target-2")
      .at(-1);
    assertEquals(target2FinalUpdate?.args[2].currentGameId, "67890");
    assertEquals(target2FinalUpdate?.args[2].pendingResultMatchId, null);
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

  test("複数の監視対象が返されたとき、全員分の状態確認と通知と状態更新を行う", async () => {
    const { client, sendSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher(),
            watcher({
              targetDiscordId: "target-2",
              requesterId: "requester-2",
            }),
          ],
        }),
    );
    using getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-2" ? "puuid-2" : "puuid-1",
            gameName: discordId === "target-2" ? "Tristana" : "Teemo",
          }),
        }),
    );
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      (_platform, puuid) =>
        Promise.resolve(
          activeGameForPuuid(puuid, puuid === "puuid-2" ? 67890 : 12345),
        ),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(getAccountStub, 2);
    assertSpyCall(getAccountStub, 0, { args: ["target-1"] });
    assertSpyCall(getAccountStub, 1, { args: ["target-2"] });
    assertSpyCalls(activeGameStub, 2);
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-1"] });
    assertSpyCall(activeGameStub, 1, { args: ["jp1", "puuid-2"] });
    assertSpyCalls(sendSpy, 2);
    assertSpyCalls(updateStub, 2);
    assertEquals(updateStub.calls[0].args[1], "target-1");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "12345");
    assertEquals(updateStub.calls[1].args[1], "target-2");
    assertEquals(updateStub.calls[1].args[2].currentGameId, "67890");
  });

  test("一部の監視対象でRiotアカウント取得に失敗しても、後続の監視対象を処理する", async () => {
    const { client, sendSpy } = clientWithSend();
    using _loggerStub = stub(botLogger, "error", () => {});
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher(),
            watcher({ targetDiscordId: "target-2" }),
          ],
        }),
    );
    using getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) => {
        if (discordId === "target-1") {
          return Promise.resolve({
            success: false as const,
            error: "Riot account fetch failed",
          });
        }
        return Promise.resolve({
          success: true as const,
          account: account({ discordId, puuid: "puuid-2" }),
        });
      },
    );
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      (_platform, puuid) => Promise.resolve(activeGameForPuuid(puuid, 67890)),
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(getAccountStub, 2);
    assertSpyCalls(activeGameStub, 1);
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-2"] });
    assertSpyCalls(sendSpy, 1);
    assertSpyCalls(updateStub, 1);
    assertEquals(updateStub.calls[0].args[1], "target-2");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "67890");
  });

  test("一部の監視対象でRiot API処理に失敗しても、後続の監視対象を処理する", async () => {
    const { client, sendSpy } = clientWithSend();
    using _loggerStub = stub(botLogger, "error", () => {});
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher(),
            watcher({ targetDiscordId: "target-2" }),
          ],
        }),
    );
    using getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      (discordId) =>
        Promise.resolve({
          success: true as const,
          account: account({
            discordId,
            puuid: discordId === "target-2" ? "puuid-2" : "puuid-1",
          }),
        }),
    );
    using activeGameStub = stub(
      riotApi,
      "getActiveGameByPuuid",
      (_platform, puuid) => {
        if (puuid === "puuid-1") {
          throw new Error("Riot API failed");
        }
        return Promise.resolve(activeGameForPuuid(puuid, 67890));
      },
    );
    using updateStub = stub(
      apiClient,
      "updateMatchWatcherState",
      () => Promise.resolve({ success: true as const }),
    );

    await matchTracker.processMatchWatchers(client);

    assertSpyCalls(getAccountStub, 2);
    assertSpyCalls(activeGameStub, 2);
    assertSpyCalls(sendSpy, 1);
    assertSpyCalls(updateStub, 1);
    assertEquals(updateStub.calls[0].args[1], "target-2");
    assertEquals(updateStub.calls[0].args[2].currentGameId, "67890");
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

  test("同一matchIdの結果取得待ちが複数guildにあるとき、1回の処理ではRiot試合取得を共有しつつ各guildの通知と状態更新を継続する", async () => {
    const { client, editSpy } = clientWithSend();
    using _getWatchersStub = stub(
      apiClient,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve({
          success: true as const,
          watchers: [
            watcher({
              guildId: "guild-1",
              lastState: "FETCHING_RESULT",
              currentMatchId: "JP1_12345",
              currentNotificationMessageId: "message-existing-1",
              gameStartedAt: new Date(Date.now() - 120_000),
            }),
            watcher({
              guildId: "guild-2",
              channelId: "channel-2",
              lastState: "FETCHING_RESULT",
              currentMatchId: "JP1_12345",
              currentNotificationMessageId: "message-existing-2",
              gameStartedAt: new Date(Date.now() - 120_000),
            }),
          ],
        }),
    );
    using getAccountStub = stub(
      apiClient,
      "getRiotAccount",
      () => Promise.resolve({ success: true as const, account: account() }),
    );
    using matchStub = stub(
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

    assertSpyCalls(getAccountStub, 1);
    assertSpyCalls(matchStub, 1);
    assertSpyCalls(editSpy, 2);
    assertSpyCalls(updateStub, 2);
    assertEquals(updateStub.calls[0].args[0], "guild-1");
    assertEquals(updateStub.calls[1].args[0], "guild-2");
    assertEquals(updateStub.calls[0].args[2].pendingResultMatchId, null);
    assertEquals(updateStub.calls[1].args[2].pendingResultMatchId, null);
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
