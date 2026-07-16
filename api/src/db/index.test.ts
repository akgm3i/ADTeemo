import { sql } from "drizzle-orm";
import { assertEquals, assertFalse } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createLogger, initLogger } from "../../../lib/logger/mod.ts";
import { createDb, isDbQueryLoggingEnabled } from "./index.ts";

describe("database logging", () => {
  test("DB_QUERY_LOGが未指定のとき、Drizzle query logを既定OFFにする", async () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "db-default-off", level: "DEBUG" });
    const connection = createDb({
      url: "file::memory:",
      logger: createLogger("db-default-off"),
    });

    try {
      // Act
      await connection.db.run(sql`select ${"secret-parameter"}`);

      // Assert
      assertSpyCalls(consoleLogStub, 0);
    } finally {
      connection.close();
    }
  });

  test("DB_QUERY_LOGが1でもINFO levelのとき、SQLを出力しない", async () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "db-info", level: "INFO" });
    const connection = createDb({
      url: "file::memory:",
      logger: createLogger("db-info"),
      queryLogging: true,
    });

    try {
      // Act
      await connection.db.run(sql`select ${"secret-parameter"}`);

      // Assert
      assertSpyCalls(consoleLogStub, 0);
    } finally {
      connection.close();
    }
  });

  test("DB_QUERY_LOGが1かつDEBUG levelのとき、parameterを捨てSQL templateだけを出力する", async () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "db-debug", level: "DEBUG" });
    const connection = createDb({
      url: "file::memory:",
      logger: createLogger("db-debug"),
      queryLogging: true,
    });

    try {
      // Act
      await connection.db.run(sql`select ${"secret-parameter"}`);

      // Assert
      assertSpyCalls(consoleLogStub, 1);
      const raw = consoleLogStub.calls[0].args[0] as string;
      const payload = JSON.parse(raw);
      assertEquals(payload.event, "db.query");
      assertEquals(payload.level, "DEBUG");
      assertEquals(payload.sql, "select ?");
      assertFalse(raw.includes("secret-parameter"));
      assertFalse("params" in payload);
      assertFalse("parameters" in payload);
    } finally {
      connection.close();
    }
  });

  test("DB_QUERY_LOGは文字列1だけをopt-inとして受理する", () => {
    // Arrange
    const env = (value: string | undefined) => ({
      get: () => value,
    });

    // Act / Assert
    assertEquals(isDbQueryLoggingEnabled(env(undefined)), false);
    assertEquals(isDbQueryLoggingEnabled(env("0")), false);
    assertEquals(isDbQueryLoggingEnabled(env("true")), false);
    assertEquals(isDbQueryLoggingEnabled(env("1")), true);
  });
});
