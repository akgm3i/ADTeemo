import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { db } from "../src/db/index.ts";
import {
  customGameEvents,
  matches,
  matchParticipants,
  users,
} from "../src/db/schema.ts";
import { dbActions } from "../src/db/actions.ts";
import { eq } from "drizzle-orm";
import { RecordNotFoundError } from "../src/errors.ts";

describe("db/actions.ts", () => {
  // 全てのテストの後にDBをクリーンアップする
  afterEach(async () => {
    await db.delete(matchParticipants);
    await db.delete(customGameEvents);
    await db.delete(matches);
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
        assertExists(results.find((event) => event.name === "Event 1"));
        assertExists(results.find((event) => event.name === "Event 3"));
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

  describe("dbActions.setMainRole()", () => {
    describe("正常系", () => {
      it("ユーザーが存在しないとき、新しいユーザーを作成してロールを設定する", async () => {
        // Act
        await dbActions.setMainRole("new-user-id", "Jungle");

        // Assert
        const user = await db.query.users.findFirst({
          where: eq(users.discordId, "new-user-id"),
        });
        assertExists(user);
        assertEquals(user.mainRole, "Jungle");
      });

      it("ユーザーが既に存在するとき、そのユーザーのロールを更新する", async () => {
        // Setup
        await db.insert(users).values({
          discordId: "existing-user",
          mainRole: "Top",
        });

        // Act
        await dbActions.setMainRole("existing-user", "Support");

        // Assert
        const user = await db.query.users.findFirst({
          where: eq(users.discordId, "existing-user"),
        });
        assertExists(user);
        assertEquals(user.mainRole, "Support");
      });
    });
  });

  describe("dbActions.createMatchParticipant()", () => {
    const baseParticipantData = {
      team: "RED" as const,
      win: false,
      lane: "Support" as const,
      kills: 5,
      deaths: 10,
      assists: 15,
      cs: 150,
      gold: 12000,
    };

    describe("正常系", () => {
      it("存在するユーザーと試合IDに対して、参加者情報を正しく記録する", async () => {
        // Setup
        await db.insert(users).values({ discordId: "participant-user" });
        await db.insert(matches).values({ id: "test-match" });

        const participantData = {
          ...baseParticipantData,
          matchId: "test-match",
          userId: "participant-user",
        };

        // Act
        const result = await dbActions.createMatchParticipant(participantData);

        // Assert
        assertExists(result.id);
        const participant = await db.query.matchParticipants.findFirst({
          where: eq(matchParticipants.id, result.id),
        });
        assertExists(participant);
        assertEquals(participant.userId, "participant-user");
        assertEquals(participant.team, "RED");
        assertEquals(participant.kills, 5);
      });
    });

    describe("異常系", () => {
      it("存在しないuserIdを指定したとき、RecordNotFoundErrorをスローする", async () => {
        // Setup
        await db.insert(matches).values({ id: "test-match" });
        const participantData = {
          ...baseParticipantData,
          matchId: "test-match",
          userId: "non-existent-user",
        };

        // Act & Assert
        await assertRejects(async () => {
          await dbActions.createMatchParticipant(participantData);
        }, RecordNotFoundError);
      });

      it("存在しないmatchIdを指定したとき、RecordNotFoundErrorをスローする", async () => {
        // Setup
        await db.insert(users).values({ discordId: "participant-user" });
        const participantData = {
          ...baseParticipantData,
          matchId: "non-existent-match",
          userId: "participant-user",
        };

        // Act & Assert
        await assertRejects(async () => {
          await dbActions.createMatchParticipant(participantData);
        }, RecordNotFoundError);
      });
    });
  });
});
