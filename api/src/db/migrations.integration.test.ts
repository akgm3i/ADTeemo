import { migrate } from "drizzle-orm/libsql/migrator";
import { is } from "drizzle-orm";
import {
  type AnySQLiteTable,
  getTableConfig,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { join, toFileUrl } from "@std/path";
import {
  createMigratedTestDatabase,
  migrationsFolder,
} from "./integration_test_harness.ts";
import { createDb, type DatabaseConnection } from "./index.ts";
import * as schema from "./schema.ts";

const applicationTables = (Object.values(schema) as unknown[]).filter(
  (value): value is AnySQLiteTable => is(value, SQLiteTable),
);

function sorted(values: string[]) {
  return values.toSorted((left, right) => left.localeCompare(right));
}

type PreCustomGameConsistencyDatabase =
  & Pick<
    DatabaseConnection,
    "client" | "db"
  >
  & {
    dispose: () => Promise<void>;
    [Symbol.asyncDispose]: () => Promise<void>;
  };

async function createPreCustomGameConsistencyDatabase(beforeIndex = 6): Promise<
  PreCustomGameConsistencyDatabase
> {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "adteemo-pre-custom-game-consistency-",
  });
  const legacyMigrationsFolder = join(temporaryDirectory, "migrations");
  const databasePath = join(temporaryDirectory, "database.sqlite");
  const connection = createDb({
    url: toFileUrl(databasePath).href,
    logger: false,
  });
  let disposed = false;

  const dispose = async () => {
    if (disposed) return;
    disposed = true;

    try {
      connection.close();
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  };

  try {
    const journal = JSON.parse(
      await Deno.readTextFile(join(migrationsFolder, "meta", "_journal.json")),
    ) as {
      entries: Array<{ idx: number; tag: string }>;
      [key: string]: unknown;
    };
    const legacyEntries = journal.entries.filter((entry) =>
      entry.idx < beforeIndex
    );

    await Deno.mkdir(join(legacyMigrationsFolder, "meta"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(legacyMigrationsFolder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: legacyEntries }),
    );
    for (const entry of legacyEntries) {
      await Deno.copyFile(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(legacyMigrationsFolder, `${entry.tag}.sql`),
      );
    }

    await migrate(connection.db, {
      migrationsFolder: legacyMigrationsFolder,
    });
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    client: connection.client,
    db: connection.db,
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}

async function seedLegacyCustomGameData(
  client: DatabaseConnection["client"],
  {
    duplicateParticipant = false,
    duplicateRecruitmentMessage = false,
  } = {},
) {
  await client.execute(
    "INSERT INTO guilds (id, created_at) VALUES ('guild-1', 1700000000)",
  );
  await client.execute(
    "INSERT INTO users (discord_id, created_at) VALUES ('creator-1', 1700000000)",
  );
  await client.execute(`
    INSERT INTO custom_game_events (
      id,
      name,
      guild_id,
      creator_id,
      discord_scheduled_event_id,
      recruitment_message_id,
      scheduled_start_at,
      created_at
    ) VALUES (
      41,
      'legacy custom game',
      'guild-1',
      'creator-1',
      'discord-event-1',
      'discord-message-1',
      1700003600,
      1700000000
    )
  `);

  if (duplicateRecruitmentMessage) {
    await client.execute(`
      INSERT INTO custom_game_events (
        id,
        name,
        guild_id,
        creator_id,
        discord_scheduled_event_id,
        recruitment_message_id,
        scheduled_start_at,
        created_at
      ) VALUES (
        42,
        'legacy custom game duplicate message',
        'guild-1',
        'creator-1',
        'discord-event-2',
        'discord-message-1',
        1700005400,
        1700000100
      )
    `);
  }

  await client.execute(
    "INSERT INTO matches (id, created_at) VALUES ('legacy-match-1', 1700007200)",
  );
  await client.execute(`
    INSERT INTO match_participants (
      match_id,
      user_id,
      team,
      win,
      lane,
      kills,
      deaths,
      assists,
      cs,
      gold
    ) VALUES (
      'legacy-match-1',
      'creator-1',
      'BLUE',
      1,
      'TOP',
      5,
      2,
      7,
      180,
      12000
    )
  `);

  if (duplicateParticipant) {
    await client.execute(`
      INSERT INTO match_participants (
        match_id,
        user_id,
        team,
        win,
        lane,
        kills,
        deaths,
        assists,
        cs,
        gold
      ) VALUES (
        'legacy-match-1',
        'creator-1',
        'RED',
        0,
        'MID',
        1,
        8,
        3,
        90,
        7000
      )
    `);
  }
}

describe("SQLite migrations", () => {
  test("production DB factoryでmigrationを適用すると、foreign key enforcementが有効である", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();

    // Act
    const foreignKeySettings = await database.client.execute(
      "PRAGMA foreign_keys",
    );

    // Assert
    assertEquals(
      Number(foreignKeySettings.rows[0]?.foreign_keys),
      1,
    );
  });

  test("空の一時SQLite DBへ全migrationを適用すると、journalの全entryが記録され再適用しても重複しない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const journal = JSON.parse(
      await Deno.readTextFile(
        new URL("../../../drizzle/meta/_journal.json", import.meta.url),
      ),
    ) as { entries: unknown[] };

    // Act
    await migrate(database.db, { migrationsFolder });
    const applied = await database.client.execute(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
    );

    // Assert
    assertEquals(applied.rows.length, journal.entries.length);
  });

  test("全migrationを適用したとき、schema定義とtable・column・index・foreign keyが一致する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const expectedTables = applicationTables.map((table) =>
      getTableConfig(table).name
    );

    // Act
    const tableRows = await database.client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != '__drizzle_migrations'
      ORDER BY name
    `);
    const indexRows = await database.client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND sql IS NOT NULL
        AND tbl_name != '__drizzle_migrations'
      ORDER BY name
    `);

    // Assert
    assertEquals(
      tableRows.rows.map((row) => String(row.name)),
      sorted(expectedTables),
    );

    const expectedIndexes = applicationTables.flatMap((table) => {
      const config = getTableConfig(table);
      return [
        ...config.indexes.map((index) => index.config.name),
        ...config.columns.flatMap((column) =>
          column.isUnique && column.uniqueName ? [column.uniqueName] : []
        ),
      ];
    });
    assertEquals(
      indexRows.rows.map((row) => String(row.name)),
      sorted(expectedIndexes),
    );

    for (const table of applicationTables) {
      const config = getTableConfig(table);
      const columns = await database.client.execute(
        `PRAGMA table_info("${config.name}")`,
      );
      assertEquals(
        sorted(columns.rows.map((row) => String(row.name))),
        sorted(config.columns.map((column) => column.name)),
        `${config.name}のcolumnがschema定義と一致しません`,
      );

      const foreignKeys = await database.client.execute(
        `PRAGMA foreign_key_list("${config.name}")`,
      );
      const actualForeignKeys = foreignKeys.rows.map((row) => ({
        from: String(row.from),
        onDelete: String(row.on_delete).toLowerCase(),
        onUpdate: String(row.on_update).toLowerCase(),
        table: String(row.table),
        to: String(row.to),
      })).toSorted((left, right) => left.from.localeCompare(right.from));
      const expectedForeignKeys = config.foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        return reference.columns.map((column, index) => ({
          from: column.name,
          onDelete: foreignKey.onDelete ?? "no action",
          onUpdate: foreignKey.onUpdate ?? "no action",
          table: getTableConfig(reference.foreignTable).name,
          to: reference.foreignColumns[index].name,
        }));
      }).toSorted((left, right) => left.from.localeCompare(right.from));
      assertEquals(
        actualForeignKeys,
        expectedForeignKeys,
        `${config.name}のforeign keyがschema定義と一致しません`,
      );
    }
  });

  test("旧schemaのカスタムゲーム戦績を含むDBへmigrationを適用すると、既存値を保持して新しい整合性列を安全な初期値で追加する", async () => {
    // Arrange
    await using database = await createPreCustomGameConsistencyDatabase();
    await seedLegacyCustomGameData(database.client);

    // Act
    await migrate(database.db, { migrationsFolder });
    const event = await database.client.execute(`
      SELECT
        id,
        name,
        guild_id,
        creator_id,
        operation_key,
        recruitment_channel_id,
        voice_channel_id,
        discord_scheduled_event_id,
        recruitment_message_id,
        phase,
        sync_state,
        revision,
        discord_event_deleted,
        recruitment_message_deleted,
        last_failure_code,
        scheduled_start_at,
        created_at,
        updated_at
      FROM custom_game_events
      WHERE id = 41
    `);
    const match = await database.client.execute(`
      SELECT id, custom_game_event_id, game_sequence, created_at
      FROM matches
      WHERE id = 'legacy-match-1'
    `);
    const participant = await database.client.execute(`
      SELECT
        match_id,
        user_id,
        riot_puuid,
        team,
        win,
        lane,
        kills,
        deaths,
        assists,
        cs,
        gold
      FROM match_participants
      WHERE match_id = 'legacy-match-1'
    `);
    const foreignKeyViolations = await database.client.execute(
      "PRAGMA foreign_key_check",
    );

    // Assert
    assertEquals(
      event.rows.map((row) => ({
        id: row.id,
        name: row.name,
        guild_id: row.guild_id,
        creator_id: row.creator_id,
        operation_key: row.operation_key,
        recruitment_channel_id: row.recruitment_channel_id,
        voice_channel_id: row.voice_channel_id,
        discord_scheduled_event_id: row.discord_scheduled_event_id,
        recruitment_message_id: row.recruitment_message_id,
        phase: row.phase,
        sync_state: row.sync_state,
        revision: row.revision,
        discord_event_deleted: row.discord_event_deleted,
        recruitment_message_deleted: row.recruitment_message_deleted,
        last_failure_code: row.last_failure_code,
        scheduled_start_at: row.scheduled_start_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      [{
        id: 41,
        name: "legacy custom game",
        guild_id: "guild-1",
        creator_id: "creator-1",
        operation_key: null,
        recruitment_channel_id: null,
        voice_channel_id: null,
        discord_scheduled_event_id: "discord-event-1",
        recruitment_message_id: "discord-message-1",
        phase: "RECRUITING",
        sync_state: "CONSISTENT",
        revision: 0,
        discord_event_deleted: 0,
        recruitment_message_deleted: 0,
        last_failure_code: null,
        scheduled_start_at: 1700003600,
        created_at: 1700000000,
        updated_at: null,
      }],
    );
    assertEquals(
      match.rows.map((row) => ({
        id: row.id,
        custom_game_event_id: row.custom_game_event_id,
        game_sequence: row.game_sequence,
        created_at: row.created_at,
      })),
      [{
        id: "legacy-match-1",
        custom_game_event_id: null,
        game_sequence: null,
        created_at: 1700007200,
      }],
    );
    assertEquals(
      participant.rows.map((row) => ({
        match_id: row.match_id,
        user_id: row.user_id,
        riot_puuid: row.riot_puuid,
        team: row.team,
        win: row.win,
        lane: row.lane,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        cs: row.cs,
        gold: row.gold,
      })),
      [{
        match_id: "legacy-match-1",
        user_id: "creator-1",
        riot_puuid: null,
        team: "BLUE",
        win: 1,
        lane: "TOP",
        kills: 5,
        deaths: 2,
        assists: 7,
        cs: 180,
        gold: 12000,
      }],
    );
    assertEquals(foreignKeyViolations.rows, []);
  });

  test("旧schemaに同一試合・ユーザーの重複戦績があるとmigration全体をrollbackして手動解消を要求する", async () => {
    // Arrange
    await using database = await createPreCustomGameConsistencyDatabase();
    await seedLegacyCustomGameData(database.client, {
      duplicateParticipant: true,
    });

    // Act
    await assertRejects(
      () => migrate(database.db, { migrationsFolder }),
      Error,
    );
    const eventColumns = await database.client.execute(
      'PRAGMA table_info("custom_game_events")',
    );
    const participantColumns = await database.client.execute(
      'PRAGMA table_info("match_participants")',
    );
    const participantRows = await database.client.execute(`
      SELECT id
      FROM match_participants
      WHERE match_id = 'legacy-match-1'
        AND user_id = 'creator-1'
      ORDER BY id
    `);
    const newEventParticipantTable = await database.client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'custom_game_event_participants'
    `);
    const migrationJournal = await database.client.execute(
      "SELECT created_at FROM __drizzle_migrations ORDER BY created_at",
    );
    const foreignKeySettings = await database.client.execute(
      "PRAGMA foreign_keys",
    );

    // Assert
    assertEquals(
      eventColumns.rows.some((row) => row.name === "operation_key"),
      false,
    );
    assertEquals(
      participantColumns.rows.some((row) => row.name === "riot_puuid"),
      false,
    );
    assertEquals(participantRows.rows.length, 2);
    assertEquals(newEventParticipantTable.rows, []);
    assertEquals(migrationJournal.rows.length, 4);
    assertEquals(Number(foreignKeySettings.rows[0]?.foreign_keys), 1);
  });

  test("旧schemaで複数イベントが同じ募集メッセージを参照しているとmigration全体をrollbackして手動解消を要求する", async () => {
    // Arrange
    await using database = await createPreCustomGameConsistencyDatabase();
    await seedLegacyCustomGameData(database.client, {
      duplicateRecruitmentMessage: true,
    });

    // Act
    await assertRejects(
      () => migrate(database.db, { migrationsFolder }),
      Error,
    );
    const eventColumns = await database.client.execute(
      'PRAGMA table_info("custom_game_events")',
    );
    const eventRows = await database.client.execute(`
      SELECT id, recruitment_message_id
      FROM custom_game_events
      WHERE recruitment_message_id = 'discord-message-1'
      ORDER BY id
    `);
    const participantColumns = await database.client.execute(
      'PRAGMA table_info("match_participants")',
    );
    const newEventParticipantTable = await database.client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'custom_game_event_participants'
    `);
    const migrationJournal = await database.client.execute(
      "SELECT created_at FROM __drizzle_migrations ORDER BY created_at",
    );
    const foreignKeySettings = await database.client.execute(
      "PRAGMA foreign_keys",
    );

    // Assert
    assertEquals(
      eventColumns.rows.some((row) => row.name === "operation_key"),
      false,
    );
    assertEquals(
      eventRows.rows.map((row) => ({
        id: row.id,
        recruitment_message_id: row.recruitment_message_id,
      })),
      [
        { id: 41, recruitment_message_id: "discord-message-1" },
        { id: 42, recruitment_message_id: "discord-message-1" },
      ],
    );
    assertEquals(
      participantColumns.rows.some((row) => row.name === "riot_puuid"),
      false,
    );
    assertEquals(newEventParticipantTable.rows, []);
    assertEquals(migrationJournal.rows.length, 4);
    assertEquals(Number(foreignKeySettings.rows[0]?.foreign_keys), 1);
  });

  test("単一account時代のwatcherを移行すると、main・進行中状態・本人停止と通知先を保持する", async () => {
    await using database = await createPreCustomGameConsistencyDatabase(9);
    await database.client.execute(
      "INSERT INTO guilds (id, created_at) VALUES ('guild', 1700000000)",
    );
    for (const [owner, enabled] of [["owner", 1], ["opted", 0]] as const) {
      await database.client.execute({
        sql:
          "INSERT INTO users (discord_id, created_at) VALUES (?, 1700000000)",
        args: [owner],
      });
      await database.client.execute({
        sql:
          "INSERT INTO riot_accounts (discord_id, puuid, game_name, tag_line, platform, region, created_at) VALUES (?, ?, 'Teemo', 'JP1', 'jp1', 'asia', 1700000000)",
        args: [owner, `puuid-${owner}`],
      });
      await database.client.execute({
        sql:
          "INSERT INTO match_watchers (guild_id, target_discord_id, requester_id, channel_id, enabled, last_state, current_game_id, current_notification_message_id, created_at) VALUES ('guild', ?, ?, 'channel', ?, 'IN_GAME', 'game', 'message', 1700000000)",
        args: [owner, owner, enabled],
      });
    }
    await migrate(database.db, { migrationsFolder });
    const accounts = await database.client.execute(
      "SELECT discord_id, puuid, is_main FROM riot_accounts ORDER BY discord_id",
    );
    assertEquals(
      accounts.rows.map((row) => [row.discord_id, row.puuid, row.is_main]),
      [["opted", "puuid-opted", 1], ["owner", "puuid-owner", 1]],
    );
    const watchers = await database.client.execute(
      "SELECT riot_account_puuid, enabled, last_state, current_game_id, current_notification_message_id FROM match_watchers ORDER BY target_discord_id",
    );
    assertEquals(
      watchers.rows.map((
        row,
      ) => [
        row.riot_account_puuid,
        row.enabled,
        row.last_state,
        row.current_game_id,
        row.current_notification_message_id,
      ]),
      [["puuid-opted", 0, "IN_GAME", "game", "message"], [
        "puuid-owner",
        1,
        "IN_GAME",
        "game",
        "message",
      ]],
    );
    assertEquals(
      (await database.client.execute(
        "SELECT target_discord_id FROM match_watcher_opt_outs",
      )).rows.map((row) => row.target_discord_id),
      ["opted"],
    );
    assertEquals(
      (await database.client.execute(
        "SELECT enabled, notification_channel_id FROM guild_match_watch_settings",
      )).rows.map((row) => [row.enabled, row.notification_channel_id]),
      [[1, "channel"]],
    );
    assertEquals(
      (await database.client.execute("PRAGMA foreign_key_check")).rows,
      [],
    );
  });

  test("旧accountでPUUIDが別Discordユーザーに重複すると、自動で所有者を決めず移行全体をrollbackする", async () => {
    await using database = await createPreCustomGameConsistencyDatabase(9);
    for (const owner of ["first", "second"]) {
      await database.client.execute({
        sql:
          "INSERT INTO users (discord_id, created_at) VALUES (?, 1700000000)",
        args: [owner],
      });
      await database.client.execute({
        sql:
          "INSERT INTO riot_accounts (discord_id, puuid, game_name, tag_line, platform, region, created_at) VALUES (?, 'duplicate', 'Teemo', 'JP1', 'jp1', 'asia', 1700000000)",
        args: [owner],
      });
    }
    await assertRejects(
      () => migrate(database.db, { migrationsFolder }),
      Error,
    );
    assertEquals(
      (await database.client.execute(
        "SELECT discord_id FROM riot_accounts ORDER BY discord_id",
      )).rows.map((row) => row.discord_id),
      ["first", "second"],
    );
    assertEquals(
      (await database.client.execute("PRAGMA table_info('riot_accounts')")).rows
        .some((row) => row.name === "is_main"),
      false,
    );
    assertEquals(
      (await database.client.execute("PRAGMA foreign_keys")).rows[0]
        .foreign_keys,
      1,
    );
  });

  test("一時SQLite DBを破棄すると、native clientを閉じてtemp fileを削除する", async () => {
    // Arrange
    const database = await createMigratedTestDatabase();
    const databasePath = database.databasePath;
    await Deno.stat(databasePath);

    // Act
    await database.dispose();

    // Assert
    await assertRejects(() => Deno.stat(databasePath), Deno.errors.NotFound);
  });
});

