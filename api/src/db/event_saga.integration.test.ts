import { assert, assertEquals, assertRejects } from "@std/assert";
import { test } from "@std/testing/bdd";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";
import { customGameEvents } from "./schema.ts";
import { DomainConflictError, EventNotFoundError } from "../errors.ts";

const preparation = {
  operationKey: "event-saga-db",
  name: "カスタム",
  guildId: "guild-1",
  creatorId: "creator-1",
  recruitmentChannelId: "channel-1",
  voiceChannelId: "voice-1",
  scheduledStartAt: new Date("2026-10-01T00:00:00Z"),
};

for (const workflow of ["compensation", "cancellation"] as const) {
  test(`${workflow}の古い削除進捗を再送しても、実DBの削除済みflagはtrueから戻らない`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(preparation);
    const scope = {
      eventId: prepared.event.id,
      guildId: preparation.guildId,
      recruitmentChannelId: preparation.recruitmentChannelId,
    };
    if (workflow === "cancellation") {
      await database.actions.beginCustomGameEventCancellation(scope);
    }
    const update = workflow === "compensation"
      ? (discordEventDeleted: boolean, recruitmentMessageDeleted: boolean) =>
        database.actions.markCustomGameEventCreationFailed({
          ...scope,
          discordEventDeleted,
          recruitmentMessageDeleted,
          failureCode: "TEST_FAILURE",
        })
      : (discordEventDeleted: boolean, recruitmentMessageDeleted: boolean) =>
        database.actions.updateCustomGameEventCancellationProgress({
          ...scope,
          discordEventDeleted,
          recruitmentMessageDeleted,
        });

    // Act
    const first = await update(true, false);
    const stale = await update(false, false);
    const final = await update(false, true);
    const replay = await update(false, false);

    // Assert
    assertEquals([first.discordEventDeleted, first.recruitmentMessageDeleted], [
      true,
      false,
    ]);
    assertEquals([stale.discordEventDeleted, stale.recruitmentMessageDeleted], [
      true,
      false,
    ]);
    assertEquals(stale.revision, first.revision + 1);
    assertEquals([
      final.phase,
      final.syncState,
      final.discordEventDeleted,
      final.recruitmentMessageDeleted,
    ], ["CANCELLED", "CONSISTENT", true, true]);
    assertEquals(replay, final);
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved, final);
  });
}

test("全Saga更新でguildまたはchannelが違うと、実DBの所有行とrevisionを変更しない", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const prepared = await database.actions.prepareCustomGameEvent(preparation);
  const scope = {
    eventId: prepared.event.id,
    guildId: preparation.guildId,
    recruitmentChannelId: preparation.recruitmentChannelId,
  };
  const updates = [
    (input: typeof scope) =>
      database.actions.updateCustomGameEventCreationProgress({
        ...input,
        discordScheduledEventId: "forbidden",
      }),
    (input: typeof scope) => database.actions.activateCustomGameEvent(input),
    (input: typeof scope) =>
      database.actions.markCustomGameEventCreationFailed({
        ...input,
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "FORBIDDEN",
      }),
    (input: typeof scope) =>
      database.actions.beginCustomGameEventCancellation(input),
    (input: typeof scope) =>
      database.actions.updateCustomGameEventCancellationProgress({
        ...input,
        discordEventDeleted: true,
      }),
  ];

  // Act / Assert
  for (
    const deniedScope of [{ ...scope, guildId: "other-guild" }, {
      ...scope,
      recruitmentChannelId: "other-channel",
    }]
  ) {
    for (const update of updates) {
      await assertRejects(() => update(deniedScope), EventNotFoundError);
    }
  }
  const [saved] = await database.db.select().from(customGameEvents);
  assertEquals(saved, prepared.event);
});

test("同じイベントへ異なるDiscord IDを同時に保存すると、所有を得た1件だけがcommitされる", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const prepared = await database.actions.prepareCustomGameEvent(preparation);
  const scope = {
    eventId: prepared.event.id,
    guildId: preparation.guildId,
    recruitmentChannelId: preparation.recruitmentChannelId,
  };

  // Act
  const results = await Promise.allSettled(
    ["first", "second"].map((discordScheduledEventId) =>
      database.actions.updateCustomGameEventCreationProgress({
        ...scope,
        discordScheduledEventId,
      })
    ),
  );

  // Assert
  assertEquals(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert(
    rejected?.status === "rejected" &&
      rejected.reason instanceof DomainConflictError,
  );
  const accepted = results.find((result) => result.status === "fulfilled");
  assert(accepted?.status === "fulfilled");
  const [saved] = await database.db.select().from(customGameEvents);
  assertEquals(
    saved.discordScheduledEventId,
    accepted.value.discordScheduledEventId,
  );
  assertEquals(saved.revision, prepared.event.revision + 1);
});

test("revision付きUPDATEが実SQLiteで0件になったとき、競合を返してrollback後の再試行を許可する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const prepared = await database.actions.prepareCustomGameEvent(preparation);
  const input = {
    eventId: prepared.event.id,
    guildId: preparation.guildId,
    recruitmentChannelId: preparation.recruitmentChannelId,
    discordScheduledEventId: "event-1",
  };
  // Exercise the real zero-row UPDATE/RETURNING failure boundary without
  // reimplementing Drizzle or assuming concurrent readers bypass the DB queue.
  await database.client.execute(
    `CREATE TRIGGER skip_event_update BEFORE UPDATE ON custom_game_events BEGIN SELECT RAISE(IGNORE); END`,
  );

  // Act / Assert
  await assertRejects(
    () => database.actions.updateCustomGameEventCreationProgress(input),
    DomainConflictError,
    "progress changed",
  );
  const [unchanged] = await database.db.select().from(customGameEvents);
  assertEquals(unchanged, prepared.event);
  await database.client.execute("DROP TRIGGER skip_event_update");
  const saved = await database.actions.updateCustomGameEventCreationProgress(
    input,
  );
  assertEquals(saved.discordScheduledEventId, "event-1");
  assertEquals(saved.revision, prepared.event.revision + 1);
});
