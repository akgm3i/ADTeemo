import { getLogger, setup } from "@std/log";
import { ConsoleHandler } from "@std/log/console-handler";
import { FileHandler } from "@std/log/file-handler";

export type LogLevel =
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "CRITICAL";

interface InitLoggerOptions {
  component?: string;
  level?: LogLevel | string;
  console?: boolean;
  filePath?: string;
}

interface LogContext extends Record<string, unknown> {
  error?: unknown;
}

const VALID_LEVELS: readonly LogLevel[] = [
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "CRITICAL",
];

type LogHandler = ConsoleHandler | FileHandler;

interface LoggerConfig {
  level: LogLevel;
  handlers: string[];
}

export interface StructuredLogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: unknown): void;
}

function normalizeLevel(
  level: string | LogLevel | undefined,
  fallback: LogLevel,
): LogLevel {
  if (!level) {
    return fallback;
  }
  const upper = (typeof level === "string" ? level : String(level))
    .toUpperCase();
  if (VALID_LEVELS.includes(upper as LogLevel)) {
    return upper as LogLevel;
  }
  return fallback;
}

let initialized = false;
const handlers = new Map<string, LogHandler>();
const loggers = new Map<string, LoggerConfig>();

const formatter = (record: { msg: string }) => record.msg;

export function initLogger(options: InitLoggerOptions = {}): void {
  const loggerName = options.component ?? "default";
  const loggerHandlers: string[] = [];

  if (options.console ?? true) {
    const handlerName = `${loggerName}:console`;
    handlers.set(
      handlerName,
      new ConsoleHandler("DEBUG", { formatter, useColors: false }),
    );
    loggerHandlers.push(handlerName);
  }

  const filePath = options.filePath ?? Deno.env.get("ADTEEMO_LOG_FILE");
  if (filePath) {
    const handlerName = `${loggerName}:file`;
    handlers.set(
      handlerName,
      new FileHandler("DEBUG", {
        filename: filePath,
        formatter,
      }),
    );
    loggerHandlers.push(handlerName);
  }

  if (loggerHandlers.length === 0) {
    const handlerName = `${loggerName}:console`;
    handlers.set(
      handlerName,
      new ConsoleHandler("DEBUG", { formatter, useColors: false }),
    );
    loggerHandlers.push(handlerName);
  }

  const handlerRecord = Object.fromEntries(handlers.entries());
  const level = normalizeLevel(
    options.level,
    normalizeLevel(Deno.env.get("ADTEEMO_LOG_LEVEL"), "INFO"),
  );
  loggers.set(loggerName, { level, handlers: loggerHandlers });

  setup({
    handlers: handlerRecord as Record<string, LogHandler>,
    loggers: Object.fromEntries(loggers.entries()),
  });

  initialized = true;
}

function formatPayload(
  component: string,
  level: LogLevel,
  message: string,
  baseContext: Record<string, unknown>,
  context: LogContext = {},
  error?: unknown,
): string {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    component,
    level,
    message,
    ...baseContext,
    ...context,
  };

  if (error instanceof Error) {
    payload.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  } else if (context.error && !(context.error instanceof Error)) {
    payload.error = context.error;
  } else if (error !== undefined) {
    payload.error = error;
  }

  return JSON.stringify(payload);
}

export function createLogger(
  component: string,
  baseContext: Record<string, unknown> = {},
): StructuredLogger {
  if (!initialized || !loggers.has(component)) {
    initLogger({ component });
  }
  const logger = getLogger(component);

  function log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: unknown,
  ) {
    const payload = formatPayload(
      component,
      level,
      message,
      baseContext,
      context,
      error,
    );
    switch (level) {
      case "DEBUG":
        logger.debug(payload);
        break;
      case "INFO":
        logger.info(payload);
        break;
      case "WARN":
        logger.warn(payload);
        break;
      case "ERROR":
        logger.error(payload);
        break;
      case "CRITICAL":
        logger.critical(payload);
        break;
    }
  }

  return {
    info(message, context) {
      log("INFO", message, context);
    },
    warn(message, context) {
      log("WARN", message, context);
    },
    error(message, context, error) {
      log("ERROR", message, context, error);
    },
  };
}
