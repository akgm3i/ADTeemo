import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DomainConflictError, EventNotFoundError } from "../../errors.ts";
import type { Database } from "../index.ts";
import {
  customGameEventParticipants,
  customGameEvents,
  guilds,
  matches,
  users,
} from "../schema.ts";

const userInsertSchema = createInsertSchema(users);
const guildInsertSchema = createInsertSchema(guilds);
const customGameEventInsertSchema = createInsertSchema(customGameEvents);
const eventParticipantInsertSchema = createInsertSchema(
  customGameEventParticipants,
);

const eventParticipantsSchema = z.array(
  eventParticipantInsertSchema.pick({
    userId: true,
    lane: true,
    team: true,
  }),
).length(10).superRefine((participants, context) => {
  const users = new Set<string>();
  const assignments = new Set<string>();
  participants.forEach((participant, index) => {
    if (users.has(participant.userId)) {
      context.addIssue({
        code: "custom",
        message: "Participant userId must be unique within an event",
        path: [index, "userId"],
      });
    }
    users.add(participant.userId);

    const assignment = `${participant.team}:${participant.lane}`;
    if (assignments.has(assignment)) {
      context.addIssue({
        code: "custom",
        message: "Each team and lane assignment must be unique",
        path: [index, "lane"],
      });
    }
    assignments.add(assignment);
  });
});

type EventScope = {
  eventId: number;
  guildId: string;
  recruitmentChannelId: string;
};

type PrepareEventInput = {
  operationKey: string;
  name: string;
  guildId: string;
  creatorId: string;
  recruitmentChannelId: string;
  voiceChannelId: string;
  scheduledStartAt: Date;
};

function sameDate(left: Date, right: Date): boolean {
  // SQLite timestamp columns persist whole seconds, including on first write.
  return Math.floor(left.getTime() / 1000) ===
    Math.floor(right.getTime() / 1000);
}

function isSamePreparation(
  event: typeof customGameEvents.$inferSelect,
  input: PrepareEventInput,
): boolean {
  return event.operationKey === input.operationKey &&
    event.name === input.name &&
    event.guildId === input.guildId &&
    event.creatorId === input.creatorId &&
    event.recruitmentChannelId === input.recruitmentChannelId &&
    event.voiceChannelId === input.voiceChannelId &&
    sameDate(event.scheduledStartAt, input.scheduledStartAt);
}

function normalizedParticipants(
  participants: Array<{ userId: string; lane: string; team: string }>,
) {
  return participants.map(({ userId, lane, team }) => ({
    userId,
    lane,
    team,
  })).toSorted((left, right) => left.userId.localeCompare(right.userId));
}

