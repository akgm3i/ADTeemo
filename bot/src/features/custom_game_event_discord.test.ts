import {
  type Guild,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Message,
  type MessageManager,
} from "discord.js";
import { Collection } from "discord.js";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  CUSTOM_GAME_EVENT_OPERATION_MARKER_PREFIX,
  customGameEventOperationMarker,
  findCustomGameRecruitmentMessage,
  findOrCreateCustomGameRecruitmentMessage,
  findOrCreateCustomGameScheduledEvent,
} from "./custom_game_event_discord.ts";

const scheduledStartAt = new Date("2026-08-08T12:00:00.000Z");

function guildWithScheduledEvents(events: GuildScheduledEvent[]) {
  const calls: unknown[] = [];
  const collection = new Collection(
    events.map((event) => [event.id, event] as const),
  );
  const guild = {
    scheduledEvents: {
      fetch: () => Promise.resolve(collection),
      create: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({ id: "created-event" } as GuildScheduledEvent);
      },
    },
  } as unknown as Pick<Guild, "scheduledEvents">;
  return { guild, calls };
}

describe("カスタムゲームのDiscordイベント作成", () => {
  test("同じ操作キーのイベントが存在する状況で作成すると、既存イベントを再利用する", async () => {
    const existing = {
      id: "existing-event",
      description: customGameEventOperationMarker("interaction-113"),
    } as GuildScheduledEvent;
    const { guild, calls } = guildWithScheduledEvents([existing]);

    const result = await findOrCreateCustomGameScheduledEvent(guild, {
      operationKey: "interaction-113",
      name: "週末カスタム",
      voiceChannelId: "voice-1",
      scheduledStartAt,
    });

    assertEquals(result, existing);
    assertEquals(calls, []);
  });

  test("同じ操作キーのイベントがない状況で作成すると、descriptionに識別子を付けて作成する", async () => {
    const { guild, calls } = guildWithScheduledEvents([]);

    const result = await findOrCreateCustomGameScheduledEvent(guild, {
      operationKey: "interaction-113",
      name: "週末カスタム",
      voiceChannelId: "voice-1",
      scheduledStartAt,
    });

    assertEquals(result.id, "created-event");
    assertEquals(calls, [{
      name: "週末カスタム",
      description:
        `${CUSTOM_GAME_EVENT_OPERATION_MARKER_PREFIX}interaction-113`,
      scheduledStartTime: scheduledStartAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: "voice-1",
    }]);
  });

  test("同じ操作キーのイベントが複数存在する状況で作成すると、自動選択せずエラーにする", async () => {
    const marker = customGameEventOperationMarker("interaction-113");
    const { guild, calls } = guildWithScheduledEvents([
      { id: "event-1", description: marker } as GuildScheduledEvent,
      { id: "event-2", description: marker } as GuildScheduledEvent,
    ]);

    await assertRejects(
      () =>
        findOrCreateCustomGameScheduledEvent(guild, {
          operationKey: "interaction-113",
          name: "週末カスタム",
          voiceChannelId: "voice-1",
          scheduledStartAt,
        }),
      Error,
      "Multiple Discord scheduled events found",
    );
    assertEquals(calls, []);
  });
});

