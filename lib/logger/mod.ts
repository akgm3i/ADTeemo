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
  warn(event: string, context?: LogContext): void;
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
const QUOTED_TEXT_ASSIGNMENT =
  /(["']?\b([A-Za-z][A-Za-z0-9_-]*)\b["']?\s*[:=]\s*)(["'])(.*?)\3/gu;
const UNQUOTED_TEXT_ASSIGNMENT =
  /(["']?\b([A-Za-z][A-Za-z0-9_-]*)\b["']?\s*[:=]\s*)([^\s,;&)\]}]+)/gu;
const TRAILING_URL_ASSIGNMENT =
  /(["']?\b([A-Za-z][A-Za-z0-9_-]*)\b["']?\s*[:=]\s*)(["']?)$/u;
const URL_TEXT = /\bhttps?:\/\/[^\s"'<>),;\]}]+/giu;
const STATIC_USERS_ROUTE_SEGMENTS = new Set(["link-by-riot-id"]);

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

function sanitizeKnownPathSegments(value: string): string {
  return value
    .replace(
      /(\/by-riot-id\/)([^/\s?#]+)\/([^/\s?#]+)/giu,
      (
        _match,
        prefix: string,
        gameName: string,
        tagLine: string,
      ) =>
        `${prefix}${gameName.startsWith(":") ? gameName : REDACTED}/${
          tagLine.startsWith(":") ? tagLine : REDACTED
        }`,
    )
    .replace(
      /(\/(?:by-puuid|by-summoner|users)\/)([^/\s?#]+)/giu,
      (_match, prefix: string, identifier: string) => {
        const normalizedPrefix = prefix.toLowerCase();
        const preserve = identifier.startsWith(":") ||
          (normalizedPrefix.endsWith("/users/") &&
            STATIC_USERS_ROUTE_SEGMENTS.has(identifier.toLowerCase()));
        return `${prefix}${preserve ? identifier : REDACTED}`;
      },
    );
}

function sanitizePlainText(value: string): string {
  let sanitized = value
    .replace(
      /(\bauthorization\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer|Basic)\s+\S+|\S+)/giu,
      `$1${REDACTED}`,
    )
    .replace(
      /(\bcookie\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,]+)/giu,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
      REDACTED,
    )
    .replace(
      /(\bhttps?:\/\/)[^/\s@]+@/giu,
      `$1${REDACTED}@`,
    );

  sanitized = sanitized
    .replace(
      QUOTED_TEXT_ASSIGNMENT,
      (match, prefix: string, key: string, quote: string) =>
        isSensitiveKey(key) ? `${prefix}${quote}${REDACTED}${quote}` : match,
    )
    .replace(
      UNQUOTED_TEXT_ASSIGNMENT,
      (match, prefix: string, key: string, text: string) =>
        isSensitiveKey(key) && !text.includes("[REDACTED")
          ? `${prefix}${REDACTED}`
          : match,
    );

  return sanitizeKnownPathSegments(sanitized)
    .replace(
      /\b[\p{L}\p{N}_.-]{2,16}#[A-Za-z0-9]{3,5}\b/gu,
      REDACTED,
    )
    .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, REDACTED);
}

function encodeUrlPart(value: string): string {
  return encodeURIComponent(value).replaceAll(
    encodeURIComponent(REDACTED),
    REDACTED,
  );
}

function sanitizeUrlParameters(parameters: URLSearchParams): string {
  return [...parameters.entries()]
    .map(([key, value]) => {
      const sanitized = isSensitiveKey(key) ? REDACTED : sanitizeText(value);
      return `${encodeURIComponent(key)}=${encodeUrlPart(sanitized)}`;
    })
    .join("&");
}

function sanitizeUrlString(value: string): string {
  try {
    const url = new URL(value);
    const userInfo = url.username || url.password ? `${REDACTED}@` : "";
    const pathname = sanitizeKnownPathSegments(url.pathname);
    const query = url.searchParams.size > 0
      ? `?${sanitizeUrlParameters(url.searchParams)}`
      : "";
    const rawFragment = url.hash.slice(1);
    const fragment = rawFragment.length === 0
      ? ""
      : rawFragment.includes("=")
      ? `#${sanitizeUrlParameters(new URLSearchParams(rawFragment))}`
      : `#${encodeUrlPart(sanitizeText(rawFragment))}`;
    return `${url.protocol}//${userInfo}${url.host}${pathname}${query}${fragment}`;
  } catch {
    return sanitizePlainText(value);
  }
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "[Unserializable]";
  let sanitized = "";
  let lastIndex = 0;
  for (const match of value.matchAll(URL_TEXT)) {
    const index = match.index ?? 0;
    const prefix = value.slice(lastIndex, index);
    const assignment = prefix.match(TRAILING_URL_ASSIGNMENT);
    if (assignment && isSensitiveKey(assignment[2])) {
      const assignmentIndex = assignment.index ?? prefix.length;
      sanitized += sanitizePlainText(prefix.slice(0, assignmentIndex));
      sanitized += `${assignment[1]}${assignment[3]}${REDACTED}`;
    } else {
      sanitized += sanitizePlainText(prefix);
      sanitized += sanitizeUrlString(match[0]);
    }
    lastIndex = index + match[0].length;
  }
  sanitized += sanitizePlainText(value.slice(lastIndex));
  return sanitized;
}

function sanitizeUrl(value: URL): string {
  return sanitizeUrlString(value.toString());
}

function serializeError(
  error: Error,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = Object.create(null);
  serialized.name = error.name;
  serialized.message = sanitizeText(error.message);
  if (error.stack) serialized.stack = sanitizeText(error.stack);
  if (error.cause !== undefined) {
    serialized.cause = sanitizeValue(error.cause, seen, depth + 1);
  }

  try {
    for (const [key, value] of Object.entries(error)) {
      if (key === "cause") continue;
      serialized[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitizeValue(value, seen, depth + 1);
    }
  } catch {
    serialized.properties = "[Unserializable]";
  }

  return serialized;
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
    return typeof value === "string" ? sanitizeText(value) : value;
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
        sanitized[key] = isSensitiveKey(key)
          ? REDACTED
          : sanitizeValue(item, seen, depth + 1);
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
    payload.error = sanitizeValue(error, new WeakSet(), 0);
  }
  if (level === "ERROR") {
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
    warn: (event, context) => log("WARN", event, context),
    error: (event, context, error) => log("ERROR", event, context, error),
  };
}
