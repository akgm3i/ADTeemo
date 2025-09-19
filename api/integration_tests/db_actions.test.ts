import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { db } from "../src/db/index.ts";
import { customGameEvents, users } from "../src/db/schema.ts";
import { dbActions } from "../src/db/actions.ts";
import { eq } from "drizzle-orm";

describe("db/actions.ts", () => {
  // 全てのテストの後にDBをクリーンアップする
  afterEach(async () => {
    await db.delete(customGameEvents);
    await db.delete(users);
  });

  describe("dbActions.getCustomGameEventsByCreatorId()", () => {
    describe("正常系", () => {
      it("対象のcreatorIdを持つイベントが複数存在するとき、それら全てのイベントを返す", async () => {
        // Setup
        await dbActions.upsertUser("test-creator-1");
        await dbActions.upsertUser("test-creator-2");
        const events = [
          {
            name: "Event 1",
            creatorId: "test-creator-1",
            discordScheduledEventId: "event-1",
          },
          {
            name: "Event 2",
            creatorId: "test-creator-2",
            discordScheduledEventId: "event-2",
          },
          {
            name: "Event 3",
            creatorId: "test-creator-1",
            discordScheduledEventId: "event-3",
          },
        ];
        for (const event of events) {
          await dbActions.createCustomGameEvent({
            ...event,
            guildId: "test-guild",
            recruitmentMessageId: `msg-${event.discordScheduledEventId}`,
            scheduledStartAt: new Date(),
          });
        }

        // Act
        const results = await dbActions.getCustomGameEventsByCreatorId(
          "test-creator-1",
        );

        // Assert
        assertEquals(results.length, 2);
        assertEquals(results[0].name, "Event 1");
        assertEquals(results[1].name, "Event 3");
      });
    });
  });

  describe("dbActions.deleteCustomGameEventByDiscordEventId()", () => {
    describe("正常系", () => {
      it("存在するDiscordイベントIDを指定したとき、対象のイベントを削除する", async () => {
        // Setup
        await dbActions.upsertUser("test-creator");
        const event1 = {
          name: "Event 1",
          discordScheduledEventId: "event-to-delete",
        };
        const event2 = {
          name: "Event 2",
          discordScheduledEventId: "event-to-keep",
        };
        for (const event of [event1, event2]) {
          await dbActions.createCustomGameEvent({
            ...event,
            guildId: "test-guild",
            creatorId: "test-creator",
            recruitmentMessageId: "msg-1",
            scheduledStartAt: new Date(),
          });
        }

        // Act
        await dbActions.deleteCustomGameEventByDiscordEventId(
          "event-to-delete",
        );

        // Assert
        const results = await db.query.customGameEvents.findMany();
        assertEquals(results.length, 1);
        assertEquals(results[0].name, "Event 2");
      });
    });
  });

  describe("dbActions.createCustomGameEvent()", () => {
    describe("正常系", () => {
      it("クリエイターが存在しないとき、新しいイベントと同時にユーザーも作成する", async () => {
        // Setup
        const eventData = {
          name: "Test Event",
          guildId: "test-guild",
          creatorId: "new-creator-123",
          discordScheduledEventId: "discord-event-123",
          recruitmentMessageId: "rec-msg-123",
          scheduledStartAt: new Date(),
        };

        // Act
        await dbActions.createCustomGameEvent(eventData);

        // Assert
        const eventResult = await db.query.customGameEvents.findFirst({
          where: eq(
            customGameEvents.discordScheduledEventId,
            eventData.discordScheduledEventId,
          ),
        });
        const userResult = await db.query.users.findFirst({
          where: eq(users.discordId, eventData.creatorId),
        });

        assertExists(eventResult);
        assertEquals(eventResult.name, eventData.name);
        assertExists(userResult);
        assertEquals(userResult.discordId, eventData.creatorId);
      });
    });
  });

  describe("dbActions.getEventStartingTodayByCreatorId()", () => {
    const creatorId = "today-creator";
    const otherCreatorId = "other-creator";

    // Setup common data
    beforeEach(async () => {
      await dbActions.upsertUser(creatorId);
      await dbActions.upsertUser(otherCreatorId);

      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      await db.insert(customGameEvents).values([
        {
          name: "Event Today",
          creatorId: creatorId,
          discordScheduledEventId: "event-today",
          guildId: "test-guild",
          recruitmentMessageId: "msg-today",
          scheduledStartAt: today,
        },
        {
          name: "Event Tomorrow",
          creatorId: creatorId,
          discordScheduledEventId: "event-tomorrow",
          guildId: "test-guild",
          recruitmentMessageId: "msg-tomorrow",
          scheduledStartAt: tomorrow,
        },
        {
          name: "Event Today Other Creator",
          creatorId: otherCreatorId,
          discordScheduledEventId: "event-today-other",
          guildId: "test-guild",
          recruitmentMessageId: "msg-today-other",
          scheduledStartAt: today,
        },
      ]);
    });

    describe("正常系", () => {
      it("指定したクリエイターが今日開始するイベントが存在するとき、そのイベントを返す", async () => {
        // Act
        const result = await dbActions.getEventStartingTodayByCreatorId(
          creatorId,
        );

        // Assert
        assertExists(result);
        assertEquals(result.name, "Event Today");
      });
    });

    describe("異常系", () => {
      it("指定したクリエイターが今日開始するイベントがないとき、undefinedを返す", async () => {
        // Act
        const result = await dbActions.getEventStartingTodayByCreatorId(
          "non-existent-creator",
        );
        // Assert
        assertEquals(result, undefined);
      });
    });
  });
});
