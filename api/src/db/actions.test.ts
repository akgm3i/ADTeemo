import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { db } from "./index.ts";
import { customGameEvents, users } from "./schema.ts";
import { dbActions } from "./actions.ts";
import { eq } from "drizzle-orm";
import { restore } from "@std/testing/mock";

describe("DB actions", () => {
  afterEach(async () => {
    await db.delete(customGameEvents);
    await db.delete(users);
    restore();
  });

  describe("getCustomGameEventsByCreatorId", () => {
    it("指定したクリエイターが作成したイベントのみを返す", async () => {
      // Setup: 2人のユーザーと3つのイベントを作成
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
    });
  });

  describe("deleteCustomGameEventByDiscordEventId", () => {
    it("指定したDiscordイベントIDを持つイベントを削除する", async () => {
      // Set up
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
    });
  });

  describe("createCustomGameEvent", () => {
    it("新しいカスタムゲームイベントを作成し、クリエイターが存在しない場合はユーザーも作成する", async () => {
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
    });
  });

  describe("getTodaysCustomGameEventByCreatorId", () => {
    const creatorId = "today-creator";
    const otherCreatorId = "other-creator";

    beforeEach(async () => {
      await dbActions.upsertUser(creatorId);
      await dbActions.upsertUser(otherCreatorId);

      // Event created today by the target creator
      await db.insert(customGameEvents).values({
        name: "Event Today",
        guildId: "test-guild",
        creatorId: creatorId,
        discordScheduledEventId: "event-today",
        recruitmentMessageId: "msg-today",
        createdAt: new Date(),
      });

      // Event created yesterday by the target creator
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await db.insert(customGameEvents).values({
        name: "Event Yesterday",
        guildId: "test-guild",
        creatorId: creatorId,
        discordScheduledEventId: "event-yesterday",
        recruitmentMessageId: "msg-yesterday",
        createdAt: yesterday,
      });

      // Event created today by another creator
      await db.insert(customGameEvents).values({
        name: "Event Today Other Creator",
        guildId: "test-guild",
        creatorId: otherCreatorId,
        discordScheduledEventId: "event-today-other",
        recruitmentMessageId: "msg-today-other",
        createdAt: new Date(),
      });
    });

    it("指定したクリエイターが今日作成したイベントを返す", async () => {
      const result = await dbActions.getTodaysCustomGameEventByCreatorId(
        creatorId,
      );
      assertExists(result);
      assertEquals(result.name, "Event Today");
    });

    it("指定したクリエイターが今日作成したイベントがない場合はnullを返す", async () => {
      // Delete the event for 'today-creator'
      await db
        .delete(customGameEvents)
        .where(eq(customGameEvents.discordScheduledEventId, "event-today"));
      const result = await dbActions.getTodaysCustomGameEventByCreatorId(
        creatorId,
      );
      assertEquals(result, undefined);
    });
  });
});
