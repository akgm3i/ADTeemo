import { assertEquals, assertFalse, assertMatch } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createLogger, initLogger } from "./mod.ts";

function loggedPayload(call: { args: unknown[] }) {
  return JSON.parse(call.args[0] as string) as Record<string, unknown>;
}

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
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.component, "bot-test");
    assertEquals(parsed.level, "INFO");
    assertEquals(parsed.event, "bot.info");
    assertFalse("message" in parsed);
    assertMatch(parsed.timestamp as string, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("DEBUGを有効にしてdebugを記録したとき、1行JSONの共通契約でstdoutへ出力する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "debug-test", level: "DEBUG" });
    const logger = createLogger("debug-test", { deployment: "local" });

    // Act
    logger.debug("debug.recorded", { count: 1 });

    // Assert
    assertSpyCalls(consoleLogStub, 1);
    const raw = consoleLogStub.calls[0].args[0] as string;
    assertFalse(raw.includes("\n"));
    assertEquals(loggedPayload(consoleLogStub.calls[0]), {
      deployment: "local",
      count: 1,
      timestamp: JSON.parse(raw).timestamp,
      level: "DEBUG",
      event: "debug.recorded",
      component: "debug-test",
    });
  });

  test("nested contextに秘密値と識別子があるとき、大文字小文字や階層によらず再帰的にredactする", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "redaction-test", level: "INFO" });
    const logger = createLogger("redaction-test");

    // Act
    logger.info("context.received", {
      request: {
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
        },
        oauth: { code: "oauth-code", state: "oauth-state" },
      },
      credentials: [{ apiKey: "api-secret", token: "token-secret" }],
      sql: { params: ["sql-secret"] },
      account: {
        riotId: "GameName#TAG",
        puuid: "riot-puuid",
        gameName: "GameName",
        tagLine: "TAG",
      },
      actor: { userId: "discord-user-id" },
      safe: { guildId: "guild-id", count: 2 },
    });

    // Assert
    const raw = consoleLogStub.calls[0].args[0] as string;
    for (
      const secret of [
        "Bearer secret",
        "session=secret",
        "oauth-code",
        "oauth-state",
        "api-secret",
        "token-secret",
        "sql-secret",
        "GameName#TAG",
        "riot-puuid",
        "discord-user-id",
      ]
    ) {
      assertFalse(raw.includes(secret));
    }
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(
      (parsed.safe as Record<string, unknown>).guildId,
      "guild-id",
    );
  });

  test("Error本文に任意形式の機密値があるとき、本文を解析せず安全なerror envelopeだけを記録する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "opaque-error-test", level: "ERROR" });
    const logger = createLogger("opaque-error-test");
    class ProviderHttpError extends Error {
      constructor(
        public readonly status: number,
        public readonly responseBody: string,
        cause: unknown,
      ) {
        super(responseBody, { cause });
        this.name = responseBody;
      }
    }
    const cause = new Error("Cookie: session=cause-cookie-secret");
    const error = new ProviderHttpError(
      503,
      'Authorization: Digest username="u", response="digest-secret" ' +
        'payload={"password":"abc\\"escaped-secret"} ' +
        "https://api-token@provider.example/private-path?code=oauth-code",
      cause,
    );

    // Act
    logger.error(
      "provider.failed",
      {
        errorMessage: "Authorization: Basic structured-secret",
      },
      error,
    );

    // Assert
    const raw = consoleLogStub.calls[0].args[0] as string;
    for (
      const secret of [
        "digest-secret",
        "escaped-secret",
        "cause-cookie-secret",
        "api-token",
        "private-path",
        "oauth-code",
        "structured-secret",
      ]
    ) {
      assertFalse(raw.includes(secret), `${secret} must be redacted: ${raw}`);
    }
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    const loggedError = parsed.error as Record<string, unknown>;
    assertEquals(loggedError, {
      name: "ProviderHttpError",
      status: 503,
      cause: { name: "Error" },
    });
    assertEquals(parsed.errorMessage, "[REDACTED]");
  });

  test("WARN境界へErrorを渡したとき、本文ではなく安全なerror envelopeを記録する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "warn-error-test", level: "WARN" });
    const logger = createLogger("warn-error-test");
    const error = new TypeError("provider-body-secret");

    // Act
    logger.warn("provider.failed", { provider: "riot" }, error);

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.provider, "riot");
    assertEquals(parsed.error, { name: "TypeError" });
    assertEquals(parsed.errorCategory, "unexpected");
    assertMatch(
      parsed.correlationId as string,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assertFalse((consoleLogStub.calls[0].args[0] as string).includes(
      "provider-body-secret",
    ));
  });

  test("URLとroute templateを構造化して記録するとき、URLはoriginだけを残しroute templateは維持する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "location-boundary-test", level: "INFO" });
    const logger = createLogger("location-boundary-test");

    // Act
    logger.info("request.completed", {
      callbackUrl: new URL(
        "https://api-token@provider.example/private/GameName" +
          "?code=oauth-code#state=oauth-state",
      ),
      documentationUrl: "https://docs.example/private?token=string-url-secret",
      http: { path: "/users/:userId/riot-account" },
    });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.callbackUrl, "https://provider.example");
    assertEquals(parsed.documentationUrl, "https://docs.example");
    assertEquals(
      (parsed.http as Record<string, unknown>).path,
      "/users/:userId/riot-account",
    );
  });

  test("opaqueなbody・header・文字列errorをstructured contextへ渡したとき、内容全体をredactする", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "opaque-context-test", level: "ERROR" });
    const logger = createLogger("opaque-context-test");

    // Act
    logger.error("provider.failed", {
      requestHeaders: { Authorization: "Digest header-secret" },
      responseHeader: "Set-Cookie: session=single-header-secret",
      providerResponseBody: '{"password":"body-secret"}',
      responseBodies: ['{"password":"plural-body-secret"}'],
      errorMessages: ["plural-error-secret"],
      stackTrace: "stack-trace-secret",
      callbackUrls: [
        "https://url-user:url-password@provider.example/private" +
        "?token=url-query-secret",
      ],
      error: "string-error-secret",
      safeReason: "provider_unavailable",
    });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.requestHeaders, "[REDACTED]");
    assertEquals(parsed.responseHeader, "[REDACTED]");
    assertEquals(parsed.providerResponseBody, "[REDACTED]");
    assertEquals(parsed.responseBodies, "[REDACTED]");
    assertEquals(parsed.errorMessages, "[REDACTED]");
    assertEquals(parsed.stackTrace, "[REDACTED]");
    assertEquals(parsed.callbackUrls, ["https://provider.example"]);
    assertEquals(parsed.error, "[REDACTED]");
    assertEquals(parsed.safeReason, "provider_unavailable");
  });

  test("guild、channel、messageのsnowflakeを記録するとき、非user識別子は診断用に維持する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "discord-context-test", level: "INFO" });
    const logger = createLogger("discord-context-test");

    // Act
    logger.info("discord.operation", {
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      messageId: "323456789012345678",
      actor: {
        discordUserId: "423456789012345678",
      },
    });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.guildId, "123456789012345678");
    assertEquals(parsed.channelId, "223456789012345678");
    assertEquals(parsed.messageId, "323456789012345678");
    assertEquals(
      (parsed.actor as Record<string, unknown>).discordUserId,
      "[REDACTED]",
    );
  });

  test("循環参照、BigInt、Error causeを記録したとき、安全なJSONへ変換する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "serialization-test", level: "ERROR" });
    const logger = createLogger("serialization-test");
    const circular: Record<string, unknown> = { value: 42n };
    circular.self = circular;
    const cause = new Error("repository unavailable");
    const error = new Error("operation failed", { cause });

    // Act
    logger.error("operation.failed", { circular }, error);

    // Assert
    assertSpyCalls(consoleLogStub, 1);
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(
      parsed.circular,
      { value: "42", self: "[Circular]" },
    );
    assertEquals(parsed.error, {
      name: "Error",
      cause: { name: "Error" },
    });
  });

  test("同じobjectを複数箇所から参照するとき、循環参照ではなく各箇所を完全に記録する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "shared-reference-test", level: "INFO" });
    const logger = createLogger("shared-reference-test");
    const shared = { value: 42, nested: { safe: true } };

    // Act
    logger.info("shared.received", { left: shared, right: shared });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.left, shared);
    assertEquals(parsed.right, shared);
  });

  test("env権限がないときも、logger生成と業務処理を失敗させない", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    using _envStub = stub(Deno.env, "get", () => {
      throw new Error("Requires env access");
    });

    // Act
    const logger = createLogger("no-env-permission-test");
    logger.info("operation.continues");

    // Assert
    assertSpyCalls(consoleLogStub, 1);
    assertEquals(
      loggedPayload(consoleLogStub.calls[0]).event,
      "operation.continues",
    );
  });

  test("ERRORに分類と相関IDがないとき、安全な既定値を補完する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "error-default-test", level: "ERROR" });
    const logger = createLogger("error-default-test");

    // Act
    logger.error("operation.failed");

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.errorCategory, "unexpected");
    assertMatch(
      parsed.correlationId as string,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("ERRORに相関IDと分類があるとき、検証済みの値を維持する", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "classified-error-test", level: "ERROR" });
    const logger = createLogger("classified-error-test");

    // Act
    logger.error("provider.failed", {
      correlationId: "request-123",
      errorCategory: "remote_api",
    });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.correlationId, "request-123");
    assertEquals(parsed.errorCategory, "remote_api");
  });

  test("base contextに相関IDがあるとき、子処理のERRORへ同じ値を引き継ぐ", () => {
    // Arrange
    using consoleLogStub = stub(console, "log");
    initLogger({ component: "child-error-test", level: "ERROR" });
    const logger = createLogger("child-error-test", {
      correlationId: "worker-tick-123",
    });

    // Act
    logger.error("worker.operation_failed", {
      errorCategory: "repository",
    });

    // Assert
    const parsed = loggedPayload(consoleLogStub.calls[0]);
    assertEquals(parsed.correlationId, "worker-tick-123");
    assertEquals(parsed.errorCategory, "repository");
  });

  test("stdout sinkが例外を投げたとき、logger利用側へ例外を伝播しない", () => {
    // Arrange
    using _consoleLogStub = stub(console, "log", () => {
      throw new Error("stdout unavailable");
    });
    initLogger({ component: "sink-failure-test", level: "INFO" });
    const logger = createLogger("sink-failure-test");

    // Act / Assert
    logger.info("operation.continues", { value: 1n });
  });
});