describe("カスタムゲームの募集メッセージ検索", () => {
  function messageManagerWith(messages: Message[]) {
    const calls: unknown[] = [];
    const page = new Collection(
      messages.map((message) => [message.id, message] as const),
    );
    const manager = {
      fetch: (input: unknown) => {
        calls.push(input);
        return Promise.resolve(page);
      },
    } as unknown as Pick<MessageManager, "fetch">;
    return { manager, calls };
  }

  test("同じ永続識別子のメッセージが存在する状況で検索すると、そのメッセージを返す", async () => {
    const matching = {
      id: "message-1",
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-08-01T00:01:00.000Z"),
    } as Message;
    const { manager, calls } = messageManagerWith([matching]);

    const result = await findCustomGameRecruitmentMessage(manager, {
      operationKey: "interaction-113",
      createdAfter: new Date("2026-08-01T00:00:00.000Z"),
    });

    assertEquals(result, matching);
    assertEquals(calls, [{ limit: 100 }]);
  });

  test("イベント準備より前の同じ永続識別子だけが存在する状況で検索すると、対象外として扱う", async () => {
    const oldMessage = {
      id: "old-message",
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-07-31T23:59:59.000Z"),
    } as Message;
    const { manager } = messageManagerWith([oldMessage]);

    const result = await findCustomGameRecruitmentMessage(manager, {
      operationKey: "interaction-113",
      createdAfter: new Date("2026-08-01T00:00:00.000Z"),
    });

    assertEquals(result, null);
  });

  test("同じ永続識別子のメッセージが複数存在する状況で検索すると、自動選択せずエラーにする", async () => {
    const messages = ["message-1", "message-2"].map((id) => ({
      id,
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-08-01T00:01:00.000Z"),
    } as Message));
    const { manager } = messageManagerWith(messages);

    await assertRejects(
      () =>
        findCustomGameRecruitmentMessage(manager, {
          operationKey: "interaction-113",
          createdAfter: new Date("2026-08-01T00:00:00.000Z"),
        }),
      Error,
      "Multiple Discord recruitment messages found",
    );
  });

  test("募集メッセージを作成する状況では、operation keyをnonceとして強制する", async () => {
    const sent = {
      id: "message-1",
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-08-01T00:01:00.000Z"),
    } as Message;
    const sendCalls: unknown[] = [];
    const { manager } = messageManagerWith([]);
    const channel = {
      messages: manager,
      send: (input: unknown) => {
        sendCalls.push(input);
        return Promise.resolve(sent);
      },
    };

    const result = await findOrCreateCustomGameRecruitmentMessage(channel, {
      operationKey: "interaction-113",
      content: "募集します",
      createdAfter: new Date("2026-08-01T00:00:00.000Z"),
    });

    assertEquals(result, sent);
    assertEquals(sendCalls, [{
      content: "募集します",
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      nonce: "interaction-113",
      enforceNonce: true,
    }]);
  });

  test("同じ永続識別子の募集メッセージが既に存在する状況では、再投稿せず既存メッセージを再利用する", async () => {
    const existing = {
      id: "message-1",
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-08-01T00:01:00.000Z"),
    } as Message;
    const sendCalls: unknown[] = [];
    const { manager } = messageManagerWith([existing]);
    const channel = {
      messages: manager,
      send: (input: unknown) => {
        sendCalls.push(input);
        return Promise.resolve(existing);
      },
    };

    const result = await findOrCreateCustomGameRecruitmentMessage(channel, {
      operationKey: "interaction-113",
      content: "募集します",
      createdAfter: new Date("2026-08-01T00:00:00.000Z"),
    });

    assertEquals(result, existing);
    assertEquals(sendCalls, []);
  });

  test("最初の作成応答が不明な状況では、同じ永続識別子を強制して再送しIDを回収する", async () => {
    const recovered = {
      id: "message-1",
      nonce: null,
      author: { id: "bot" },
      client: { user: { id: "bot" } },
      embeds: [{
        footer: { text: customGameEventOperationMarker("interaction-113") },
      }],
      createdAt: new Date("2026-08-01T00:01:00.000Z"),
    } as Message;
    const sendCalls: unknown[] = [];
    const { manager, calls: fetchCalls } = messageManagerWith([]);
    const channel = {
      messages: manager,
      send: (input: unknown) => {
        sendCalls.push(input);
        return sendCalls.length === 1
          ? Promise.reject(new Error("network timeout"))
          : Promise.resolve(recovered);
      },
    };

    const result = await findOrCreateCustomGameRecruitmentMessage(channel, {
      operationKey: "interaction-113",
      content: "募集します",
      createdAfter: new Date("2026-08-01T00:00:00.000Z"),
    });

    assertEquals(result, recovered);
    assertEquals(sendCalls.length, 2);
    assertEquals(sendCalls[0], sendCalls[1]);
    assertEquals(fetchCalls, [{ limit: 100 }]);
  });
});
