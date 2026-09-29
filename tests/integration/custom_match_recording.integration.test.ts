/// <reference path="../../bot/src/@types/discord.js.d.ts" />
import { FakeTime } from "@std/testing/time";
import { configureApiClient } from "../../bot/src/api_client.ts";
import { execute as executeRecordMatch } from "../../bot/src/commands/record-match.ts";
import { recordMatchDiscord } from "../../bot/src/features/testing/record_match_discord.ts";
import { MockInteractionBuilder } from "../../bot/src/test_utils.ts";
import { messageHandler, messageKeys } from "../../bot/src/messages.ts";
import { strictFake } from "../../bot/src/features/testing/strict_fake.ts";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from "../../api/src/db/integration_test_harness.ts";
import {
  matches,
  matchParticipants,
  riotAccounts,
} from "../../api/src/db/schema.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";
import { failureKind } from "../../bot/src/api_clients/transport.ts";

const eventRoster = [
  { userId: "user-1", lane: "Top" as const, team: "BLUE" as const },
  { userId: "user-2", lane: "Jungle" as const, team: "BLUE" as const },
  { userId: "user-3", lane: "Middle" as const, team: "BLUE" as const },
  { userId: "user-4", lane: "Bottom" as const, team: "BLUE" as const },
  { userId: "user-5", lane: "Support" as const, team: "BLUE" as const },
  { userId: "user-6", lane: "Top" as const, team: "RED" as const },
  { userId: "user-7", lane: "Jungle" as const, team: "RED" as const },
  { userId: "user-8", lane: "Middle" as const, team: "RED" as const },
  { userId: "user-9", lane: "Bottom" as const, team: "RED" as const },
  { userId: "user-10", lane: "Support" as const, team: "RED" as const },
];

const matchStats = eventRoster.map((participant, index) => ({
  userId: participant.userId,
  kills: index + 1,
  deaths: 2,
  assists: 3,
  cs: 100 + index,
  gold: 10_000 + index,
}));

function canonicalRiotAccount(userId: string) {
  return {
    discordId: userId,
    puuid: `puuid-${userId}`,
    gameName: `Teemo-${userId}`,
    tagLine: "JP1",
    platform: "jp1" as const,
    region: "asia" as const,
  };
}

async function seedConfirmedEvent(
  database: MigratedTestDatabase,
  missingAccountUserId?: string,
) {
  const prepared = await database.actions.prepareCustomGameEvent({
    operationKey: "record-match-integration",
    name: "Integration Custom Game",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
  });
  const scope = {
    eventId: prepared.event.id,
    guildId: "guild-1",
    recruitmentChannelId: "channel-1",
  };
  await database.actions.updateCustomGameEventCreationProgress({
    ...scope,
    discordScheduledEventId: "discord-event-1",
    recruitmentMessageId: "message-1",
  });
  await database.actions.activateCustomGameEvent(scope);
  await database.actions.saveCustomGameEventParticipants({
    ...scope,
    participants: eventRoster,
  });
  for (const participant of eventRoster) {
    if (participant.userId !== missingAccountUserId) {
      await database.actions.upsertRiotAccount(
        canonicalRiotAccount(participant.userId),
      );
    }
  }

  return {
    ...scope,
    gameSequence: 1,
    winner: "BLUE" as const,
    stats: matchStats,
  };
}

