import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { EmbedBuilder } from "discord.js";
import type { MatchWatcher } from "@adteemo/api/contract";
import { createMatchTrackingNotifier } from "./match_tracking_notifier.ts";

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

function logger() {
  return {
    warn: (_message: string, _metadata?: Record<string, unknown>) => {},
    error: (
      _message: string,
      _metadata?: Record<string, unknown>,
      _error?: unknown,
    ) => {},
  };
}

describe("match_tracking_notifier.ts", () => {
  test("既存Discord投稿のeditに失敗するとき、新規sendへfallbackして送信後IDを返す", async () => {
    const message = {
      id: "message-old",
      edit: () => Promise.reject(new Error("missing access")),
    };
    const channel = {
      send: (_options: { embeds: EmbedBuilder[] }) =>
        Promise.resolve({ id: "message-new" }),
      messages: {
        fetch: (_messageId: string) => Promise.resolve(message),
      },
    };
    const client = {
      channels: {
        fetch: (_channelId: string) => Promise.resolve(channel),
      },
    };
    const log = logger();
    const warnSpy = spy(log, "warn");
    const editSpy = spy(message, "edit");
    const sendSpy = spy(channel, "send");
    const notifier = createMatchTrackingNotifier({
      client,
      logger: log,
    });

    const result = await notifier.sendOrEditWatcherMessage(
      watcher(),
      "message-old",
      new EmbedBuilder().setTitle("test"),
    );

    assertEquals(result, "message-new");
    assertSpyCalls(editSpy, 1);
    assertSpyCalls(sendSpy, 1);
    assertSpyCall(warnSpy, 0, {
      args: [
        "match_tracking.edit_message_failed",
        {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-old",
          error: "missing access",
        },
      ],
    });
  });

  test("既存Discord投稿にeditメソッドがないとき、新規sendへfallbackして送信後IDを返す", async () => {
    const message = {
      id: "message-old",
    };
    const channel = {
      send: (_options: { embeds: EmbedBuilder[] }) =>
        Promise.resolve({ id: "message-new" }),
      messages: {
        fetch: (_messageId: string) => Promise.resolve(message),
      },
    };
    const client = {
      channels: {
        fetch: (_channelId: string) => Promise.resolve(channel),
      },
    };
    const log = logger();
    const warnSpy = spy(log, "warn");
    const sendSpy = spy(channel, "send");
    const notifier = createMatchTrackingNotifier({
      client,
      logger: log,
    });

    const result = await notifier.sendOrEditWatcherMessage(
      watcher(),
      "message-old",
      new EmbedBuilder().setTitle("test"),
    );

    assertEquals(result, "message-new");
    assertSpyCalls(sendSpy, 1);
    assertSpyCall(warnSpy, 0, {
      args: [
        "match_tracking.edit_message_failed",
        {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-old",
          error: "message.edit is not available",
        },
      ],
    });
  });

  test("Discordチャンネルが見つからないとき、状態更新をせず既存messageIdを返す", async () => {
    const client = {
      channels: {
        fetch: (_channelId: string) => Promise.resolve(null),
      },
    };
    const log = logger();
    const warnSpy = spy(log, "warn");
    const notifier = createMatchTrackingNotifier({
      client,
      logger: log,
    });

    const result = await notifier.sendOrEditWatcherMessage(
      watcher(),
      "message-old",
      new EmbedBuilder().setTitle("test"),
    );

    assertEquals(result, "message-old");
    assertSpyCalls(warnSpy, 1);
  });
});