test("通知順序列を追加すると既存receiptとpayloadを保持し、順序不明の旧pendingは自動再送しない", async () => {
  // Arrange
  await using database = await createPreCustomGameConsistencyDatabase(10);
  await database.client.execute(`INSERT INTO notification_deliveries
    (key, guild_id, target_discord_id, riot_account_puuid, channel_id, embed, message_id, status, next_attempt_at, created_at)
    VALUES ('legacy-sent', 'guild', 'user', 'puuid', 'channel', '{"title":"result"}', 'message', 'delivered', 1, 1),
           ('legacy-pending', 'guild', 'user', 'puuid', 'channel', '{"title":"progress"}', 'message', 'pending', 1, 1)`);
  // Act
  await migrate(database.db, { migrationsFolder });
  const { createNotificationDeliveriesRepository } = await import(
    "./repositories/notification_deliveries.ts"
  );
  const repository = createNotificationDeliveriesRepository(database.db);
  assertEquals(
    await repository.claimNotificationDelivery("legacy-pending"),
    null,
  );
  // Assert
  const rows = await database.db.select().from(schema.notificationDeliveries);
  assertEquals(
    rows.map(({ key, status, reason, messageId, embed, matchId }) => ({
      key,
      status,
      reason,
      messageId,
      embed,
      matchId,
    })),
    [
      {
        key: "legacy-sent",
        status: "delivered",
        reason: null,
        messageId: "message",
        embed: { title: "result" },
        matchId: null,
      },
      {
        key: "legacy-pending",
        status: "failed",
        reason: "ordering_unknown",
        messageId: "message",
        embed: { title: "progress" },
        matchId: null,
      },
    ],
  );
});
