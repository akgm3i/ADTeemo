import { migrate } from "drizzle-orm/libsql/migrator";
import { is } from "drizzle-orm";
import {
  type AnySQLiteTable,
  getTableConfig,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  createMigratedTestDatabase,
  migrationsFolder,
} from "./integration_test_harness.ts";
import * as schema from "./schema.ts";

const applicationTables = (Object.values(schema) as unknown[]).filter(
  (value): value is AnySQLiteTable => is(value, SQLiteTable),
);

function sorted(values: string[]) {
  return values.toSorted((left, right) => left.localeCompare(right));
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
