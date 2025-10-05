import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { z } from "zod";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";

describe("routes/events.ts", () => {
  const client = testClient(app);
  const FIXED_DATE = "2025-09-27T10:00:00.000Z";

  const eventsResponseSchema = z.object({
    events: z.array(z.object({ name: z.string() })),
  });

  const eventResponseSchema = z.object({
    event: z.object({ name: z.string() }),
  });

  const errorResponseSchema = z.object({
    error: z.string(),
  });

  describe("POST /events", () => {
    describe("正常系", () => {
      test("有効なイベントデータでリクエストを送信するとイベントを作成し、201 Createdと空ボディを返す", async () => {
        // Arrange
        using createEventStub = stub(
          dbActions,
          "createCustomGameEvent",
          () => Promise.resolve(),
        );
        const eventData = {
          name: "Test Event",
          guildId: "test-guild",
          creatorId: "test-creator",
          discordScheduledEventId: "test-discord-event-id",
          recruitmentMessageId: "test-recruitment-message-id",
          scheduledStartAt: FIXED_DATE,
        };

        // Act
        const res = await client.events.$post({ json: eventData });

        // Assert
        assert(res.status === 201);
        assertEquals(await res.text(), "");
        assertSpyCall(createEventStub, 0, {
          args: [{
            ...eventData,
            scheduledStartAt: new Date(FIXED_DATE),
          }],
        });
      });
    });

    describe("異常系", () => {
      test("無効なイベントデータ（必須項目不足）でリクエストを送信したとき、400エラーを返す", async () => {
        // Arrange
        const invalidData = { name: "Test Event" }; // Missing required fields
        const req = new Request("http://localhost/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(invalidData),
        });

        // Act
        const res = await app.request(req);

        // Assert
        assertEquals(res.status, 400);
      });

      test("DB操作に失敗したとき、500エラーを返す", async () => {
        // Arrange
        using _createEventStub = stub(
          dbActions,
          "createCustomGameEvent",
          () => Promise.reject(new Error("DB error")),
        );
        const eventData = {
          name: "Test Event",
          guildId: "test-guild",
          creatorId: "test-creator",
          discordScheduledEventId: "test-discord-event-id",
          recruitmentMessageId: "test-recruitment-message-id",
          scheduledStartAt: FIXED_DATE,
        };

        // Act
        const res = await client.events.$post({ json: eventData });

        // Assert
        assertEquals(res.status, 500);
      });
    });
  });

  describe("GET /events/by-creator/:creatorId", () => {
    describe("正常系", () => {
      test("存在するクリエイターIDでリクエストを送信したとき、そのクリエイターのイベント一覧を返す", async () => {
        // Arrange
        const mockEvents = [{
          id: 1,
          name: "Test Event",
          guildId: "test-guild",
          creatorId: "test-creator",
          discordScheduledEventId: "event-1",
          recruitmentMessageId: "msg-1",
          scheduledStartAt: new Date(FIXED_DATE),
          createdAt: new Date(FIXED_DATE),
        }];
        using getEventsStub = stub(
          dbActions,
          "getCustomGameEventsByCreatorId",
          () => Promise.resolve(mockEvents),
        );

        // Act
        const res = await client.events["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        // Assert
        assert(res.status === 200);
        const { events } = eventsResponseSchema.parse(await res.json());
        assertEquals(events.length, 1);
        assertEquals(events[0].name, "Test Event");
        assertSpyCall(getEventsStub, 0, { args: ["test-creator"] });
      });
    });

    describe("異常系", () => {
      test("DB操作に失敗したとき、500エラーを返す", async () => {
        // Arrange
        using _getEventsStub = stub(
          dbActions,
          "getCustomGameEventsByCreatorId",
          () => Promise.reject(new Error("DB error")),
        );

        // Act
        const res = await client.events["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        // Assert
        assertEquals(res.status, 500);
      });
    });
  });

  describe("DELETE /events/:discordEventId", () => {
    describe("正常系", () => {
      test("存在するDiscordイベントIDでリクエストを送信したとき、イベントが削除され成功レスポンスを返す", async () => {
        // Arrange
        using deleteEventStub = stub(
          dbActions,
          "deleteCustomGameEventByDiscordEventId",
          () => Promise.resolve(),
        );

        // Act
        const res = await client.events[":discordEventId"].$delete({
          param: { discordEventId: "test-event-id" },
        });

        // Assert
        assert(res.status === 204);
        assertEquals(await res.text(), "");
        assertSpyCall(deleteEventStub, 0, { args: ["test-event-id"] });
      });
    });

    describe("異常系", () => {
      test("DB操作に失敗したとき、500エラーを返す", async () => {
        // Arrange
        using _deleteEventStub = stub(
          dbActions,
          "deleteCustomGameEventByDiscordEventId",
          () => Promise.reject(new Error("DB error")),
        );

        // Act
        const res = await client.events[":discordEventId"].$delete({
          param: { discordEventId: "test-event-id" },
        });

        // Assert
        assertEquals(res.status, 500);
      });
    });
  });

  describe("GET /events/today/by-creator/:creatorId", () => {
    describe("正常系", () => {
      test("指定したクリエイターの今日開始イベントが存在するとき、そのイベントを返す", async () => {
        // Arrange
        const mockEvent = {
          id: 1,
          name: "Test Event Today",
          creatorId: "test-creator",
          guildId: "guild-id",
          discordScheduledEventId: "discord-id",
          recruitmentMessageId: "rec-id",
          scheduledStartAt: new Date(FIXED_DATE),
          createdAt: new Date(FIXED_DATE),
        };
        using getEventStub = stub(
          dbActions,
          "getEventStartingTodayByCreatorId",
          () => Promise.resolve(mockEvent),
        );

        // Act
        const res = await client.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        // Assert
        assert(res.status === 200);
        const { event } = eventResponseSchema.parse(await res.json());
        assertEquals(event.name, "Test Event Today");
        assertSpyCall(getEventStub, 0, { args: ["test-creator"] });
      });
    });

    describe("異常系", () => {
      test("今日開始のイベントがないとき、404エラーを返す", async () => {
        // Arrange
        using getEventStub = stub(
          dbActions,
          "getEventStartingTodayByCreatorId",
          () => Promise.resolve(undefined),
        );

        // Act
        const res = await client.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId: "non-existent" },
        });

        // Assert
        assert(res.status === 404);
        const { error } = errorResponseSchema.parse(await res.json());
        assertEquals(error, "Event not found");
        assertSpyCall(getEventStub, 0, { args: ["non-existent"] });
      });

      test("DB操作に失敗したとき、500エラーを返す", async () => {
        // Arrange
        using _getEventStub = stub(
          dbActions,
          "getEventStartingTodayByCreatorId",
          () => Promise.reject(new Error("DB error")),
        );

        // Act
        const res = await client.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        // Assert
        assertEquals(res.status, 500);
      });
    });
  });
});
