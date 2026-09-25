import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { lanes } from "../contract/domain.ts";
import { createApp } from "../app.ts";
import { createMigratedTestDatabase } from "../db/integration_test_harness.ts";
import { matches } from "../db/schema.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";

const roster = lanes.flatMap((lane, index) => [
  { userId: `red-${index}`, team: "RED" as const, lane },
  { userId: `blue-${index}`, team: "BLUE" as const, lane },
]);
const scope = { guildId: "guild-1", recruitmentChannelId: "channel-1" };

async function setup(
  database: Awaited<ReturnType<typeof createMigratedTestDatabase>>,
) {
  const { event } = await database.actions.prepareCustomGameEvent({
    ...scope,
    operationKey: "roster-operation",
    name: "custom",
    creatorId: "owner",
    voiceChannelId: "lobby",
    scheduledStartAt: new Date("2026-09-25T10:00:00Z"),
  });
  const eventScope = { ...scope, eventId: event.id };
  await database.actions.updateCustomGameEventCreationProgress({
    ...eventScope,
    discordScheduledEventId: "discord-event",
    recruitmentMessageId: "recruitment",
  });
  await database.actions.activateCustomGameEvent(eventScope);
  return {
    eventScope,
    app: createApp(createTestDependencies({ dbActions: database.actions })),
  };
}
function request(body: unknown, method = "POST") {
  return {
    method,
    headers: {
      ...TEST_BOT_SERVICE_AUTH_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
function normalized(
  participants: Array<{ userId: string; team: string; lane: string }>,
) {
  return participants.map(({ userId, team, lane }) => ({ userId, team, lane }))
    .toSorted((left, right) => left.userId.localeCompare(right.userId));
}

describe("初回ロスター確定のHTTP/SQLite境界", () => {
  test("2操作が確定前の空rosterを読んだ後に別々の抽選結果を送ると、最初の10人だけ確定し後発と再送は上書きしない", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants/confirm`;
    // Both Discord operations have already observed an empty roster.
    const snapshots = await Promise.all([
      database.actions.getCustomGameEventParticipants(eventScope),
      database.actions.getCustomGameEventParticipants(eventScope),
    ]);
    assertEquals(snapshots, [[], []]);
    const input = { ...scope, participants: roster };
    assertEquals((await app.request(path, request(input))).status, 200);
    const replay = await app.request(
      path,
      request({ ...input, participants: [...roster].reverse() }),
    );
    assertEquals(replay.status, 200);
    const competing = roster.map((entry) => ({
      ...entry,
      team: entry.team === "RED" ? "BLUE" : "RED",
    }));
    const conflict = await app.request(
      path,
      request({ ...scope, participants: competing }),
    );
    assertEquals(conflict.status, 409);
    assertEquals((await conflict.json()).code, "CONFLICT");
    assertEquals(
      normalized(
        await database.actions.getCustomGameEventParticipants(eventScope),
      ),
      normalized(roster),
    );
  });

  test("確定APIでは再抽選を拒否しても、既存の明示roster更新APIは戦績前だけ置換を許可する", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants`;
    assertEquals(
      (await app.request(
        `${path}/confirm`,
        request({ ...scope, participants: roster }),
      )).status,
      200,
    );
    const changed = roster.map((entry) => ({
      ...entry,
      userId: `other-${entry.userId}`,
    }));
    assertEquals(
      (await app.request(
        path,
        request({ ...scope, participants: changed }, "PUT"),
      )).status,
      200,
    );
    await database.db.insert(matches).values({
      id: "first-game",
      customGameEventId: eventScope.eventId,
      gameSequence: 1,
    });
    assertEquals(
      (await app.request(
        path,
        request({ ...scope, participants: roster }, "PUT"),
      )).status,
      409,
    );
    assertEquals(
      normalized(
        await database.actions.getCustomGameEventParticipants(eventScope),
      ),
      normalized(changed),
    );
  });

  test("権限・scope・roster validationに失敗すると、確定行を作らず適切なHTTP statusを返す", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants/confirm`;
    assertEquals((await app.request(path, { method: "POST" })).status, 401);
    assertEquals(
      (await app.request(
        path,
        request({ ...scope, guildId: "other", participants: roster }),
      )).status,
      404,
    );
    assertEquals(
      (await app.request(
        path,
        request({ ...scope, participants: roster.slice(1) }),
      )).status,
      422,
    );
    assertEquals(
      await database.actions.getCustomGameEventParticipants(eventScope),
      [],
    );
    await database.actions.beginCustomGameEventCancellation(eventScope);
    assertEquals(
      (await app.request(path, request({ ...scope, participants: roster })))
        .status,
      409,
    );
  });

  test("異なる初回確定が同時に届いても、成功は1操作で全10人が同じ提案に属し、後発の再試行は競合に収束する", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants/confirm`;
    const proposals = [
      roster,
      roster.map((entry) => ({ ...entry, userId: `other-${entry.userId}` })),
    ];
    const replies = await Promise.all(
      proposals.map((participants) =>
        app.request(path, request({ ...scope, participants }))
      ),
    );
    assertEquals(
      replies.filter((response) => response.status === 200).length,
      1,
    );
    const winner = replies.findIndex((response) => response.status === 200);
    assertEquals(
      normalized(
        await database.actions.getCustomGameEventParticipants(eventScope),
      ),
      normalized(proposals[winner]),
    );
    const loser = replies[1 - winner];
    assertEquals(loser.status, 409);
    assertEquals((await loser.json()).code, "CONFLICT");
    assertEquals(
      (await app.request(
        path,
        request({ ...scope, participants: proposals[1 - winner] }),
      )).status,
      409,
    );
  });
  test("初回確定の途中でinsertが失敗すると、参加者を1人も残さず再試行で全員確定できる", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants/confirm`;
    await database.client.execute(
      `CREATE TRIGGER reject_confirmation BEFORE INSERT ON custom_game_event_participants
      WHEN NEW.user_id = 'blue-2' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
    );
    assertEquals(
      (await app.request(path, request({ ...scope, participants: roster })))
        .status,
      500,
    );
    assertEquals(
      await database.actions.getCustomGameEventParticipants(eventScope),
      [],
    );
    await database.client.execute("DROP TRIGGER reject_confirmation");
    assertEquals(
      (await app.request(path, request({ ...scope, participants: roster })))
        .status,
      200,
    );
    assertEquals(
      normalized(
        await database.actions.getCustomGameEventParticipants(eventScope),
      ),
      normalized(roster),
    );
  });
  test("同じ初回確定を同時再送すると、両操作が200で同一の確定済み10人を返す", async () => {
    await using database = await createMigratedTestDatabase();
    const { app, eventScope } = await setup(database);
    const path = `/events/${eventScope.eventId}/participants/confirm`;
    const replies = await Promise.all(
      [1, 2].map(() =>
        app.request(path, request({ ...scope, participants: roster }))
      ),
    );
    assertEquals(replies.map((reply) => reply.status), [200, 200]);
    for (const reply of replies) {
      assertEquals(
        normalized((await reply.json()).participants),
        normalized(roster),
      );
    }
  });
});
