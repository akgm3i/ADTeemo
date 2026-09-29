import { assertEquals, assertObjectMatch } from "@std/assert";
import { test } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { EmbedBuilder } from "discord.js";
import { RiotApiRequestError } from "../../../api/src/riot_api.ts";
import { createApp } from "../../../api/src/app.ts";
import { createTestDependencies } from "../../../api/src/test_utils.ts";
import { createMigratedTestDatabase } from "../../../api/src/db/integration_test_harness.ts";
import { createInProcessBotApiClient } from "../../../tests/integration/test_utils.ts";
import { createMatchTrackingService } from "./match_tracking_service.ts";
import {
  createMatchTrackingNotifier,
  type WatcherMessage,
} from "./match_tracking_notifier.ts";
import { createDurableMatchTrackingNotifier } from "./match_tracking_delivery.ts";
import { activeGame, match } from "./testing/match_tracking_fixtures.ts";

const logger = { warn() {}, error() {} };
const config = {
  pollIntervalMs: 60000,
  inGameNotifyIntervalMs: 300000,
  resultFetchTimeoutMs: 10800000,
  riotLongWindowLimit: 100,
  riotLongWindowMs: 120000,
};
const renderer = {
  activeGame: () => Promise.resolve(new EmbedBuilder().setTitle("progress")),
  resultPending: () => new EmbedBuilder().setTitle("pending"),
  resultUnavailable: (
    _watcher: unknown,
    _matchId: string,
    reason = "timeout",
  ) => Promise.resolve(new EmbedBuilder().setTitle(reason)),
  matchResult: (watcher: { targetDiscordId: string }) =>
    Promise.resolve(
      new EmbedBuilder().setTitle(`result:${watcher.targetDiscordId}`),
    ),
};
function discord() {
  const messages = new Map<string, WatcherMessage>();
  const writes: string[] = [];
  let failEdits = false;
  const put = (id: string, embeds: EmbedBuilder[]): WatcherMessage => {
    const message: WatcherMessage = {
      id,
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: embeds.map((embed) => embed.toJSON()),
      createdTimestamp: Date.now(),
      edit: ({ embeds }) => {
        if (failEdits) return Promise.reject(new Error("network"));
        put(id, embeds);
        return Promise.resolve();
      },
    };
    messages.set(id, message);
    writes.push(embeds[0].data.title!);
    return message;
  };
  put("shared", [new EmbedBuilder().setTitle("progress")]);
  const notifier = createMatchTrackingNotifier({
    logger,
    client: {
      channels: {
        fetch: () =>
          Promise.resolve({
            send: ({ embeds }) =>
              Promise.resolve(put(`message-${messages.size}`, embeds)),
            messages: { fetch: (id) => Promise.resolve(messages.get(id)!) },
            history: () => Promise.resolve([...messages.values()].reverse()),
          }),
      },
    },
  });
  return {
    notifier,
    messages,
    writes,
    setFailEdits: (value: boolean) => {
      failEdits = value;
    },
  };
}

