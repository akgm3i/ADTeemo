import { eq } from "drizzle-orm";
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  DomainConflictError,
  MatchWatcherLimitError,
  RecordNotFoundError,
} from "../errors.ts";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";
import {
  customGameEventParticipants,
  customGameEvents,
  guilds,
  matches,
  matchParticipants,
  matchRankSnapshots,
  matchWatchers,
  pendingMatchRankSnapshots,
  riotAccounts,
  users,
} from "./schema.ts";

function riotAccount(discordId: string, puuid = `puuid-${discordId}`) {
  return {
    discordId,
    puuid,
    gameName: `Teemo-${discordId}`,
    tagLine: "JP1",
    platform: "jp1" as const,
    region: "asia" as const,
  };
}

function participant(
  userId: string,
  lane: "Top" | "Jungle" = "Top",
) {
  return {
    userId,
    team: lane === "Top" ? ("BLUE" as const) : ("RED" as const),
    win: lane === "Top",
    lane,
    kills: 1,
    deaths: 2,
    assists: 3,
    cs: 100,
    gold: 10_000,
  };
}

function eventPreparation(
  overrides: Partial<{
    operationKey: string;
    name: string;
    guildId: string;
    creatorId: string;
    recruitmentChannelId: string;
    voiceChannelId: string;
    scheduledStartAt: Date;
  }> = {},
) {
  return {
    operationKey: "interaction-1",
    name: "Custom Game",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  };
}

const eventRoster = [
  { userId: "user-1", lane: "Top" as const, team: "BLUE" as const },
  {
    userId: "user-2",
    lane: "Jungle" as const,
    team: "BLUE" as const,
  },
  { userId: "user-3", lane: "Middle" as const, team: "BLUE" as const },
  { userId: "user-4", lane: "Bottom" as const, team: "BLUE" as const },
  { userId: "user-5", lane: "Support" as const, team: "BLUE" as const },
  { userId: "user-6", lane: "Top" as const, team: "RED" as const },
  { userId: "user-7", lane: "Jungle" as const, team: "RED" as const },
  { userId: "user-8", lane: "Middle" as const, team: "RED" as const },
  { userId: "user-9", lane: "Bottom" as const, team: "RED" as const },
  { userId: "user-10", lane: "Support" as const, team: "RED" as const },
];

const eventMatchStats = eventRoster.map((entry, index) =>
  matchStats(entry.userId, index + 1)
);

function matchStats(userId: string, kills: number) {
  return {
    userId,
    kills,
    deaths: 2,
    assists: 3,
    cs: 100,
    gold: 10_000,
  };
}

async function prepareRecordableCustomGame(
  database: Awaited<ReturnType<typeof createMigratedTestDatabase>>,
) {
  const prepared = await database.actions.prepareCustomGameEvent(
    eventPreparation(),
  );
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
  for (const entry of eventRoster) {
    await database.actions.upsertRiotAccount(riotAccount(entry.userId));
  }
  return scope;
}

