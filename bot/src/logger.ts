import {
  createLogger,
  initLogger,
  type LogLevel,
} from "../../lib/logger/mod.ts";

const logLevelEnv = Deno.env.get("BOT_LOG_LEVEL");

initLogger({
  component: "bot",
  level: logLevelEnv?.toUpperCase() as LogLevel | undefined,
});

export const botLogger = createLogger("bot");

export function createBotLogger(
  baseContext: Record<string, unknown>,
): ReturnType<typeof createLogger> {
  const context = (eventContext: Record<string, unknown> = {}) => ({
    ...baseContext,
    ...eventContext,
  });
  return {
    debug: (event, eventContext) =>
      botLogger.debug(event, context(eventContext)),
    info: (event, eventContext) => botLogger.info(event, context(eventContext)),
    warn: (event, eventContext) => botLogger.warn(event, context(eventContext)),
    error: (event, eventContext, error) =>
      botLogger.error(event, context(eventContext), error),
  };
}

const interactionCorrelationIds = new WeakMap<object, string>();

export function correlationIdForInteraction(interaction: object): string {
  const existing = interactionCorrelationIds.get(interaction);
  if (existing) return existing;

  const correlationId = crypto.randomUUID();
  interactionCorrelationIds.set(interaction, correlationId);
  return correlationId;
}