describe("Bot→API→DB custom match integration", () => {
  describe("正常系", () => {
    test("確定済み10人イベントにcanonical Riot accountがあるとき、Bot clientから同じ戦績を再送すると1試合だけ保存してcreated falseを返す", async () => {
      // Arrange
      await using database = await createMigratedTestDatabase();
      const app = createApp(createTestDependencies({
        dbActions: database.actions,
      }));
      const botApiClient = createInProcessBotApiClient(app);
      const input = await seedConfirmedEvent(database);

      // Act
      const first = await botApiClient.recordCustomMatch(input);
      const replay = await botApiClient.recordCustomMatch(input);
      const savedMatches = await database.db.select().from(matches);
      const savedParticipants = await database.db.select().from(
        matchParticipants,
      );

      // Assert
      assertEquals(first, {
        success: true,
        created: true,
        matchId: `custom:${input.eventId}:1`,
        participantCount: 10,
      });
      assertEquals(replay, {
        success: true,
        created: false,
        matchId: `custom:${input.eventId}:1`,
        participantCount: 10,
      });
      assertEquals(savedMatches.length, 1);
      assertEquals(savedMatches[0].customGameEventId, input.eventId);
      assertEquals(savedMatches[0].gameSequence, 1);
      assertEquals(savedParticipants.length, 10);
      assertEquals(
        savedParticipants.map((participant) => participant.riotPuuid)
          .toSorted(),
        eventRoster.map((participant) => `puuid-${participant.userId}`)
          .toSorted(),
      );
    });
  });

  describe("異常系", () => {
    test("同じeventとgame sequenceへ異なる戦績をBot clientから再送すると、409を返して既存DB値を変更しない", async () => {
      // Arrange
      await using database = await createMigratedTestDatabase();
      const app = createApp(createTestDependencies({
        dbActions: database.actions,
      }));
      const botApiClient = createInProcessBotApiClient(app);
      const input = await seedConfirmedEvent(database);
      const first = await botApiClient.recordCustomMatch(input);
      assertEquals(first.success, true);
      const matchesBeforeConflict = await database.db.select().from(matches);
      const participantsBeforeConflict = (await database.db.select().from(
        matchParticipants,
      )).toSorted((left, right) => left.userId.localeCompare(right.userId));
      const conflictingInput = {
        ...input,
        stats: input.stats.map((stat) =>
          stat.userId === "user-1" ? { ...stat, kills: 99 } : stat
        ),
      };

      // Act
      const conflict = await botApiClient.recordCustomMatch(conflictingInput);
      const matchesAfterConflict = await database.db.select().from(matches);
      const participantsAfterConflict = (await database.db.select().from(
        matchParticipants,
      )).toSorted((left, right) => left.userId.localeCompare(right.userId));

      // Assert
      assertEquals(conflict.success, false);
      if (conflict.success) return;
      assertEquals(conflict.code, "CONFLICT");
      assertEquals(conflict.status, 409);
      assertEquals(failureKind(conflict), "http");
      assertEquals(matchesAfterConflict, matchesBeforeConflict);
      assertEquals(participantsAfterConflict, participantsBeforeConflict);
      assertEquals(
        participantsAfterConflict.find((entry) => entry.userId === "user-1")
          ?.kills,
        1,
      );
    });

    test("確定rosterのcanonical Riot accountが欠けるとき、Bot clientから保存すると404を返してmatchもparticipantも作らない", async () => {
      // Arrange
      await using database = await createMigratedTestDatabase();
      const app = createApp(createTestDependencies({
        dbActions: database.actions,
      }));
      const botApiClient = createInProcessBotApiClient(app);
      const input = await seedConfirmedEvent(database, "user-10");

      // Act
      const result = await botApiClient.recordCustomMatch(input);
      const savedAccounts = await database.db.select().from(riotAccounts);
      const savedMatches = await database.db.select().from(matches);
      const savedParticipants = await database.db.select().from(
        matchParticipants,
      );

      // Assert
      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.code, "RIOT_ACCOUNT_NOT_FOUND");
      assertEquals(result.status, 404);
      assertEquals(failureKind(result), "http");
      assertEquals(savedAccounts.length, 9);
      assertEquals(savedMatches, []);
      assertEquals(savedParticipants, []);
    });
  });
});

// Exercise the production command, participant provider and input collector;
// only Discord's outer interaction/channel/member operations are scripted.
function recordMatchDiscordBoundary(
  success: boolean,
  tick: (ms: number) => void,
  retry = false,
) {
  const orderedRoster = eventRoster.toSorted((left, right) =>
    left.team.localeCompare(right.team) || left.lane.localeCompare(right.lane)
  );
  const members = strictFake<[string], Promise<unknown>>(
    "members.fetch",
    orderedRoster.map(({ userId }) => ({
      args: [userId],
      value: Promise.resolve({
        id: userId,
        user: { id: userId, username: userId },
      }),
    })),
  );
  const interaction = new MockInteractionBuilder("record-match")
    .withUser({ id: "creator-1", username: "Creator" })
    .withGuild({ id: "guild-1", members: { fetch: members.invoke } })
    .withChannel({ id: "channel-1", isTextBased: () => true })
    .withStringOption("winner", "BLUE").build();
  const discord = recordMatchDiscord(interaction, [
    ...orderedRoster.map(({ userId }) => ({
      action: "input" as const,
      userId,
      inputMs: 93_000,
      draft: { kda: "1/2/3", cs: "100", gold: "10000" },
    })),
    { action: "confirm" },
    ...(retry ? [{ action: "confirm" as const }] : []),
    ...(!success ? [{ action: "cancel" as const }] : []),
  ], tick);
  return {
    interaction,
    edits: discord.edits,
    [Symbol.dispose]() {
      discord[Symbol.dispose]();
      members[Symbol.dispose]();
    },
  };
}

