import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { app } from "../app.ts";
import { dbActions } from "../db/actions.ts";
import { assertSpyCall, restore, stub } from "jsr:@std/testing/mock";

describe("events route", () => {
  afterEach(() => {
    restore();
  });

  describe("GET /events/by-creator/:creatorId", () => {
    it("should call getCustomGameEventsByCreatorId and return the events", async () => {
      const mockEvents = [{
        id: 1,
        name: "Test Event",
        guildId: "test-guild",
        creatorId: "test-creator",
        discordScheduledEventId: "event-1",
        recruitmentMessageId: "msg-1",
        createdAt: new Date(),
      }];
      const getEventsStub = stub(
        dbActions,
        "getCustomGameEventsByCreatorId",
        () => Promise.resolve(mockEvents),
      );

      const req = new Request("http://localhost/events/by-creator/test-creator");
      const res = await app.fetch(req);
      const body = await res.json();

      assertEquals(res.status, 200);
      assertEquals(body.success, true);
      assertEquals(body.events.length, 1);
      assertEquals(body.events[0].name, "Test Event");
      assertSpyCall(getEventsStub, 0, { args: ["test-creator"] });
    });
  });

  describe("DELETE /events/:discordEventId", () => {
    it("should call deleteCustomGameEventByDiscordEventId and return success", async () => {
      const deleteEventStub = stub(
        dbActions,
        "deleteCustomGameEventByDiscordEventId",
        () => Promise.resolve(),
      );

      const req = new Request("http://localhost/events/test-event-id", {
        method: "DELETE",
      });
      const res = await app.fetch(req);
      const body = await res.json();

      assertEquals(res.status, 200);
      assertEquals(body.success, true);
      assertSpyCall(deleteEventStub, 0, { args: ["test-event-id"] });
    });
  });

  describe("POST /events", () => {
    it("should call createCustomGameEvent and return success", async () => {
      const createEventStub = stub(
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

      const req = new Request("http://localhost/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      const res = await app.fetch(req);
      const body = await res.json();

      assertEquals(res.status, 200);
      assertEquals(body.success, true);
      assertSpyCall(createEventStub, 0, { args: [eventData] });
    });

    it("should return an error if the request body is invalid", async () => {
      const eventData = {
        name: "Test Event",
        // Missing other required fields
      };

      const req = new Request("http://localhost/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 400); // Zod validation should fail
    });
  });
});
