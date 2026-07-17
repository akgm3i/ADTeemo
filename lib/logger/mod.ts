export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type ErrorCategory =
  | "domain"
  | "validation"
  | "remote_api"
  | "repository"
  | "unexpected";

export interface LogContext extends Record<string, unknown> {
  correlationId?: string;
  errorCategory?: ErrorCategory;
  error?: unknown;
}

export interface StructuredLogger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext, error?: unknown): void;
  error(event: string, context?: LogContext, error?: unknown): void;
}

interface InitLoggerOptions {
  component?: string;
  level?: LogLevel | string;
}

const VALID_LEVELS: readonly LogLevel[] = [
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
];

const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "domain",
  "validation",
  "remote_api",
  "repository",
  "unexpected",
];

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const MAX_DEPTH = 20;
const loggerLevels = new Map<string, LogLevel>();

function environmentValue(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function normalizeLevel(
  level: string | LogLevel | undefined,
  fallback: LogLevel,
): LogLevel {
  if (!level) return fallback;
  const upper = String(level).toUpperCase();
  return VALID_LEVELS.includes(upper as LogLevel)
    ? upper as LogLevel
    : fallback;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function keyWords(key: string): string[] {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (
    normalized.includes("token") ||
    normalized.includes("credential") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("puuid") ||
    normalized.includes("riotid") ||
    normalized.includes("oauthcode") ||
    normalized.includes("oauthstate") ||
    normalized.includes("discordid") ||
    normalized.includes("discorduserid") ||
    normalized.endsWith("userid") ||
    normalized.endsWith("params") ||
    normalized.endsWith("parameters")
  ) {
    return true;
  }

  return [
    "code",
    "state",
    "params",
    "parameters",
    "sqlparams",
    "sqlparameters",
    "usertag",
    "gamename",
    "tagline",
  ].includes(normalized);
}

function isErrorKey(key: string): boolean {
  const lastWord = keyWords(key).at(-1);
  return lastWord === "error" || lastWord === "exception";
}

function isOpaqueKey(key: string): boolean {
  const words = keyWords(key);
  const lastWord = words.at(-1);
  return words.includes("stack") || [
    "errors",
    "exceptions",
    "message",
    "messages",
    "cause",
    "causes",
    "body",
    "bodies",
    "header",
    "headers",
  ].includes(lastWord ?? "");
}

function isUrlKey(key: string): boolean {
  return ["url", "urls", "uri", "uris"].includes(
    keyWords(key).at(-1) ?? "",
  );
}

function sanitizeUrl(value: unknown): string {
  try {
    const raw = value instanceof URL
      ? URL.prototype.toString.call(value)
      : typeof value === "string"
      ? value
      : undefined;
    const url = raw === undefined ? undefined : new URL(raw);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      return REDACTED;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return REDACTED;
  }
}

function sanitizeUrlValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (!Array.isArray(value)) return sanitizeUrl(value);
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  try {
    return value.map((item) => sanitizeUrlValue(item, seen, depth + 1));
  } finally {
    seen.delete(value);
  }
}

function errorName(error: Error): string {
  try {
    const prototype = Object.getPrototypeOf(error);
    const constructor = prototype &&
      Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    const name = typeof constructor === "function" ? constructor.name : "";
    return /^[A-Za-z][A-Za-z0-9_$.-]{0,63}$/.test(name) ? name : "Error";
  } catch {
    return "Error";
  }
}

function ownDataProperty(
  value: object,
  key: string,
): { found: boolean; value?: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? { found: true, value: descriptor.value }
      : { found: false };
  } catch {
    return { found: false };
  }
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) &&
      value >= 100 && value <= 599
    ? value
    : undefined;
}

function serializeError(
  error: Error,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = Object.create(null);
  serialized.name = errorName(error);

  for (const key of ["status", "statusCode"]) {
    const property = ownDataProperty(error, key);
    const status = property.found ? safeHttpStatus(property.value) : undefined;
    if (status !== undefined) serialized[key] = status;
  }

  const cause = ownDataProperty(error, "cause");
  if (cause.found && cause.value !== undefined) {
    serialized.cause = cause.value instanceof Error
      ? sanitizeValue(cause.value, seen, depth + 1)
      : REDACTED;
  }

  return serialized;
}

