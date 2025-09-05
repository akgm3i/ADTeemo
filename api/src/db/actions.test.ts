import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { db } from "./index.ts";
import { users, customGameEvents } from "./schema.ts";
import { dbActions } from "./actions.ts";
import { eq } from "npm:drizzle-orm";
import { restore } from "jsr:@std/testing/mock";

describe("db actions", () => {
  afterEach(() => {
    restore();
  });

  describe("getCustomGameEventsByCreatorId", () => {
    it("should return only the events created by the specified user", async () => {
      // Setup: create two users and three events
      await dbActions.upsertUser("test-creator-1");
      await dbActions.upsertUser("test-creator-2");
      const event1 = {
        name: "Event 1",
        guildId: "test-guild",
        creatorId: "test-creator-1",
        discordScheduledEventId: "event-1",
        recruitmentMessageId: "msg-1",
      };
      const event2 = {
        name: "Event 2",
        guildId: "test-guild",
        creatorId: "test-creator-2",
        discordScheduledEventId: "event-2",
        recruitmentMessageId: "msg-2",
      };
      const event3 = {
        name: "Event 3",
        guildId: "test-guild",
        creatorId: "test-creator-1",
        discordScheduledEventId: "event-3",
        recruitmentMessageId: "msg-3",
      };
      await dbActions.createCustomGameEvent(event1);
      await dbActions.createCustomGameEvent(event2);
      await dbActions.createCustomGameEvent(event3);

      const results = await dbActions.getCustomGameEventsByCreatorId(
        "test-creator-1",
      );

      assertEquals(results.length, 2);
      assertEquals(results[0].name, "Event 1");
      assertEquals(results[1].name, "Event 3");

      // Cleanup
      await db.delete(customGameEvents);
      await db.delete(users);
    });
  });

  describe("deleteCustomGameEventByDiscordEventId", () => {
    it("should delete the correct event", async () => {
      // Setup
      await dbActions.upsertUser("test-creator");
      const event1 = {
        name: "Event 1",
        guildId: "test-guild",
        creatorId: "test-creator",
        discordScheduledEventId: "event-to-delete",
        recruitmentMessageId: "msg-1",
      };
      const event2 = {
        name: "Event 2",
        guildId: "test-guild",
        creatorId: "test-creator",
        discordScheduledEventId: "event-to-keep",
        recruitmentMessageId: "msg-2",
      };
      await dbActions.createCustomGameEvent(event1);
      await dbActions.createCustomGameEvent(event2);

      await dbActions.deleteCustomGameEventByDiscordEventId("event-to-delete");

      const results = await db.query.customGameEvents.findMany();
      assertEquals(results.length, 1);
      assertEquals(results[0].name, "Event 2");

      // Cleanup
      await db.delete(customGameEvents);
      await db.delete(users);
    });
  });

  describe("createCustomGameEvent", () => {
    it("should create a new custom game event and the user if they do not exist", async () => {
      const eventData = {
        name: "Test Event",
        guildId: "test-guild",
        creatorId: "test-creator-123",
        discordScheduledEventId: "test-discord-event-id-123",
        recruitmentMessageId: "test-recruitment-message-id-123",
      };

      await dbActions.createCustomGameEvent(eventData);

      const result = await db.query.customGameEvents.findFirst({
        where: eq(
          customGameEvents.discordScheduledEventId,
          eventData.discordScheduledEventId,
        ),
      });

      const userResult = await db.query.users.findFirst({
        where: eq(users.discordId, eventData.creatorId),
      });

      assertEquals(result?.name, eventData.name);
      assertEquals(result?.guildId, eventData.guildId);
      assertEquals(result?.creatorId, eventData.creatorId);
      assertEquals(
        result?.recruitmentMessageId,
        eventData.recruitmentMessageId,
      );
      assertEquals(userResult?.discordId, eventData.creatorId);

      // Cleanup
      if (result) {
        await db.delete(customGameEvents).where(eq(customGameEvents.id, result.id));
      }
      if (userResult) {
        await db.delete(users).where(eq(users.discordId, userResult.discordId));
      }
    });
  });
});
