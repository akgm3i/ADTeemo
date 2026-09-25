import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { EmbedBuilder } from "discord.js";
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
  resultFetchTimeout: () => new EmbedBuilder().setTitle("timeout"),
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
    return Promise.resolve([]);
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
  await service.processMatchWatchers();
  assertEquals(activeFetches, 2); // A new tick must fetch fresh source data.
});

test("同じ試合の結果待ちが2guildにある場合、Matchとランク取得は共有し結果投稿と状態は各guildへ保存する", async () => {
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
  const notified: (string | null | undefined)[] = [];
  const service = createMatchTrackingService({
    apiClient,
    notifier: {
      sendOrEditWatcherMessage: (_watcher, messageId) => {
        notified.push(messageId);
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
  assertEquals(notified, ["guild-1-message", "guild-2-message"]);
  assertEquals(matchFetches, 1);
  assertEquals(rankFetches, 1);
  assertEquals(
    (await db.actions.getEnabledMatchWatchers()).map((watcher) =>
      watcher.pendingResultMatchId
    ),
    [null, null],
  );
});
