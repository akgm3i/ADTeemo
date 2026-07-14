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
