import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { EmbedBuilder } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from "../../../api/src/db/integration_test_harness.ts";
import {
  createDurableMatchTrackingNotifier,
  type NotificationDeliveryStore,
} from "./match_tracking_delivery.ts";
import {
  createMatchTrackingNotifier,
  type WatcherMessage,
} from "./match_tracking_notifier.ts";

const watcher: MatchWatcher = {
  guildId: "guild",
  targetDiscordId: "user",
  riotAccountPuuid: "puuid-1",
  channelId: "channel",
  requesterId: "owner",
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
  createdAt: new Date(),
  updatedAt: null,
};
function store(database: MigratedTestDatabase): NotificationDeliveryStore {
  return {
    prepareNotificationDelivery: async (input) => ({
      success: true,
      delivery: await database.actions.prepareNotificationDelivery(input),
    }),
    claimNotificationDelivery: async (key) => ({
      success: true,
      delivery: await database.actions.claimNotificationDelivery(key),
    }),
    completeNotificationDelivery: async (key, input) => ({
      success: true,
      delivery: await database.actions.completeNotificationDelivery(key, input),
    }),
    failNotificationDelivery: async (key, input) => ({
      success: true,
      delivery: await database.actions.failNotificationDelivery(key, input),
    }),
    getPendingNotificationDeliveries: async () => ({
      success: true,
      deliveries: await database.actions.getPendingNotificationDeliveries(),
    }),
  };
}
const logger = { warn() {}, error() {} };

describe("永続通知配送とworker再起動", () => {
  test("Discord投稿後のreceipt保存が失敗した場合、再起動するとnonceがnullの履歴から識別子を回収して重複投稿しない", async () => {
    await using db = await createMigratedTestDatabase();
    await db.actions.upsertRiotAccount({
      discordId: "user",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await db.actions.upsertMatchWatcher({
      guildId: "guild",
      targetDiscordId: "user",
      requesterId: "user",
      channelId: "channel",
    });
    let time = 1800000000000;
    using _clock = stub(Date, "now", () => time);
    const messages: WatcherMessage[] = [];
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () =>
            Promise.resolve({
              send: ({ embeds }) => {
                const message = {
                  id: "message",
                  nonce: null,
                  embeds: embeds.map((embed) => embed.toJSON()),
                  author: { id: "bot" },
                  client: { user: { id: "bot" } },
                  createdTimestamp: time,
                };
                messages.push(message);
                return Promise.resolve(message);
              },
              history: () => Promise.resolve(messages),
            }),
        },
      },
    });
    const databaseStore = store(db);
    const first = createDurableMatchTrackingNotifier({
      store: {
        ...databaseStore,
        completeNotificationDelivery: () =>
          Promise.resolve({ success: false, error: "database unavailable" }),
      },
      notifier,
      logger,
    });
    await assertRejects(() =>
      first.sendOrEditWatcherMessage(
        watcher,
        null,
        new EmbedBuilder().setTitle("ARAM結果"),
        "result:JP1_123",
      )
    );
    assertEquals(messages.length, 1);
    time += 120000;
    const restarted = createDurableMatchTrackingNotifier({
      store: databaseStore,
      notifier,
      logger,
    });
    await restarted.resumePending();
    const result = await restarted.sendOrEditWatcherMessage(
      watcher,
      null,
      new EmbedBuilder().setTitle("ARAM結果"),
      "result:JP1_123",
    );
    assertEquals(result, { status: "sent", messageId: "message" });
    assertEquals(messages.length, 1);
    assertEquals(await db.actions.getPendingNotificationDeliveries(), []);
  });

  test("intent保存が失敗した場合、Discordへの投稿は始めない", async () => {
    await using db = await createMigratedTestDatabase();
    await db.actions.upsertRiotAccount({
      discordId: "user",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await db.actions.upsertMatchWatcher({
      guildId: "guild",
      targetDiscordId: "user",
      requesterId: "user",
      channelId: "channel",
    });
    let sends = 0;
    const durable = createDurableMatchTrackingNotifier({
      store: {
        ...store(db),
        prepareNotificationDelivery: () =>
          Promise.resolve({ success: false, error: "DB failed" }),
      },
      notifier: {
        sendOrEditWatcherMessage: () => {
          sends++;
          return Promise.resolve({ status: "sent", messageId: "message" });
        },
      },
      logger,
    });
    await assertRejects(() =>
      durable.sendOrEditWatcherMessage(
        watcher,
        null,
        new EmbedBuilder(),
        "result:JP1_123",
      )
    );
    assertEquals(sends, 0);
  });

  test("一時的なチャンネル取得失敗の後、backoff経過前は送らず再起動後に配送する", async () => {
    await using db = await createMigratedTestDatabase();
    await db.actions.upsertRiotAccount({
      discordId: "user",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await db.actions.upsertMatchWatcher({
      guildId: "guild",
      targetDiscordId: "user",
      requesterId: "user",
      channelId: "channel",
    });
    let time = 1800000000000;
    using _clock = stub(Date, "now", () => time);
    let unavailable = true;
    let sends = 0;
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () =>
            unavailable
              ? Promise.reject(new Error("network"))
              : Promise.resolve({
                send: () => {
                  sends++;
                  return Promise.resolve({ id: "message" });
                },
              }),
        },
      },
    });
    const create = () =>
      createDurableMatchTrackingNotifier({
        store: store(db),
        notifier,
        logger,
      });
    assertEquals(
      (await create().sendOrEditWatcherMessage(
        watcher,
        null,
        new EmbedBuilder(),
        "started:JP1:123",
      )).status,
      "retryable_failure",
    );
    unavailable = false;
    await create().resumePending();
    assertEquals(sends, 0);
    time += 30000;
    await create().resumePending();
    assertEquals(sends, 1);
  });
});

test("送信応答不明の後にチャンネル取得も失敗した場合、再試行しても不確定状態を忘れず同じ投稿を回収する", async () => {
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "user",
    puuid: "puuid-1",
    gameName: "Player",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  await db.actions.upsertMatchWatcher({
    guildId: "guild",
    targetDiscordId: "user",
    requesterId: "user",
    channelId: "channel",
  });
  let time = 1800000000000;
  using _clock = stub(Date, "now", () => time);
  let channelUnavailable = false;
  let sends = 0;
  const messages: WatcherMessage[] = [];
  const notifier = createMatchTrackingNotifier({
    logger,
    client: {
      channels: {
        fetch: () => {
          if (channelUnavailable) {
            return Promise.reject(new Error("channel network failed"));
          }
          return Promise.resolve({
            send: ({ embeds }) => {
              sends++;
              messages.push({
                id: `message-${sends}`,
                nonce: null,
                embeds: embeds.map((embed) => embed.toJSON()),
                author: { id: "bot" },
                client: { user: { id: "bot" } },
                createdTimestamp: time,
              });
              return Promise.reject(new Error("send response lost"));
            },
            history: () => Promise.resolve(messages),
          });
        },
      },
    },
  });
  const durable = createDurableMatchTrackingNotifier({
    store: store(db),
    notifier,
    logger,
  });
  assertEquals(
    (await durable.sendOrEditWatcherMessage(
      watcher,
      null,
      new EmbedBuilder(),
      "result:JP1_456",
    )).status,
    "retryable_failure",
  );
  channelUnavailable = true;
  time += 30000;
  await durable.resumePending();
  channelUnavailable = false;
  time += 60000;
  await durable.resumePending();
  assertEquals(sends, 1);
  assertEquals(await db.actions.getPendingNotificationDeliveries(), []);
});