test("共有投稿のAだけ終了しBの検査が失敗した場合、再起動後の別tickでBが終了してもAの結果を保持する", async () => {
  // Arrange: real API, client, DB, service, durable notifier; only Riot/Discord are fake.
  await using db = await createMigratedTestDatabase();
  for (const user of ["A", "B"]) {
    await db.actions.upsertRiotAccount({
      discordId: user,
      puuid: `puuid-${user}`,
      gameName: user,
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await db.actions.upsertMatchWatcher({
      guildId: "guild",
      targetDiscordId: user,
      requesterId: user,
      channelId: "channel",
    });
    await db.actions.updateMatchWatcherState("guild", user, {
      lastState: "IN_GAME",
      currentGameId: "12345",
      currentNotificationMessageId: "shared",
      gameStartedAt: new Date(),
    });
  }
  let failB = true;
  const deps = createTestDependencies({ dbActions: db.actions });
  deps.riotApi.getActiveGameByPuuid = (_platform, puuid) =>
    puuid === "puuid-B" && failB
      ? Promise.reject(new Error("Riot unavailable"))
      : Promise.resolve(null);
  deps.riotApi.getMatchById = () =>
    Promise.resolve({ ...match(), info: { ...match().info, queueId: 450 } });
  const apiClient = createInProcessBotApiClient(createApp(deps));
  const gateway = discord();
  const restart = () =>
    createMatchTrackingService({
      apiClient,
      notifier: createDurableMatchTrackingNotifier({
        store: apiClient,
        notifier: gateway.notifier,
        logger,
      }),
      renderer,
      clock: { now: () => new Date() },
      logger,
      config,
    });
  // Act
  await restart().processMatchWatchers();
  assertEquals(
    (gateway.messages.get("shared")?.embeds?.[0] as { title: string }).title,
    "result:A",
  );
  failB = false;
  await restart().processMatchWatchers();
  // Assert
  const titles = [...gateway.messages.values()].map((message) =>
    (message.embeds?.[0] as { title?: string }).title
  );
  assertEquals(titles.sort(), ["result:A", "result:B"]);
});

test("進捗が3回失敗してbackoff中に結果が確定した場合、再起動で古い進捗を再配送しない", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "A",
    puuid: "puuid-A",
    gameName: "A",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  await db.actions.upsertMatchWatcher({
    guildId: "guild",
    targetDiscordId: "A",
    requesterId: "A",
    channelId: "channel",
  });
  let now = Date.now();
  using _clock = stub(Date, "now", () => now);
  const [watcher] = await db.actions.getEnabledMatchWatchers();
  const apiClient = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: db.actions })),
  );
  const gateway = discord();
  const restart = () =>
    createDurableMatchTrackingNotifier({
      store: apiClient,
      notifier: gateway.notifier,
      logger,
    });
  gateway.setFailEdits(true);
  await restart().sendOrEditWatcherMessage(
    watcher,
    "shared",
    new EmbedBuilder().setTitle("old-progress"),
    "progress:jp1:12345:0",
  );
  for (const delay of [30000, 60000]) {
    now += delay;
    await restart().resumePending();
  }
  gateway.setFailEdits(false);
  // Act
  await restart().sendOrEditWatcherMessage(
    watcher,
    "shared",
    new EmbedBuilder().setTitle("pending"),
    "pending:JP1_12345",
  );
  await restart().sendOrEditWatcherMessage(
    watcher,
    "shared",
    new EmbedBuilder().setTitle("result"),
    "result:JP1_12345",
  );
  now += 120000;
  await restart().resumePending();
  // Assert
  assertEquals(gateway.writes, ["progress", "pending", "result"]);
});

test("同一accountを2guildで監視すると、tick内のRiot元データは1回だけ取得しguildごとの通知を継続する", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "A",
    puuid: "puuid-A",
    gameName: "A",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  for (const guildId of ["guild-1", "guild-2"]) {
    await db.actions.upsertMatchWatcher({
      guildId,
      targetDiscordId: "A",
      requesterId: "A",
      channelId: `${guildId}-channel`,
    });
  }
  const deps = createTestDependencies({ dbActions: db.actions });
  let activeFetches = 0;
  let rankFetches = 0;
  deps.riotApi.getActiveGameByPuuid = () => {
    activeFetches++;
    return Promise.resolve(activeGame());
  };
  deps.riotApi.getLeagueEntriesByPuuid = () => {
    rankFetches++;
    return Promise.resolve([{
      queueType: "RANKED_SOLO_5x5",
      tier: "GOLD",
      rank: "I",
      leaguePoints: 42,
      wins: 10,
      losses: 8,
    }]);
  };
  const apiClient = createInProcessBotApiClient(createApp(deps));
  const notified: string[] = [];
  const service = createMatchTrackingService({
    apiClient,
    notifier: {
      sendOrEditWatcherMessage: (watcher) => {
        notified.push(watcher.guildId);
        return Promise.resolve({
          status: "sent",
          messageId: `message-${watcher.guildId}`,
        });
      },
    },
    renderer,
    clock: { now: () => new Date() },
    logger,
    config,
  });
  // Act
  await service.processMatchWatchers();
  // Assert
  assertEquals(notified, ["guild-1", "guild-2"]);
  assertEquals(activeFetches, 1);
  assertEquals(rankFetches, 1);
  assertEquals(
    (await db.db.query.pendingMatchRankSnapshots.findMany()).map((
      snapshot,
    ) => ({
      platform: snapshot.platform,
      gameId: snapshot.gameId,
      puuid: snapshot.puuid,
      queueType: snapshot.queueType,
      leaguePoints: snapshot.leaguePoints,
    })).sort((a, b) => a.queueType.localeCompare(b.queueType)),
    [
      {
        platform: "jp1",
        gameId: "12345",
        puuid: "puuid-A",
        queueType: "RANKED_FLEX_SR",
        leaguePoints: null,
      },
      {
        platform: "jp1",
        gameId: "12345",
        puuid: "puuid-A",
        queueType: "RANKED_SOLO_5x5",
        leaguePoints: 42,
      },
    ],
  );
  await service.processMatchWatchers();
  assertEquals(activeFetches, 2); // A new tick must fetch fresh source data.
  assertEquals(rankFetches, 1); // An ongoing game must keep the original before snapshot.
});