describe("migration適用済みSQLiteでのrepository integration", () => {
  test("同じoperation keyでイベント準備を再送すると、準備行を1件だけ作成して同じeventを返す", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const input = eventPreparation();

    // Act
    const first = await database.actions.prepareCustomGameEvent(input);
    const second = await database.actions.prepareCustomGameEvent(input);
    const saved = await database.db.select().from(customGameEvents);

    // Assert
    assertEquals(first.created, true);
    assertEquals(second.created, false);
    assertEquals(second.event.id, first.event.id);
    assertEquals(saved.length, 1);
    assertEquals(saved[0].phase, "PREPARING");
    assertEquals(saved[0].syncState, "CREATE_PENDING");
    assertEquals(saved[0].recruitmentChannelId, "channel-1");
  });

  test("ミリ秒を含む開始日時でイベント準備を再送すると、DBの秒精度で同じ入力と判定して二重作成しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const input = eventPreparation({
      scheduledStartAt: new Date("2026-08-01T10:00:00.123Z"),
    });

    // Act
    const first = await database.actions.prepareCustomGameEvent(input);
    const replay = await database.actions.prepareCustomGameEvent(input);

    // Assert
    assertEquals(first.created, true);
    assertEquals(replay.created, false);
    assertEquals(replay.event.id, first.event.id);
    assertEquals(
      replay.event.scheduledStartAt,
      new Date("2026-08-01T10:00:00.000Z"),
    );
    await assertRejects(
      () =>
        database.actions.prepareCustomGameEvent({
          ...input,
          scheduledStartAt: new Date("2026-08-01T10:00:01.123Z"),
        }),
      DomainConflictError,
    );
    assertEquals((await database.db.select().from(customGameEvents)).length, 1);
  });

  test("同じoperation keyを異なるイベント内容で再利用すると、既存準備行を変更せず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const first = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );

    // Act & Assert
    await assertRejects(() =>
      database.actions.prepareCustomGameEvent(
        eventPreparation({ name: "Different Game" }),
      )
    );
    const saved = await database.db.select().from(customGameEvents);
    assertEquals(saved.length, 1);
    assertEquals(saved[0].id, first.event.id);
    assertEquals(saved[0].name, "Custom Game");
  });

  test("外部IDを段階保存してイベントを確定するとRECRUITING・CONSISTENTになり、同じ更新の再送でも重複しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };

    // Act
    await database.actions.updateCustomGameEventCreationProgress({
      ...scope,
      discordScheduledEventId: "discord-event-1",
    });
    await database.actions.updateCustomGameEventCreationProgress({
      ...scope,
      recruitmentMessageId: "message-1",
    });
    const activated = await database.actions.activateCustomGameEvent(scope);
    const replay = await database.actions.activateCustomGameEvent(scope);

    // Assert
    assertEquals(activated.phase, "RECRUITING");
    assertEquals(activated.syncState, "CONSISTENT");
    assertEquals(replay, activated);
    assertEquals(activated.discordScheduledEventId, "discord-event-1");
    assertEquals(activated.recruitmentMessageId, "message-1");
  });

  test("別guildまたは別channelから同じevent IDを更新すると、状態を変更しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );

    // Act & Assert
    await assertRejects(() =>
      database.actions.updateCustomGameEventCreationProgress({
        eventId: prepared.event.id,
        guildId: "guild-other",
        recruitmentChannelId: "channel-1",
        discordScheduledEventId: "foreign-event",
      })
    );
    await assertRejects(() =>
      database.actions.updateCustomGameEventCreationProgress({
        eventId: prepared.event.id,
        guildId: "guild-1",
        recruitmentChannelId: "channel-other",
        discordScheduledEventId: "foreign-event",
      })
    );
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.discordScheduledEventId, null);
    assertEquals(saved.phase, "PREPARING");
    assertEquals(saved.syncState, "CREATE_PENDING");
  });

  test("外部IDが未確定で削除確認もできていない状況で作成失敗を記録すると、補償待ちを維持する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };

    // Act
    const pending = await database.actions.markCustomGameEventCreationFailed({
      ...scope,
      discordEventDeleted: false,
      recruitmentMessageDeleted: true,
      failureCode: "CREATE_DISCORD_EVENT_FAILED",
    });
    const compensated = await database.actions
      .markCustomGameEventCreationFailed({
        ...scope,
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "CREATE_DISCORD_EVENT_FAILED",
      });

    // Assert
    assertEquals(pending.phase, "PREPARING");
    assertEquals(pending.syncState, "CREATE_COMPENSATION_PENDING");
    assertEquals(compensated.phase, "CANCELLED");
    assertEquals(compensated.syncState, "CONSISTENT");
  });

  test("募集確定後に古い作成失敗を記録すると、状態を巻き戻さず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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

    // Act & Assert
    await assertRejects(() =>
      database.actions.markCustomGameEventCreationFailed({
        ...scope,
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "STALE_CREATION_FAILURE",
      })
    );
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.phase, "RECRUITING");
    assertEquals(saved.syncState, "CONSISTENT");
    assertEquals(saved.discordEventDeleted, false);
    assertEquals(saved.recruitmentMessageDeleted, false);
    assertEquals(saved.lastFailureCode, null);
  });

  test("作成失敗で保存済みと異なる外部IDを指定すると、外部IDを上書きせず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };
    await database.actions.updateCustomGameEventCreationProgress({
      ...scope,
      discordScheduledEventId: "discord-event-1",
    });

    // Act & Assert
    await assertRejects(() =>
      database.actions.markCustomGameEventCreationFailed({
        ...scope,
        discordScheduledEventId: "discord-event-other",
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "CHECKPOINT_DISCORD_EVENT_FAILED",
      })
    );
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.discordScheduledEventId, "discord-event-1");
    assertEquals(saved.phase, "PREPARING");
    assertEquals(saved.syncState, "CREATE_PENDING");
  });

  test("作成失敗が補償状態を先に確保した後で確定処理が到着すると、募集確定へ進めず補償状態を維持する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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

    // Act
    const claimed = await database.actions.markCustomGameEventCreationFailed({
      ...scope,
      discordScheduledEventId: "discord-event-1",
      recruitmentMessageId: "message-1",
      discordEventDeleted: false,
      recruitmentMessageDeleted: false,
      failureCode: "ADD_RECRUITMENT_REACTIONS_FAILED",
    });

    // Assert
    await assertRejects(() => database.actions.activateCustomGameEvent(scope));
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(claimed.phase, "PREPARING");
    assertEquals(claimed.syncState, "CREATE_COMPENSATION_PENDING");
    assertEquals(saved.phase, "PREPARING");
    assertEquals(saved.syncState, "CREATE_COMPENSATION_PENDING");
    assertEquals(saved.discordEventDeleted, false);
    assertEquals(saved.recruitmentMessageDeleted, false);
  });

  test("中止開始後に古い作成失敗を記録すると、中止状態を巻き戻さず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };
    await database.actions.beginCustomGameEventCancellation(scope);

    // Act & Assert
    await assertRejects(() =>
      database.actions.markCustomGameEventCreationFailed({
        ...scope,
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "STALE_CREATION_FAILURE",
      })
    );
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.phase, "PREPARING");
    assertEquals(saved.syncState, "CANCEL_PENDING");
    assertEquals(saved.discordEventDeleted, false);
    assertEquals(saved.recruitmentMessageDeleted, false);
  });

  test("キャンセルの各Discord削除を記録すると、両方完了した時だけCANCELLEDになる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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

    // Act
    const pending = await database.actions.beginCustomGameEventCancellation(
      scope,
    );
    const first = await database.actions
      .updateCustomGameEventCancellationProgress({
        ...scope,
        discordEventDeleted: true,
      });
    const completed = await database.actions
      .updateCustomGameEventCancellationProgress({
        ...scope,
        recruitmentMessageDeleted: true,
      });
    const replay = await database.actions.beginCustomGameEventCancellation(
      scope,
    );

    // Assert
    assertEquals(pending.syncState, "CANCEL_PENDING");
    assertEquals(first.syncState, "CANCEL_PENDING");
    assertEquals(completed.phase, "CANCELLED");
    assertEquals(completed.syncState, "CONSISTENT");
    assertEquals(replay.phase, "CANCELLED");
  });

  test("中止中に検索で回収した外部IDを保存すると、再試行先を保持して異なるIDへの変更を拒否する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };
    await database.actions.beginCustomGameEventCancellation(scope);

    // Act
    const checkpointed = await database.actions
      .updateCustomGameEventCancellationProgress({
        ...scope,
        discordScheduledEventId: "recovered-discord-event",
        recruitmentMessageId: "recovered-message",
      });

    // Assert
    assertEquals(
      checkpointed.discordScheduledEventId,
      "recovered-discord-event",
    );
    assertEquals(checkpointed.recruitmentMessageId, "recovered-message");
    await assertRejects(() =>
      database.actions.updateCustomGameEventCancellationProgress({
        ...scope,
        discordScheduledEventId: "different-discord-event",
      })
    );
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.discordScheduledEventId, "recovered-discord-event");
    assertEquals(saved.recruitmentMessageId, "recovered-message");
    assertEquals(saved.syncState, "CANCEL_PENDING");
  });

  test("作成途中で片方の外部IDだけ保存済みの状況でも、中止を開始して両リソースの不存在確認まで収束できる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
    const scope = {
      eventId: prepared.event.id,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };
    await database.actions.updateCustomGameEventCreationProgress({
      ...scope,
      discordScheduledEventId: "discord-event-1",
    });

    // Act
    const begun = await database.actions.beginCustomGameEventCancellation(
      scope,
    );
    const scheduledEventDeleted = await database.actions
      .updateCustomGameEventCancellationProgress({
        ...scope,
        discordEventDeleted: true,
      });
    const completed = await database.actions
      .updateCustomGameEventCancellationProgress({
        ...scope,
        recruitmentMessageDeleted: true,
      });

    // Assert
    assertEquals(begun.syncState, "CANCEL_PENDING");
    assertEquals(scheduledEventDeleted.phase, "PREPARING");
    assertEquals(scheduledEventDeleted.syncState, "CANCEL_PENDING");
    assertEquals(completed.phase, "CANCELLED");
    assertEquals(completed.syncState, "CONSISTENT");
  });

  test("確定チームを保存するとevent配下へ参加者を保持し、別guild・channelから取得できない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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

    // Act
    await database.actions.saveCustomGameEventParticipants({
      ...scope,
      participants: eventRoster,
    });
    const participants = await database.actions
      .getCustomGameEventParticipants(scope);

    // Assert
    const normalized = (
      entries: Array<{ userId: string; lane: string; team: string }>,
    ) =>
      entries.map((entry) => ({
        userId: entry.userId,
        lane: entry.lane,
        team: entry.team,
      })).toSorted((left, right) => left.userId.localeCompare(right.userId));
    assertEquals(normalized(participants), normalized(eventRoster));
    assertEquals(
      normalized(await database.db.select().from(customGameEventParticipants)),
      normalized(participants),
    );
    await assertRejects(() =>
      database.actions.getCustomGameEventParticipants({
        ...scope,
        guildId: "guild-other",
      })
    );
    await assertRejects(() =>
      database.actions.getCustomGameEventParticipants({
        ...scope,
        recruitmentChannelId: "channel-other",
      })
    );
  });

  test("実イベントの全参加者にcanonical Riot accountがあると、eventとgame sequenceをkeyに試合を1回だけ保存する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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
    for (const entry of eventRoster) {
      await database.actions.upsertRiotAccount(riotAccount(entry.userId));
    }
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };

    // Act
    const first = await database.actions.recordCustomMatch(input);
    const second = await database.actions.recordCustomMatch(input);
    const savedMatches = await database.db.select().from(matches);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(second.created, false);
    assertEquals(second.matchId, first.matchId);
    assertEquals(savedMatches.length, 1);
    assertEquals(savedMatches[0].customGameEventId, prepared.event.id);
    assertEquals(savedMatches[0].gameSequence, 1);
    assertEquals(savedParticipants.length, 10);
    assertEquals(
      savedParticipants.map((entry) => entry.riotPuuid).toSorted(),
      eventRoster.map((entry) => `puuid-${entry.userId}`).toSorted(),
    );
  });

  test("同じeventとgame sequenceへ同じ戦績を同時送信すると、1件だけ作成して片方は既存成功を返す", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };

    // Act
    const results = await Promise.all([
      database.actions.recordCustomMatch(input),
      database.actions.recordCustomMatch(input),
    ]);
    const savedMatches = await database.db.select().from(matches);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(
      results.map((result) => result.created).toSorted(),
      [false, true],
    );
    assertEquals(results[0].matchId, results[1].matchId);
    assertEquals(savedMatches.length, 1);
    assertEquals(savedParticipants.length, 10);
  });

  test("同じeventとgame sequenceへ異なる戦績を同時送信すると、片方だけ作成して片方は競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    const firstInput = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };
    const secondInput = {
      ...firstInput,
      stats: eventMatchStats.map((entry) =>
        entry.userId === "user-1" ? { ...entry, kills: 99 } : entry
      ),
    };

    // Act
    const results = await Promise.allSettled([
      database.actions.recordCustomMatch(firstInput),
      database.actions.recordCustomMatch(secondInput),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const savedMatches = await database.db.select().from(matches);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(fulfilled.length, 1);
    assertEquals(fulfilled[0].value.created, true);
    assertEquals(rejected.length, 1);
    assert(rejected[0].reason instanceof DomainConflictError);
    assertEquals(savedMatches.length, 1);
    assertEquals(savedParticipants.length, 10);
  });

  test("保存後にイベントを取り消しても、同じ戦績の再送は既存成功を返す", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };
    await database.actions.recordCustomMatch(input);
    await database.actions.beginCustomGameEventCancellation(scope);
    await database.actions.updateCustomGameEventCancellationProgress({
      ...scope,
      discordEventDeleted: true,
      recruitmentMessageDeleted: true,
    });

    // Act
    const replay = await database.actions.recordCustomMatch(input);

    // Assert
    assertEquals(replay.created, false);
    assertEquals(replay.matchId, `custom:${scope.eventId}:1`);
    assertEquals(replay.participantCount, 10);
  });

  test("保存後にイベントを取り消して異なる戦績を再送すると、既存試合を変更せず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };
    await database.actions.recordCustomMatch(input);
    await database.actions.beginCustomGameEventCancellation(scope);
    await database.actions.updateCustomGameEventCancellationProgress({
      ...scope,
      discordEventDeleted: true,
      recruitmentMessageDeleted: true,
    });

    // Act & Assert
    await assertRejects(
      () =>
        database.actions.recordCustomMatch({
          ...input,
          winner: "RED",
        }),
      DomainConflictError,
    );
    const saved = await database.db.select().from(matchParticipants);
    assertEquals(
      saved.every((participant) =>
        participant.win === (participant.team === "BLUE")
      ),
      true,
    );
  });

  test("参加者のcanonical Riot accountが1件でもないと、matchとparticipantを残さない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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
    await database.actions.upsertRiotAccount(riotAccount("user-1"));

    // Act & Assert
    await assertRejects(() =>
      database.actions.recordCustomMatch({
        ...scope,
        gameSequence: 1,
        winner: "BLUE",
        stats: eventMatchStats,
      })
    );
    assertEquals(await database.db.select().from(matches), []);
    assertEquals(await database.db.select().from(matchParticipants), []);
  });

  test("決定的match IDが既存行と衝突する状況で記録すると、participantを1件も追加しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    const matchId = `custom:${scope.eventId}:1`;
    await database.db.insert(matches).values({ id: matchId }).execute();

    // Act & Assert
    await assertRejects(() =>
      database.actions.recordCustomMatch({
        ...scope,
        gameSequence: 1,
        winner: "BLUE",
        stats: eventMatchStats,
      })
    );
    assertEquals(await database.db.select().from(matchParticipants), []);
    const savedMatches = await database.db.select().from(matches);
    assertEquals(savedMatches.length, 1);
    assertEquals(savedMatches[0].id, matchId);
    assertEquals(savedMatches[0].customGameEventId, null);
  });

  test("任意participantのinsertでDB errorになる状況で記録すると、matchを含む全行をrollbackして再試行できる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const scope = await prepareRecordableCustomGame(database);
    await database.client.execute(`
      CREATE TRIGGER reject_custom_match_participant
      BEFORE INSERT ON match_participants
      WHEN NEW.user_id = 'user-5'
      BEGIN
        SELECT RAISE(ABORT, 'injected participant failure');
      END
    `);
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };

    // Act & Assert
    await assertRejects(() => database.actions.recordCustomMatch(input));
    assertEquals(await database.db.select().from(matches), []);
    assertEquals(await database.db.select().from(matchParticipants), []);

    await database.client.execute(
      "DROP TRIGGER reject_custom_match_participant",
    );
    const retried = await database.actions.recordCustomMatch(input);
    assertEquals(retried.created, true);
    assertEquals((await database.db.select().from(matches)).length, 1);
    assertEquals(
      (await database.db.select().from(matchParticipants)).length,
      10,
    );
  });

  test("保存後にRiot accountを再リンクしても、同じeventとgameと入力の再送は既存snapshotを返す", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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
    for (const entry of eventRoster) {
      await database.actions.upsertRiotAccount(riotAccount(entry.userId));
    }
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };
    await database.actions.recordCustomMatch(input);
    await database.actions.upsertRiotAccount(
      riotAccount("user-1", "puuid-user-1-relinked"),
    );

    // Act
    const replay = await database.actions.recordCustomMatch(input);
    const saved = await database.db.select().from(matchParticipants);

    // Assert
    assertEquals(replay.created, false);
    assertEquals(saved.length, 10);
    assertEquals(
      saved.find((entry) => entry.userId === "user-1")?.riotPuuid,
      "puuid-user-1",
    );
  });

  test("同じeventとgame sequenceへ異なる戦績を再送すると、既存試合を変更せず競合にする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const prepared = await database.actions.prepareCustomGameEvent(
      eventPreparation(),
    );
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
    for (const entry of eventRoster) {
      await database.actions.upsertRiotAccount(riotAccount(entry.userId));
    }
    const input = {
      ...scope,
      gameSequence: 1,
      winner: "BLUE" as const,
      stats: eventMatchStats,
    };
    await database.actions.recordCustomMatch(input);

    // Act & Assert
    await assertRejects(() =>
      database.actions.recordCustomMatch({
        ...input,
        stats: eventMatchStats.map((entry) =>
          entry.userId === "user-1" ? { ...entry, kills: 99 } : entry
        ),
      })
    );
    const saved = await database.db.select().from(matchParticipants);
    assertEquals(saved.find((entry) => entry.userId === "user-1")?.kills, 1);
  });

  test("2つのharnessを並列に作成して更新すると、DB状態を共有しない", async () => {
    // Arrange
    await using databaseA = await createMigratedTestDatabase();
    await using databaseB = await createMigratedTestDatabase();

    // Act
    await Promise.all([
      databaseA.actions.upsertUser("user-a"),
      databaseB.actions.upsertUser("user-b"),
    ]);
    const [usersA, usersB] = await Promise.all([
      databaseA.db.select().from(users),
      databaseB.db.select().from(users),
    ]);

    // Assert
    assertEquals(usersA.map((user) => user.discordId), ["user-a"]);
    assertEquals(usersB.map((user) => user.discordId), ["user-b"]);
  });

  test("同じcanonical Riot accountを再upsertすると、unique identityを増やさず表示情報を更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(riotAccount("user-1"));
    const initialUser = await database.db.query.users.findFirst();

    // Act
    await database.actions.upsertRiotAccount({
      ...riotAccount("user-1"),
      gameName: "RenamedTeemo",
      tagLine: "NEW",
    });
    const accounts = await database.db.select().from(riotAccounts);
    const [user] = await database.db.select().from(users);

    // Assert
    assertEquals(accounts.length, 1);
    assertEquals(accounts[0].discordId, "user-1");
    assertEquals(accounts[0].puuid, "puuid-user-1");
    assertEquals(accounts[0].gameName, "RenamedTeemo");
    assertEquals(accounts[0].tagLine, "NEW");
    // Canonical identity lives only in riot_accounts; the retired users column
    // cannot represent multiple accounts and must not become a second source.
    assertEquals(user.riotId, null);
    assertEquals(user.updatedAt, initialUser?.updatedAt);
    assert(accounts[0].updatedAt instanceof Date);
  });

  test("legacy Riot IDを既存ユーザーへ再リンクすると、値とupdatedAtを実DBで更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.linkUserWithRiotId("user-1", "puuid-before");

    // Act
    await database.actions.linkUserWithRiotId("user-1", "puuid-after");
    const saved = await database.db.query.users.findFirst({
      where: eq(users.discordId, "user-1"),
    });

    // Assert
    assertEquals(saved?.riotId, "puuid-after");
    assert(saved?.updatedAt instanceof Date);
  });

  test("同じcreatorとtargetを別guild・channelへ保存すると、取得とcascadeがguild境界を越えない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(riotAccount("target-1"));
    await database.actions.createCustomGameEvent({
      name: "Guild A event",
      guildId: "guild-a",
      creatorId: "target-1",
      discordScheduledEventId: "event-a",
      recruitmentMessageId: "message-a",
      scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
    });
    await database.actions.createCustomGameEvent({
      name: "Guild B event",
      guildId: "guild-b",
      creatorId: "target-1",
      discordScheduledEventId: "event-b",
      recruitmentMessageId: "message-b",
      scheduledStartAt: new Date("2026-08-02T10:00:00.000Z"),
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-a",
      targetDiscordId: "target-1",
      requesterId: "requester-a",
      channelId: "channel-a",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-b",
      targetDiscordId: "target-1",
      requesterId: "requester-b",
      channelId: "channel-b",
    });

    // Act
    const guildAWatchers = await database.actions
      .getEnabledMatchWatchersByGuild("guild-a");
    await database.db.delete(guilds).where(eq(guilds.id, "guild-a"));
    const remainingEvents = await database.db.select().from(customGameEvents);
    const remainingWatchers = await database.db.select().from(matchWatchers);

    // Assert
    assertEquals(guildAWatchers.map((watcher) => watcher.channelId), [
      "channel-a",
    ]);
    assertEquals(remainingEvents.map((event) => event.guildId), ["guild-b"]);
    assertEquals(
      remainingWatchers.map((watcher) => ({
        guildId: watcher.guildId,
        channelId: watcher.channelId,
      })),
      [{ guildId: "guild-b", channelId: "channel-b" }],
    );
  });

  test("親recordがないeventを直接保存すると、foreign key違反になり次のrepository操作は成功する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();

    // Act & Assert
    await assertRejects(() =>
      database.db.insert(customGameEvents).values({
        name: "orphan event",
        guildId: "missing-guild",
        creatorId: "missing-user",
        discordScheduledEventId: "orphan-event",
        recruitmentMessageId: "orphan-message",
        scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
      }).execute()
    );
    await database.actions.upsertUser("user-after-fk-error");
    const saved = await database.db.query.users.findFirst({
      where: eq(users.discordId, "user-after-fk-error"),
    });
    assertEquals(saved?.discordId, "user-after-fk-error");
  });

  test("pending rank snapshotを保存すると、TTLをDB状態へ反映し次回操作で期限切れだけを削除する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase({
      pendingRankSnapshotTtlMs: 1_000,
    });
    const expiredFetchedAt = new Date("2026-01-01T00:00:00.000Z");
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "expired-game",
      puuid: "expired-puuid",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 2,
        wins: 10,
        losses: 8,
        fetchedAt: expiredFetchedAt,
      }],
    });
    const expired = await database.db.query.pendingMatchRankSnapshots
      .findFirst();

    // Act
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "active-game",
      puuid: "active-puuid",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "IV",
        leaguePoints: 10,
        wins: 20,
        losses: 10,
        fetchedAt: new Date("2099-01-01T00:00:00.000Z"),
      }],
    });
    const remaining = await database.db.select().from(
      pendingMatchRankSnapshots,
    );

    // Assert
    assertEquals(
      expired?.expiresAt,
      new Date("2026-01-01T00:00:01.000Z"),
    );
    assertEquals(remaining.map((snapshot) => snapshot.gameId), [
      "active-game",
    ]);
  });

  test("pending snapshotを試合へ確定して再実行すると、保存済みbeforeを再利用しafterだけを更新する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertPendingRankSnapshots({
      platform: "jp1",
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 2,
        wins: 10,
        losses: 8,
        fetchedAt: new Date("2099-01-01T00:00:00.000Z"),
      }],
    });
    const input = {
      matchId: "JP1_12345",
      platform: "jp1" as const,
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5" as const,
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
        fetchedAt: new Date("2099-01-01T00:10:00.000Z"),
      }],
    };
    const first = await database.actions.finalizeMatchRankSnapshots(input);

    // Act
    const second = await database.actions.finalizeMatchRankSnapshots({
      ...input,
      snapshots: [{ ...input.snapshots[0], leaguePoints: 21 }],
    });
    const saved = await database.db.select().from(matchRankSnapshots);

    // Assert
    assertEquals(first.before.length, 1);
    assertEquals(second.before, first.before);
    assertEquals(second.after[0].leaguePoints, 21);
    assertEquals(saved.length, 2);
  });

  test("監視上限を超えてwatcherを追加すると、errorを返してtransaction内の途中recordも残さない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase({
      matchWatcherMaxEnabledPerGuild: 1,
    });
    await database.actions.upsertRiotAccount(riotAccount("target-1"));
    await database.actions.upsertRiotAccount(riotAccount("target-2"));
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      requesterId: "requester-1",
      channelId: "channel-1",
    });

    // Act & Assert
    await assertRejects(
      () =>
        database.actions.upsertMatchWatcher({
          guildId: "guild-1",
          targetDiscordId: "target-2",
          requesterId: "requester-rolled-back",
          channelId: "channel-2",
        }),
      MatchWatcherLimitError,
    );
    const watchers = await database.actions.getEnabledMatchWatchersByGuild(
      "guild-1",
    );
    const rolledBackRequester = await database.db.query.users.findFirst({
      where: eq(users.discordId, "requester-rolled-back"),
    });
    assertEquals(watchers.map((watcher) => watcher.targetDiscordId), [
      "target-1",
    ]);
    assertEquals(rolledBackRequester, undefined);
  });

  test("matchと全participantを保存して同じmatchを再送すると、1回分だけcommitする", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    await database.actions.upsertUser("user-2");
    const input = {
      matchId: "match-1",
      participants: [
        participant("user-1", "Top"),
        participant("user-2", "Jungle"),
      ],
    };

    // Act
    const first = await database.actions.createMatchWithParticipants(input);
    const second = await database.actions.createMatchWithParticipants(input);
    const savedMatches = await database.db.select().from(matches);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(second.created, false);
    assertEquals(savedMatches.map((match) => match.id), ["match-1"]);
    assertEquals(
      savedParticipants.map((savedParticipant) => savedParticipant.userId)
        .toSorted(),
      ["user-1", "user-2"],
    );
  });

  test("別処理でmatch行だけが作成済みでも、全participantを保存して再送時は重複しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    await database.actions.upsertUser("user-2");
    await database.actions.upsertExternalMatchDetail({
      matchId: "match-existing",
      provider: "opgg",
      providerRegion: "jp",
      providerMatchId: "existing",
      detailUrl: "https://example.com/matches/existing",
      providerCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
      averageTier: null,
    });
    const input = {
      matchId: "match-existing",
      participants: [
        participant("user-1", "Top"),
        participant("user-2", "Jungle"),
      ],
    };

    // Act
    const first = await database.actions.createMatchWithParticipants(input);
    const second = await database.actions.createMatchWithParticipants(input);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(first.participants.length, 2);
    assertEquals(second.created, false);
    assertEquals(savedParticipants.length, 2);
  });

  test("単体participantだけが保存済みのmatchへ全participantを保存すると、不足分だけ追加して再送時は重複しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    await database.actions.upsertUser("user-2");
    await database.db.insert(matches).values({ id: "match-partial" });
    await database.actions.createMatchParticipant({
      matchId: "match-partial",
      ...participant("user-1", "Top"),
    });
    const input = {
      matchId: "match-partial",
      participants: [
        participant("user-1", "Top"),
        participant("user-2", "Jungle"),
      ],
    };

    // Act
    const first = await database.actions.createMatchWithParticipants(input);
    const second = await database.actions.createMatchWithParticipants(input);
    const savedParticipants = await database.db.select().from(
      matchParticipants,
    );

    // Assert
    assertEquals(first.created, true);
    assertEquals(
      first.participants.map((savedParticipant) => savedParticipant.userId)
        .toSorted(),
      ["user-1", "user-2"],
    );
    assertEquals(second.created, false);
    assertEquals(
      savedParticipants.map((savedParticipant) => savedParticipant.userId)
        .toSorted(),
      ["user-1", "user-2"],
    );
  });

  test("同じuserIdを複数participantとして保存すると、入力を拒否してmatchもparticipantも作成しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    const input = {
      matchId: "match-duplicate-user",
      participants: [
        participant("user-1", "Top"),
        participant("user-1", "Jungle"),
      ],
    };

    // Act & Assert
    await assertRejects(() =>
      database.actions.createMatchWithParticipants(input)
    );
    assertEquals(
      await database.db.select().from(matches).where(
        eq(matches.id, input.matchId),
      ),
      [],
    );
    assertEquals(
      await database.db.select().from(matchParticipants),
      [],
    );
  });

  test("participant一括保存でforeign key違反になると、matchを含めてrollbackし次のtransactionを実行できる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertUser("user-1");
    const input = {
      matchId: "match-rollback",
      participants: [
        participant("user-1", "Top"),
        participant("missing-user", "Jungle"),
      ],
    };

    // Act & Assert
    await assertRejects(() =>
      database.actions.createMatchWithParticipants(input)
    );
    assertEquals(
      await database.db.select().from(matches).where(
        eq(matches.id, input.matchId),
      ),
      [],
    );
    assertEquals(
      await database.db.select().from(matchParticipants),
      [],
    );

    await database.actions.upsertUser("missing-user");
    const retried = await database.actions.createMatchWithParticipants(input);
    assertEquals(retried.created, true);
    assertEquals(retried.participants.length, 2);
  });

  test("単体participant保存時、not foundは専用errorにしDB failureとは区別する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.db.insert(matches).values({ id: "match-1" });

    // Act & Assert
    await assertRejects(
      () =>
        database.actions.createMatchParticipant({
          matchId: "match-1",
          ...participant("missing-user"),
        }),
      RecordNotFoundError,
    );

    await database.actions.upsertUser("user-1");
    await database.client.execute("DROP TABLE match_participants");
    const databaseError = await assertRejects(() =>
      database.actions.createMatchParticipant({
        matchId: "match-1",
        ...participant("user-1"),
      })
    );
    assertFalse(databaseError instanceof RecordNotFoundError);
  });
});
