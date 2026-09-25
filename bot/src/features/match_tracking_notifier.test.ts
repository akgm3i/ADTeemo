import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { EmbedBuilder } from "discord.js";
import { createMatchTrackingNotifier } from "./match_tracking_notifier.ts";

const target = { guildId: "guild", channelId: "channel" };
const embed = new EmbedBuilder().setTitle("result");
const logger = { warn() {}, error() {} };

describe("match tracking Discord配送", () => {
  test("既存投稿のeditが一時失敗した場合、配送を再試行可能として返し新規投稿しない", async () => {
    let sends = 0;
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () =>
            Promise.resolve({
              send: () => {
                sends++;
                return Promise.resolve({ id: "new" });
              },
              messages: {
                fetch: () =>
                  Promise.resolve({
                    id: "old",
                    edit: () => Promise.reject(new Error("network")),
                  }),
              },
            }),
        },
      },
    });
    const result = await notifier.sendOrEditWatcherMessage(
      target,
      "old",
      embed,
    );
    assertEquals(result.status, "retryable_failure");
    assertEquals(sends, 0);
  });

  test("既存投稿の消失が確認できた場合、配送すると新規投稿のIDを返す", async () => {
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () =>
            Promise.resolve({
              send: () => Promise.resolve({ id: "new" }),
              messages: { fetch: () => Promise.reject({ code: 10008 }) },
            }),
        },
      },
    });
    assertEquals(
      await notifier.sendOrEditWatcherMessage(target, "old", embed),
      { status: "sent", messageId: "new" },
    );
  });

  test("チャンネル取得が失敗した場合、配送すると既存IDを成功として返さない", async () => {
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () => Promise.reject(new Error("network")),
        },
      },
    });
    assertEquals(
      await notifier.sendOrEditWatcherMessage(target, "old", embed),
      { status: "retryable_failure", reason: "channel_fetch" },
    );
  });

  test("チャンネルが存在しない場合、配送すると恒久失敗を返す", async () => {
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () => Promise.resolve(null),
        },
      },
    });
    assertEquals(
      await notifier.sendOrEditWatcherMessage(target, "old", embed),
      { status: "permanent_failure", reason: "channel_missing" },
    );
  });

  test("sendが権限不足の場合、配送すると恒久失敗を返す", async () => {
    const notifier = createMatchTrackingNotifier({
      logger,
      client: {
        channels: {
          fetch: () =>
            Promise.resolve({ send: () => Promise.reject({ code: 50013 }) }),
        },
      },
    });
    assertEquals(await notifier.sendOrEditWatcherMessage(target, null, embed), {
      status: "permanent_failure",
      reason: "send",
    });
  });
});

test("履歴が複数ページありnonceがnullの場合、他人の識別子コピーを除外してBot自身の投稿を回収する", async () => {
  // Arrange
  const marker = "ADTeemo delivery:receipt-key";
  const message = (id: string, author: string, footer: string) => ({
    id,
    author: { id: author },
    client: { user: { id: "bot" } },
    nonce: null,
    embeds: [{ footer: { text: footer } }],
    createdTimestamp: 2000,
  });
  let pages = 0;
  let sends = 0;
  const notifier = createMatchTrackingNotifier({
    logger,
    client: {
      channels: {
        fetch: () =>
          Promise.resolve({
            send: () => {
              sends++;
              return Promise.resolve({ id: "unexpected" });
            },
            history: ({ before }) => {
              pages++;
              if (!before) {
                return Promise.resolve(Array.from({ length: 100 }, (_, index) =>
                  message(`new-${index}`, "other", marker)));
              }
              assertEquals(before, "new-99");
              return Promise.resolve([
                message("recovered", "bot", `Teemo#JP1\n${marker}`),
              ]);
            },
          }),
      },
    },
  });
  // Act
  const result = await notifier.sendOrEditWatcherMessage(target, null, embed, {
    nonce: "receipt-key",
    createdAt: 1000,
    uncertain: true,
  });
  // Assert
  assertEquals(result, { status: "sent", messageId: "recovered" });
  assertEquals(pages, 2);
  assertEquals(sends, 0);
});

test("同じ永続識別子のBot投稿が複数ある場合、自動選択や再投稿をせず照合失敗を返す", async () => {
  // Arrange
  let sends = 0;
  const notifier = createMatchTrackingNotifier({
    logger,
    client: {
      channels: {
        fetch: () =>
          Promise.resolve({
            send: () => {
              sends++;
              return Promise.resolve({ id: "unexpected" });
            },
            history: () =>
              Promise.resolve(["one", "two"].map((id) => ({
                id,
                author: { id: "bot" },
                client: { user: { id: "bot" } },
                nonce: null,
                embeds: [{ footer: { text: "ADTeemo delivery:receipt-key" } }],
              }))),
          }),
      },
    },
  });
  // Act
  const result = await notifier.sendOrEditWatcherMessage(target, null, embed, {
    nonce: "receipt-key",
    createdAt: 1000,
    uncertain: true,
  });
  // Assert
  assertEquals(result, {
    status: "retryable_failure",
    reason: "reconciliation",
  });
  assertEquals(sends, 0);
});