function sanitizeProperty(
  key: string,
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (isErrorKey(key)) {
    return value instanceof Error
      ? sanitizeValue(value, seen, depth + 1)
      : REDACTED;
  }
  if (isOpaqueKey(key)) return REDACTED;
  if (isUrlKey(key)) return sanitizeUrlValue(value, seen, depth + 1);
  return sanitizeValue(value, seen, depth + 1);
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return "[Function]";

  const object = value as object;
  if (seen.has(object)) return CIRCULAR;
  seen.add(object);

  try {
    if (value instanceof Date) {
      try {
        return value.toISOString();
      } catch {
        return "Invalid Date";
      }
    }
    if (value instanceof URL) return sanitizeUrl(value);
    if (value instanceof Error) return serializeError(value, seen, depth);
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, seen, depth + 1));
    }

    const sanitized: Record<string, unknown> = Object.create(null);
    try {
      for (const [key, item] of Object.entries(value)) {
        sanitized[key] = sanitizeProperty(key, item, seen, depth);
      }
    } catch {
      return "[Unserializable]";
    }
    return sanitized;
  } catch {
    return "[Unserializable]";
  } finally {
    seen.delete(object);
  }
}

function sanitizeRecord(value: Record<string, unknown>): LogContext {
  const sanitized = sanitizeValue(value, new WeakSet(), 0);
  return typeof sanitized === "object" && sanitized !== null
    ? sanitized as LogContext
    : {};
}

export function isValidCorrelationId(value: string | undefined): boolean {
  return value !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function correlationIdFrom(context: LogContext): string {
  return typeof context.correlationId === "string" &&
      isValidCorrelationId(context.correlationId)
    ? context.correlationId
    : crypto.randomUUID();
}

function errorCategoryFrom(context: LogContext): ErrorCategory {
  return typeof context.errorCategory === "string" &&
      ERROR_CATEGORIES.includes(context.errorCategory as ErrorCategory)
    ? context.errorCategory as ErrorCategory
    : "unexpected";
}

export function initLogger(options: InitLoggerOptions = {}): void {
  const component = options.component ?? "default";
  const fallback = normalizeLevel(
    environmentValue("ADTEEMO_LOG_LEVEL"),
    "INFO",
  );
  loggerLevels.set(component, normalizeLevel(options.level, fallback));
}

function formatPayload(
  component: string,
  level: LogLevel,
  event: string,
  baseContext: Record<string, unknown>,
  context: LogContext,
  error?: unknown,
): string {
  const safeBaseContext = sanitizeRecord(baseContext);
  const safeContext = sanitizeRecord(context);
  const mergedContext: LogContext = {
    ...safeBaseContext,
    ...safeContext,
  };
  const payload: Record<string, unknown> = {
    ...mergedContext,
    timestamp: new Date().toISOString(),
    level,
    event,
    component,
  };

  if (error !== undefined) {
    payload.error = error instanceof Error
      ? sanitizeValue(error, new WeakSet(), 0)
      : REDACTED;
  }
  if (level === "ERROR" || error !== undefined) {
    payload.correlationId = correlationIdFrom(mergedContext);
    payload.errorCategory = errorCategoryFrom(mergedContext);
  }

  return JSON.stringify(payload);
}

export function createLogger(
  component: string,
  baseContext: Record<string, unknown> = {},
): StructuredLogger {
  if (!loggerLevels.has(component)) initLogger({ component });

  function log(
    level: LogLevel,
    event: string,
    context: LogContext = {},
    error?: unknown,
  ): void {
    try {
      const configuredLevel = loggerLevels.get(component) ?? "INFO";
      if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[configuredLevel]) return;
      console.log(
        formatPayload(component, level, event, baseContext, context, error),
      );
    } catch {
      // Logging must never interrupt the business operation, including when the
      // stdout sink or an exotic context object fails during serialization.
    }
  }

  return {
    debug: (event, context) => log("DEBUG", event, context),
    info: (event, context) => log("INFO", event, context),
    warn: (event, context, error) => log("WARN", event, context, error),
    error: (event, context, error) => log("ERROR", event, context, error),
  };
}
