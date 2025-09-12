import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";

describe("Routes: Guild Scheduled Event", () => {
  const client = testClient(app);

  describe("POST /events", () => {
    it("有効なイベントデータでPOSTリクエストを送信すると、成功レスポンスが返される", async () => {
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
      };

      const res = await client.events.$post(
        {
          json: eventData,
        },
      );

      assert(res.ok);

      const body = await res.json();

      assertEquals(body.success, true);
      assertSpyCall(createEventStub, 0, { args: [eventData] });
    });

    it("無効なイベントデータでPOSTリクエストを送信すると、400エラーが返される", async () => {
      const eventData = {
        name: "Test Event",
        // Missing other required fields
      };

      const req = new Request("http://localhost/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      const res = await app.request(req);
      assertEquals(res.status, 400); // Zod validation should fail
    });
  });

  describe("GET /events/by-creator/:creatorId", () => {
    it("クリエイターIDを指定してGETリクエストを送信すると、関連するイベントが返される", async () => {
      const mockEvents = [{
        id: 1,
        name: "Test Event",
        guildId: "test-guild",
        creatorId: "test-creator",
        discordScheduledEventId: "event-1",
        recruitmentMessageId: "msg-1",
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
      assertEquals(body.events.length, 1);
      assertEquals(body.events[0].name, "Test Event");
      assertSpyCall(getEventsStub, 0, { args: ["test-creator"] });
    });
  });

  describe("DELETE /events/:discordEventId", () => {
    it("DiscordイベントIDを指定してDELETEリクエストを送信すると、成功レスポンスが返される", async () => {
      using deleteEventStub = stub(
        dbActions,
        "deleteCustomGameEventByDiscordEventId",
        () => Promise.resolve(),
      );

      const res = await client.events[":discordEventId"].$delete(
        { param: { discordEventId: "test-event-id" } },
      );

      assert(res.ok);

      const body = await res.json();

      assertEquals(body.success, true);
      assertSpyCall(deleteEventStub, 0, { args: ["test-event-id"] });
    });
  });

  describe("GET /events/today/by-creator/:creatorId", () => {
    it("クリエイターIDを指定してGETリクエストを送信すると、今日作成されたイベントが返される", async () => {
      const mockEvent = {
        id: 1,
        name: "Today's Event",
        creatorId: "test-creator",
        createdAt: new Date(),
        guildId: "guild-id",
        discordScheduledEventId: "discord-id",
        recruitmentMessageId: "rec-id",
      };
      using getEventStub = stub(
        dbActions,
        "getTodaysCustomGameEventByCreatorId",
        () => Promise.resolve(mockEvent),
      );

      const res = await client.events.today["by-creator"][":creatorId"].$get({
        param: { creatorId: "test-creator" },
      });

      assert(res.ok);
      const body = await res.json();
      assertEquals(body.success, true);
      assertEquals(body.event.name, "Today's Event");
      assertSpyCall(getEventStub, 0, { args: ["test-creator"] });
    });

    it("今日作成されたイベントがない場合、404エラーが返される", async () => {
      using getEventStub = stub(
        dbActions,
        "getTodaysCustomGameEventByCreatorId",
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