for (const endedNow of [false, true]) {
  test(`同じ試合を2guildで${endedNow ? "終了検知した" : "結果待ちしている"}場合、結果取得を共有し各投稿を一度だけ結果へ更新する`, async () => {
    // Arrange
    await using db = await createMigratedTestDatabase();
    await db.actions.upsertRiotAccount({
      discordId: "A",
      puuid: "puuid-1",
      gameName: "A",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    for (const guildId of ["guild-1", "guild-2"]) {
      await db.actions.upsertMatchWatcher({
        guildId,
        targetDiscordId: "A",
        requesterId: "A",
        channelId: `${guildId}-channel`,
      });
      await db.actions.updateMatchWatcherState(guildId, "A", {
        ...(endedNow
          ? {
            lastState: "IN_GAME" as const,
            currentGameId: "12345",
            currentNotificationMessageId: `${guildId}-message`,
            gameStartedAt: new Date(),
          }
          : {
            lastState: "IDLE" as const,
            pendingResultMatchId: "JP1_12345",
            pendingResultNotificationMessageId: `${guildId}-message`,
            pendingResultStartedAt: new Date(),
          }),
      });
    }
    const deps = createTestDependencies({ dbActions: db.actions });
    let matchFetches = 0;
    let rankFetches = 0;
    deps.riotApi.getActiveGameByPuuid = () => Promise.resolve(null);
    deps.riotApi.getMatchById = () => {
      matchFetches++;
      return Promise.resolve(match());
    };
    deps.riotApi.getLeagueEntriesByPuuid = () => {
      rankFetches++;
      return Promise.resolve([]);
    };
    const apiClient = createInProcessBotApiClient(createApp(deps));
    const notified: unknown[] = [];
    const service = createMatchTrackingService({
      apiClient,
      notifier: {
        sendOrEditWatcherMessage: (watcher, messageId, embed, intent) => {
          notified.push([watcher.guildId, messageId, embed.data.title, intent]);
          return Promise.resolve({ status: "edited", messageId: messageId! });
        },
      },
      renderer,
      clock: { now: () => new Date() },
      logger,
      config,
    });
    // Act
    await service.processMatchWatchers();
    // Assert
    assertEquals(notified, [
      ["guild-1", "guild-1-message", "result:A", "result:JP1_12345"],
      ["guild-2", "guild-2-message", "result:A", "result:JP1_12345"],
    ]);
    assertEquals(matchFetches, 1);
    assertEquals(rankFetches, 1);
    assertEquals(
      (await db.actions.getEnabledMatchWatchers()).map((watcher) =>
        watcher.pendingResultMatchId
      ),
      [null, null],
    );
  });
}

test("結果取得が403で拒否された場合、2guildへ取得不可を一度だけ通知して結果待ちを解除する", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "A",
    puuid: "puuid-1",
    gameName: "A",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  for (const guildId of ["guild-1", "guild-2"]) {
    await db.actions.upsertMatchWatcher({
      guildId,
      targetDiscordId: "A",
      requesterId: "A",
      channelId: `${guildId}-channel`,
    });
    await db.actions.updateMatchWatcherState(guildId, "A", {
      lastState: "IDLE",
      pendingResultMatchId: "JP1_12345",
      pendingResultNotificationMessageId: `${guildId}-message`,
      pendingResultStartedAt: new Date(),
    });
  }
  let matchFetches = 0;
  const deps = createTestDependencies({ dbActions: db.actions });
  deps.riotApi.getActiveGameByPuuid = () => Promise.resolve(null);
  deps.riotApi.getMatchById = () => {
    matchFetches++;
    return Promise.reject(
      new RiotApiRequestError(
        "http",
        "asia:GET /lol/match/v5/matches/:matchId",
        403,
      ),
    );
  };
  const apiClient = createInProcessBotApiClient(createApp(deps));
  const sent: unknown[] = [];
  const service = createMatchTrackingService({
    apiClient,
    renderer,
    logger,
    config,
    clock: { now: () => new Date() },
    notifier: createDurableMatchTrackingNotifier({
      store: apiClient,
      logger,
      notifier: {
        sendOrEditWatcherMessage: (watcher, messageId, embed) => {
          sent.push([watcher.guildId, messageId, embed.data.title]);
          return Promise.resolve({ status: "edited", messageId: messageId! });
        },
      },
    }),
  });
  // Act
  await service.processMatchWatchers();
  await service.processMatchWatchers();
  // Assert
  assertEquals(sent, [["guild-1", "guild-1-message", "access_denied"], [
    "guild-2",
    "guild-2-message",
    "access_denied",
  ]]);
  assertEquals(matchFetches, 1);
  assertEquals(
    (await db.actions.getEnabledMatchWatchers()).map((w) =>
      w.pendingResultMatchId
    ),
    [null, null],
  );
});

for (const available of [false, true]) {
  test(`Mayhem開始を保存して再起動した場合、2guildで${available ? "取得した戦績を表示" : "取得不可をMayhemとして表示"}する`, async () => {
    await using db = await createMigratedTestDatabase();
    await db.actions.upsertRiotAccount({
      discordId: "A",
      puuid: "puuid-1",
      gameName: "A",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    for (const guildId of ["guild-1", "guild-2"]) {
      await db.actions.upsertMatchWatcher({
        guildId,
        targetDiscordId: "A",
        requesterId: "A",
        channelId: `${guildId}-channel`,
      });
    }
    const gameStartedAt = Date.now() - 120_000;
    let now = new Date(gameStartedAt + 120_000);
    let inGame = true;
    let ready = false;
    const deps = createTestDependencies({ dbActions: db.actions });
    deps.riotApi.getActiveGameByPuuid = () =>
      Promise.resolve(
        inGame
          ? {
            ...activeGame(),
            gameMode: "KIWI",
            gameStartTime: gameStartedAt,
            gameQueueConfigId: 2400,
          }
          : null,
      );
    deps.riotApi.getMatchById = () => {
      if (!ready) return Promise.resolve(null);
      if (!available) {
        return Promise.reject(
          new RiotApiRequestError(
            "http",
            "asia:GET /lol/match/v5/matches/:matchId",
            403,
          ),
        );
      }
      return Promise.resolve({
        ...match(),
        info: { ...match().info, gameMode: "KIWI", queueId: 2400 },
      });
    };
    deps.opggMatchDetailService.resolveAndSave = () => Promise.resolve(null);
    const apiClient = createInProcessBotApiClient(createApp(deps));
    const sent: unknown[] = [];
    const renderedObservations: unknown[] = [];
    const restart = () =>
      createMatchTrackingService({
        apiClient,
        renderer: {
          ...renderer,
          resultUnavailable: (watcher, matchId, reason, observation) => {
            renderedObservations.push(observation);
            return renderer.resultUnavailable(watcher, matchId, reason);
          },
          matchResult: (
            watcher,
            _account,
            _match,
            _rank,
            _opgg,
            observation,
          ) => {
            renderedObservations.push(observation);
            return renderer.matchResult(watcher);
          },
        },
        logger,
        config,
        clock: { now: () => now },
        notifier: {
          sendOrEditWatcherMessage: (watcher, messageId, embed) => {
            sent.push([watcher.guildId, embed.data.title]);
            return Promise.resolve({
              status: "edited",
              messageId: messageId ?? `${watcher.guildId}-message`,
            });
          },
        },
      });
    await restart().processMatchWatchers();
    for (const watcher of await db.actions.getEnabledMatchWatchers()) {
      assertObjectMatch(watcher, {
        currentGameMode: "KIWI",
        currentGameObservation: { championId: 17, elapsedSeconds: 120 },
      });
    }
    now = new Date(now.getTime() + 60_000);
    await restart().processMatchWatchers();
    for (const watcher of await db.actions.getEnabledMatchWatchers()) {
      assertObjectMatch(watcher, {
        currentGameObservation: { championId: 17, elapsedSeconds: 180 },
      });
    }
    inGame = false;
    await restart().processMatchWatchers();
    for (const watcher of await db.actions.getEnabledMatchWatchers()) {
      assertObjectMatch(watcher, {
        currentGameMode: null,
        currentGameObservation: null,
        pendingResultGameMode: "KIWI",
        pendingResultObservation: { championId: 17, elapsedSeconds: 180 },
      });
    }
    now = new Date(now.getTime() + 60 * 60_000);
    ready = true;
    sent.length = 0;
    await restart().processMatchWatchers();
    await restart().processMatchWatchers();
    assertEquals(renderedObservations, [
      { championId: 17, elapsedSeconds: 180 },
      { championId: 17, elapsedSeconds: 180 },
    ]);
    assertEquals(sent, [["guild-1", available ? "result:A" : "mayhem"], [
      "guild-2",
      available ? "result:A" : "mayhem",
    ]]);
    for (const watcher of await db.actions.getEnabledMatchWatchers()) {
      assertObjectMatch(watcher, {
        pendingResultMatchId: null,
        pendingResultGameMode: null,
        pendingResultObservation: null,
      });
    }
  });
}

test("SG2移行後に同じnumeric IDの新Mayhemが始まると、実API経由で旧PH2結果と新currentを分離して保存する", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  const now = new Date();
  await db.actions.upsertRiotAccount({
    discordId: "A",
    puuid: "puuid-1",
    gameName: "A",
    tagLine: "SEA",
    platform: "sg2",
    region: "sea",
  });
  await db.actions.upsertMatchWatcher({
    guildId: "guild",
    targetDiscordId: "A",
    requesterId: "A",
    channelId: "channel",
  });
  await db.actions.updateMatchWatcherState("guild", "A", {
    lastState: "IN_GAME",
    currentGameId: "12345",
    currentMatchId: "PH2_12345",
    currentNotificationMessageId: "shared",
    currentGameMode: "KIWI",
    currentGameObservation: { championId: 17, elapsedSeconds: 3600 },
    gameStartedAt: new Date(now.getTime() - 3_600_000),
  });
  const oldMatch = match();
  oldMatch.metadata.matchId = "PH2_12345";
  const deps = createTestDependencies({ dbActions: db.actions });
  deps.riotApi.getActiveGameByPuuid = () =>
    Promise.resolve({
      ...activeGame(),
      gameMode: "KIWI",
      gameQueueConfigId: 2400,
      gameStartTime: now.getTime() - 60_000,
      gameLength: 60,
      participants: [{ puuid: "puuid-1", championId: 99, teamId: 100 }],
    });
  const fetched: string[] = [];
  deps.riotApi.getMatchById = (_region, matchId) => {
    fetched.push(matchId);
    return Promise.resolve(oldMatch);
  };
  deps.riotApi.getLeagueEntriesByPuuid = () => Promise.resolve([]);
  const apiClient = createInProcessBotApiClient(createApp(deps));
  const gateway = discord();
  const service = createMatchTrackingService({
    apiClient,
    notifier: createDurableMatchTrackingNotifier({
      store: apiClient,
      notifier: gateway.notifier,
      logger,
    }),
    renderer,
    clock: { now: () => now },
    logger,
    config,
  });

  // Act
  await service.processMatchWatchers();

  // Assert
  assertEquals(fetched, ["PH2_12345"]);
  const [saved] = await db.actions.getEnabledMatchWatchers();
  assertEquals(saved.currentMatchId, "SG2_12345");
  assertEquals(saved.currentGameObservation, {
    championId: 99,
    elapsedSeconds: 60,
  });
  assertEquals(saved.pendingResultMatchId, null);
  assertEquals(saved.currentNotificationMessageId === "shared", false);
  assertEquals(
    (gateway.messages.get("shared")?.embeds?.[0] as { title: string }).title,
    "result:A",
  );
  assertEquals(
    (gateway.messages.get(saved.currentNotificationMessageId!)?.embeds?.[0] as {
      title: string;
    }).title,
    "progress",
  );
  const outbox = await db.db.query.notificationDeliveries.findMany();
  assertEquals(
    outbox.map((
      delivery,
    ) => [delivery.matchId, delivery.stage, delivery.status]).sort(),
    [
      ["PH2_12345", 3, "delivered"],
      ["SG2_12345", 0, "delivered"],
    ],
  );
});
