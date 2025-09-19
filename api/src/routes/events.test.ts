import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";

describe("routes/events.ts", () => {
  const client = testClient(app);

  describe("POST /events", () => {
    describe("正常系", () => {
      it("有効なイベントデータでリクエストを送信したとき、イベントが作成され成功レスポンスを返す", async () => {
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
          scheduledStartAt: new Date().toISOString(),
        };

        const res = await client.events.$post({ json: eventData });

        assert(res.ok);
        const body = await res.json();

        assertEquals(body.success, true);
        assertSpyCall(createEventStub, 0, {
          args: [{
            ...eventData,
            scheduledStartAt: new Date(eventData.scheduledStartAt),
          }],
        });
      });
    });

    describe("異常系", () => {
      it("無効なイベントデータ（必須項目不足）でリクエストを送信したとき、400エラーを返す", async () => {
        const invalidData = { name: "Test Event" }; // Missing required fields
        const req = new Request("http://localhost/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(invalidData),
        });

        const res = await app.request(req);
        assertEquals(res.status, 400);
      });
    });
  });

  describe("GET /events/by-creator/:creatorId", () => {
    describe("正常系", () => {
      it("存在するクリエイターIDでリクエストを送信したとき、そのクリエイターのイベント一覧を返す", async () => {
        const mockEvents = [{
          id: 1,
          name: "Test Event",
          guildId: "test-guild",
          creatorId: "test-creator",
          discordScheduledEventId: "event-1",
          recruitmentMessageId: "msg-1",
          scheduledStartAt: new Date(),
          createdAt: new Date(),
        }];
        using getEventsStub = stub(
          dbActions,
          "getCustomGameEventsByCreatorId",
          () => Promise.resolve(mockEvents),
        );

        const res = await client.events["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        assert(res.ok);
        const body = await res.json();

        assertEquals(body.success, true);
        assertEquals(body.events?.length, 1);
        assertEquals(body.events?.[0].name, "Test Event");
        assertSpyCall(getEventsStub, 0, { args: ["test-creator"] });
      });
    });
  });

  describe("DELETE /events/:discordEventId", () => {
    describe("正常系", () => {
      it("存在するDiscordイベントIDでリクエストを送信したとき、イベントが削除され成功レスポンスを返す", async () => {
        using deleteEventStub = stub(
          dbActions,
          "deleteCustomGameEventByDiscordEventId",
          () => Promise.resolve(),
        );

        const res = await client.events[":discordEventId"].$delete({
          param: { discordEventId: "test-event-id" },
        });

        assert(res.ok);
        const body = await res.json();

        assertEquals(body.success, true);
        assertSpyCall(deleteEventStub, 0, { args: ["test-event-id"] });
      });
    });
  });

  describe("GET /events/today/by-creator/:creatorId", () => {
    describe("正常系", () => {
      it("指定したクリエイターの今日開始イベントが存在するとき、そのイベントを返す", async () => {
        const mockEvent = {
          id: 1,
          name: "Test Event Today",
          creatorId: "test-creator",
          guildId: "guild-id",
          discordScheduledEventId: "discord-id",
          recruitmentMessageId: "rec-id",
          scheduledStartAt: new Date(),
          createdAt: new Date(),
        };
        using getEventStub = stub(
          dbActions,
          "getEventStartingTodayByCreatorId",
          () => Promise.resolve(mockEvent),
        );

        const res = await client.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId: "test-creator" },
        });

        assert(res.ok);
        const body = await res.json();

        assertEquals(body.success, true);
        assertEquals(body.event?.name, "Test Event Today");
        assertSpyCall(getEventStub, 0, { args: ["test-creator"] });
      });
    });

    describe("異常系", () => {
      it("今日開始のイベントがないとき、404エラーを返す", async () => {
        using getEventStub = stub(
          dbActions,
          "getEventStartingTodayByCreatorId",
          () => Promise.resolve(undefined),
        );

        const res = await client.events.today["by-creator"][":creatorId"].$get({
          param: { creatorId: "non-existent" },
        });

        assertEquals(res.status, 404);
        const body = await res.json();

        assertEquals(body.success, false);
        assertSpyCall(getEventStub, 0, { args: ["non-existent"] });
      });
    });
  });
});
