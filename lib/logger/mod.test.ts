import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createLogger, initLogger } from "./mod.ts";

describe("logger", () => {
  test("APIとBotのロガーを同じプロセスで初期化したとき、後から初期化した設定で先に作成したロガーを上書きしない", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "api-test", level: "ERROR" });
    const apiLogger = createLogger("api-test");
    initLogger({ component: "bot-test", level: "INFO" });
    const botLogger = createLogger("bot-test");

    // Act
    apiLogger.info("api.info");
    botLogger.info("bot.info");

    // Assert
    assertSpyCalls(consoleLogStub, 1);
    const [firstCall] = consoleLogStub.calls;
    const [payload] = firstCall.args;
    const parsed = JSON.parse(payload as string);
    assertEquals(parsed.component, "bot-test");
    assertEquals(parsed.level, "INFO");
    assertEquals(parsed.message, "bot.info");
  });
});