for (const injectFailure of [false, true]) {
  test(
    injectFailure
      ? "実record-match commandでparticipant INSERTが失敗すると、全DB変更をrollbackしてDiscordへ成功通知を出さない"
      : "実record-match commandを確定すると、10人のDB保存後にDiscordへ成功通知を出す",
    async () => {
      // Arrange
      await using database = await createMigratedTestDatabase();
      using clock = new FakeTime("2026-08-01T06:00:00.000Z");
      const input = await seedConfirmedEvent(database);
      if (injectFailure) {
        await database.client.execute(
          "CREATE TRIGGER reject_last_participant BEFORE INSERT ON match_participants WHEN NEW.user_id = 'user-10' BEGIN SELECT RAISE(ABORT, 'injected participant failure'); END",
        );
      }
      configureApiClient(
        createInProcessBotApiClient(
          createApp(createTestDependencies({ dbActions: database.actions })),
        ),
      );
      using discord = recordMatchDiscordBoundary(
        !injectFailure,
        (ms) => clock.tick(ms),
      );
      // Act
      await executeRecordMatch(discord.interaction);
      // Assert
      const savedMatches = await database.db.select().from(matches);
      const savedParticipants = await database.db.select().from(
        matchParticipants,
      );
      assertEquals(savedMatches.length, injectFailure ? 0 : 1);
      assertEquals(savedParticipants.length, injectFailure ? 0 : 10);
      if (!injectFailure) {
        assertEquals(savedMatches[0].id, `custom:${input.eventId}:1`);
        assertEquals(
          savedParticipants.every((row) =>
            row.kills === 1 && row.deaths === 2 && row.assists === 3
          ),
          true,
        );
      }
      assertEquals(Date.now() - discord.interaction.createdTimestamp, 930_000);
      assertEquals(
        discord.edits.some((edit) =>
          edit.body.content ===
            messageHandler.formatMessage(
              messageKeys.matchManagement.recordMatch.success,
            )
        ),
        !injectFailure,
      );
      assertEquals(
        discord.edits.at(-1)?.token,
        injectFailure ? "button-12" : "button-11",
      );
      if (injectFailure) {
        assertEquals(
          discord.edits.some((edit) =>
            edit.body.content?.includes(
              messageHandler.formatMessage(
                messageKeys.matchManagement.recordMatch.failureReason.database,
              ),
            )
          ),
          true,
        );
      }
    },
  );
}

test("実Backendへ不正な9人の戦績を送ると、Botへ422 validation codeを返しDBを変更しない", async () => {
  await using database = await createMigratedTestDatabase();
  const input = await seedConfirmedEvent(database);
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  const result = await api.recordCustomMatch({
    ...input,
    stats: input.stats.slice(0, 9),
  });
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals([result.code, result.status, failureKind(result)], [
    "VALIDATION_ERROR",
    422,
    "http",
  ]);
  assertEquals(await database.db.select().from(matches), []);
  assertEquals(await database.db.select().from(matchParticipants), []);
});

test("実commandの保存応答がcommit後に失われても、同じ内容の明示再送で1試合だけ保持し成功を確認する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  using clock = new FakeTime("2026-08-01T06:00:00.000Z");
  await seedConfirmedEvent(database);
  let recordRequests = 0;
  const app = createApp(
    createTestDependencies({ dbActions: database.actions }),
  );
  configureApiClient(createInProcessBotApiClient(app, (response, request) => {
    if (new URL(request.url).pathname === "/matches/custom") {
      recordRequests++;
      if (recordRequests === 1) throw new Error("Response lost after commit");
    }
    return response;
  }));
  using discord = recordMatchDiscordBoundary(
    true,
    (ms) => clock.tick(ms),
    true,
  );

  // Act
  await executeRecordMatch(discord.interaction);

  // Assert
  assertEquals(recordRequests, 2);
  assertEquals((await database.db.select().from(matches)).length, 1);
  assertEquals((await database.db.select().from(matchParticipants)).length, 10);
  assertEquals(discord.edits.at(-1)?.token, "button-12");
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(
      messageKeys.matchManagement.recordMatch.success,
    ),
  );
});