export function createEventsRepository(database: Database) {
  // Match the custom-match writer: serialize roster writes on this API process
  // so concurrent retries observe the first commit instead of SQLITE_BUSY.
  // The transaction below still protects the roster across DB connections.
  let rosterWriteTail: Promise<void> = Promise.resolve();
  function serializeRosterWrite<T>(operation: () => Promise<T>) {
    const result = rosterWriteTail.then(operation);
    rosterWriteTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function scopedEvent(
    query: typeof database.query,
    scope: EventScope,
  ) {
    const event = await query.customGameEvents.findFirst({
      where: and(
        eq(customGameEvents.id, scope.eventId),
        eq(customGameEvents.guildId, scope.guildId),
        eq(
          customGameEvents.recruitmentChannelId,
          scope.recruitmentChannelId,
        ),
      ),
    });
    if (!event) {
      throw new EventNotFoundError("Custom game event not found in scope");
    }
    return event;
  }

  async function prepareCustomGameEvent(input: PrepareEventInput) {
    return await database.transaction(async (tx) => {
      const existing = await tx.query.customGameEvents.findFirst({
        where: eq(customGameEvents.operationKey, input.operationKey),
      });
      if (existing) {
        if (!isSamePreparation(existing, input)) {
          throw new DomainConflictError(
            "Custom game operation key was reused with different input",
          );
        }
        return { created: false as const, event: existing };
      }

      await tx.insert(users).values(
        userInsertSchema.parse({ discordId: input.creatorId }),
      ).onConflictDoNothing().execute();
      await tx.insert(guilds).values(
        guildInsertSchema.parse({ id: input.guildId }),
      ).onConflictDoNothing().execute();

      const [event] = await tx.insert(customGameEvents).values(
        customGameEventInsertSchema.parse({
          ...input,
          phase: "PREPARING",
          syncState: "CREATE_PENDING",
        }),
      ).returning();
      return { created: true as const, event };
    });
  }

  async function updateCustomGameEventCreationProgress(
    input: EventScope & {
      discordScheduledEventId?: string;
      recruitmentMessageId?: string;
    },
  ) {
    return await database.transaction(async (tx) => {
      const event = await scopedEvent(tx.query, input);
      if (event.phase === "CANCELLED") {
        throw new DomainConflictError("Cancelled event cannot be created");
      }
      if (
        input.discordScheduledEventId && event.discordScheduledEventId &&
        input.discordScheduledEventId !== event.discordScheduledEventId
      ) {
        throw new DomainConflictError(
          "Discord scheduled event id does not match saved progress",
        );
      }
      if (
        input.recruitmentMessageId && event.recruitmentMessageId &&
        input.recruitmentMessageId !== event.recruitmentMessageId
      ) {
        throw new DomainConflictError(
          "Recruitment message id does not match saved progress",
        );
      }
      if (event.syncState === "CONSISTENT") return event;
      if (event.syncState !== "CREATE_PENDING") {
        throw new DomainConflictError(
          "Event is not accepting creation progress",
        );
      }

      const [updated] = await tx.update(customGameEvents).set({
        discordScheduledEventId: input.discordScheduledEventId ??
          event.discordScheduledEventId,
        recruitmentMessageId: input.recruitmentMessageId ??
          event.recruitmentMessageId,
        revision: sql`${customGameEvents.revision} + 1`,
        lastFailureCode: null,
      }).where(and(
        eq(customGameEvents.id, event.id),
        eq(customGameEvents.revision, event.revision),
      )).returning();
      if (!updated) {
        throw new DomainConflictError("Event creation progress changed");
      }
      return updated;
    });
  }

  async function activateCustomGameEvent(scope: EventScope) {
    return await database.transaction(async (tx) => {
      const event = await scopedEvent(tx.query, scope);
      if (
        event.phase === "RECRUITING" && event.syncState === "CONSISTENT"
      ) {
        return event;
      }
      if (
        event.phase !== "PREPARING" ||
        event.syncState !== "CREATE_PENDING" ||
        !event.discordScheduledEventId || !event.recruitmentMessageId
      ) {
        throw new DomainConflictError(
          "Event cannot be activated before all Discord ids are saved",
        );
      }

      const [updated] = await tx.update(customGameEvents).set({
        phase: "RECRUITING",
        syncState: "CONSISTENT",
        revision: sql`${customGameEvents.revision} + 1`,
        lastFailureCode: null,
      }).where(and(
        eq(customGameEvents.id, event.id),
        eq(customGameEvents.revision, event.revision),
      )).returning();
      if (!updated) {
        throw new DomainConflictError("Event activation state changed");
      }
      return updated;
    });
  }

  async function markCustomGameEventCreationFailed(
    input: EventScope & {
      discordScheduledEventId?: string;
      recruitmentMessageId?: string;
      discordEventDeleted: boolean;
      recruitmentMessageDeleted: boolean;
      failureCode: string;
    },
  ) {
    return await database.transaction(async (tx) => {
      const event = await scopedEvent(tx.query, input);
      if (event.phase === "CANCELLED") return event;
      if (
        event.phase !== "PREPARING" ||
        (event.syncState !== "CREATE_PENDING" &&
          event.syncState !== "CREATE_COMPENSATION_PENDING")
      ) {
        throw new DomainConflictError(
          "Event is not accepting creation failure compensation",
        );
      }
      if (
        input.discordScheduledEventId && event.discordScheduledEventId &&
        input.discordScheduledEventId !== event.discordScheduledEventId
      ) {
        throw new DomainConflictError(
          "Discord scheduled event id does not match saved progress",
        );
      }
      if (
        input.recruitmentMessageId && event.recruitmentMessageId &&
        input.recruitmentMessageId !== event.recruitmentMessageId
      ) {
        throw new DomainConflictError(
          "Recruitment message id does not match saved progress",
        );
      }

      const discordScheduledEventId = input.discordScheduledEventId ??
        event.discordScheduledEventId;
      const recruitmentMessageId = input.recruitmentMessageId ??
        event.recruitmentMessageId;
      const discordEventDeleted = event.discordEventDeleted ||
        input.discordEventDeleted;
      const recruitmentMessageDeleted = event.recruitmentMessageDeleted ||
        input.recruitmentMessageDeleted;
      const compensated = discordEventDeleted && recruitmentMessageDeleted;

      const [updated] = await tx.update(customGameEvents).set({
        discordScheduledEventId,
        recruitmentMessageId,
        discordEventDeleted,
        recruitmentMessageDeleted,
        phase: compensated ? "CANCELLED" : "PREPARING",
        syncState: compensated ? "CONSISTENT" : "CREATE_COMPENSATION_PENDING",
        lastFailureCode: input.failureCode,
        revision: sql`${customGameEvents.revision} + 1`,
      }).where(and(
        eq(customGameEvents.id, event.id),
        eq(customGameEvents.revision, event.revision),
      )).returning();
      if (!updated) {
        throw new DomainConflictError("Event compensation state changed");
      }
      return updated;
    });
  }

  async function beginCustomGameEventCancellation(scope: EventScope) {
    return await database.transaction(async (tx) => {
      const event = await scopedEvent(tx.query, scope);
      if (event.phase === "CANCELLED") return event;
      if (event.syncState === "CANCEL_PENDING") return event;
      if (
        event.syncState !== "CONSISTENT" &&
        event.syncState !== "CREATE_PENDING" &&
        event.syncState !== "CREATE_COMPENSATION_PENDING"
      ) {
        throw new DomainConflictError("Event cannot begin cancellation");
      }

      const [updated] = await tx.update(customGameEvents).set({
        syncState: "CANCEL_PENDING",
        revision: sql`${customGameEvents.revision} + 1`,
        lastFailureCode: null,
      }).where(and(
        eq(customGameEvents.id, event.id),
        eq(customGameEvents.revision, event.revision),
      )).returning();
      if (!updated) {
        throw new DomainConflictError("Event cancellation state changed");
      }
      return updated;
    });
  }

  async function updateCustomGameEventCancellationProgress(
    input: EventScope & {
      discordScheduledEventId?: string;
      recruitmentMessageId?: string;
      discordEventDeleted?: boolean;
      recruitmentMessageDeleted?: boolean;
      failureCode?: string | null;
    },
  ) {
    return await database.transaction(async (tx) => {
      const event = await scopedEvent(tx.query, input);
      if (
        (input.discordScheduledEventId !== undefined &&
          event.discordScheduledEventId !== null &&
          input.discordScheduledEventId !== event.discordScheduledEventId) ||
        (input.recruitmentMessageId !== undefined &&
          event.recruitmentMessageId !== null &&
          input.recruitmentMessageId !== event.recruitmentMessageId)
      ) {
        throw new DomainConflictError("Event cancellation target changed");
      }
      if (event.phase === "CANCELLED") return event;
      if (event.syncState !== "CANCEL_PENDING") {
        throw new DomainConflictError("Event cancellation is not pending");
      }

      const discordEventDeleted = event.discordEventDeleted ||
        input.discordEventDeleted === true;
      const recruitmentMessageDeleted = event.recruitmentMessageDeleted ||
        input.recruitmentMessageDeleted === true;
      const completed = discordEventDeleted && recruitmentMessageDeleted;
      const [updated] = await tx.update(customGameEvents).set({
        discordScheduledEventId: input.discordScheduledEventId ??
          event.discordScheduledEventId,
        recruitmentMessageId: input.recruitmentMessageId ??
          event.recruitmentMessageId,
        discordEventDeleted,
        recruitmentMessageDeleted,
        phase: completed ? "CANCELLED" : event.phase,
        syncState: completed ? "CONSISTENT" : "CANCEL_PENDING",
        lastFailureCode: input.failureCode === undefined
          ? event.lastFailureCode
          : input.failureCode,
        revision: sql`${customGameEvents.revision} + 1`,
      }).where(and(
        eq(customGameEvents.id, event.id),
        eq(customGameEvents.revision, event.revision),
      )).returning();
      if (!updated) {
        throw new DomainConflictError("Event cancellation progress changed");
      }
      return updated;
    });
  }

  async function getCustomGameEventsByCreator(input: {
    guildId: string;
    recruitmentChannelId: string;
    creatorId: string;
  }) {
    return await database.query.customGameEvents.findMany({
      where: and(
        eq(customGameEvents.guildId, input.guildId),
        eq(
          customGameEvents.recruitmentChannelId,
          input.recruitmentChannelId,
        ),
        eq(customGameEvents.creatorId, input.creatorId),
        ne(customGameEvents.phase, "CANCELLED"),
      ),
    });
  }

  async function getEventStartingTodayByCreator(input: {
    guildId: string;
    recruitmentChannelId: string;
    creatorId: string;
  }) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    return await database.query.customGameEvents.findFirst({
      where: and(
        eq(customGameEvents.guildId, input.guildId),
        eq(
          customGameEvents.recruitmentChannelId,
          input.recruitmentChannelId,
        ),
        eq(customGameEvents.creatorId, input.creatorId),
        eq(customGameEvents.phase, "RECRUITING"),
        eq(customGameEvents.syncState, "CONSISTENT"),
        gte(customGameEvents.scheduledStartAt, todayStart),
        lt(customGameEvents.scheduledStartAt, tomorrowStart),
      ),
    });
  }

  async function writeCustomGameEventParticipants(
    input: EventScope & {
      participants: z.infer<typeof eventParticipantsSchema>;
    },
    allowReplace: boolean,
  ) {
    const participants = eventParticipantsSchema.parse(input.participants);
    return await serializeRosterWrite(() =>
      database.transaction(async (tx) => {
        const event = await scopedEvent(tx.query, input);
        if (
          event.phase !== "RECRUITING" || event.syncState !== "CONSISTENT"
        ) {
          throw new DomainConflictError(
            "Participants can only be saved for a consistent recruiting event",
          );
        }

        const existing = await tx.query.customGameEventParticipants.findMany({
          where: eq(customGameEventParticipants.eventId, event.id),
        });
        if (
          existing.length > 0 &&
          JSON.stringify(normalizedParticipants(existing)) ===
            JSON.stringify(normalizedParticipants(participants))
        ) {
          return existing;
        }

        if (existing.length > 0 && !allowReplace) {
          throw new DomainConflictError("Event roster is already confirmed");
        }

        const existingMatch = await tx.query.matches.findFirst({
          where: eq(matches.customGameEventId, event.id),
        });
        if (existingMatch) {
          throw new DomainConflictError(
            "Participants cannot change after a match is recorded",
          );
        }

        for (const participant of participants) {
          await tx.insert(users).values(
            userInsertSchema.parse({ discordId: participant.userId }),
          ).onConflictDoNothing().execute();
        }
        await tx.delete(customGameEventParticipants).where(
          eq(customGameEventParticipants.eventId, event.id),
        ).execute();
        return await tx.insert(customGameEventParticipants).values(
          participants.map((participant) =>
            eventParticipantInsertSchema.parse({
              ...participant,
              eventId: event.id,
            })
          ),
        ).returning();
      })
    );
  }

  function saveCustomGameEventParticipants(
    input: EventScope & {
      participants: z.infer<typeof eventParticipantsSchema>;
    },
  ) {
    // Explicit pre-match corrections remain available to existing API callers.
    return writeCustomGameEventParticipants(input, true);
  }

  function confirmCustomGameEventParticipants(
    input: EventScope & {
      participants: z.infer<typeof eventParticipantsSchema>;
    },
  ) {
    // The write transaction serializes the empty check and all ten inserts.
    // A second split operation must never replace the roster used for VC moves.
    return writeCustomGameEventParticipants(input, false);
  }

  async function getCustomGameEventParticipants(scope: EventScope) {
    const event = await scopedEvent(database.query, scope);
    if (event.phase !== "RECRUITING" || event.syncState !== "CONSISTENT") {
      throw new DomainConflictError("Event participants are not recordable");
    }
    return await database.query.customGameEventParticipants.findMany({
      where: eq(customGameEventParticipants.eventId, event.id),
      orderBy: [
        customGameEventParticipants.team,
        customGameEventParticipants.lane,
      ],
    });
  }

  async function getNextCustomGameSequence(scope: EventScope) {
    const roster = await getCustomGameEventParticipants(scope);
    if (roster.length !== 10) {
      throw new DomainConflictError("A confirmed roster is required");
    }
    const [row] = await database.select({
      sequence: sql<number>`coalesce(max(${matches.gameSequence}), 0) + 1`,
    }).from(matches).where(eq(matches.customGameEventId, scope.eventId));
    return row.sequence;
  }

  // Kept for internal legacy callers while old rows are reconciled. New API
  // creation always uses prepareCustomGameEvent and the state machine above.
  async function createCustomGameEvent(event: {
    name: string;
    guildId: string;
    creatorId: string;
    discordScheduledEventId: string;
    recruitmentMessageId: string;
    scheduledStartAt: Date;
  }) {
    await database.transaction(async (tx) => {
      await tx.insert(users).values(
        userInsertSchema.parse({ discordId: event.creatorId }),
      ).onConflictDoNothing().execute();
      await tx.insert(guilds).values(
        guildInsertSchema.parse({ id: event.guildId }),
      ).onConflictDoNothing().execute();
      await tx.insert(customGameEvents).values(
        customGameEventInsertSchema.parse({
          ...event,
          phase: "RECRUITING",
          syncState: "CONSISTENT",
        }),
      ).execute();
    });
  }

  return {
    prepareCustomGameEvent,
    updateCustomGameEventCreationProgress,
    activateCustomGameEvent,
    markCustomGameEventCreationFailed,
    beginCustomGameEventCancellation,
    updateCustomGameEventCancellationProgress,
    getCustomGameEventsByCreator,
    getEventStartingTodayByCreator,
    saveCustomGameEventParticipants,
    confirmCustomGameEventParticipants,
    getCustomGameEventParticipants,
    getNextCustomGameSequence,
    createCustomGameEvent,
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
