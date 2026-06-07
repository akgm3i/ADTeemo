import {
  createLogger,
  initLogger,
  type LogLevel,
} from "../../lib/logger/mod.ts";

const logLevelEnv = Deno.env.get("BOT_LOG_LEVEL");
const logFileEnv = Deno.env.get("BOT_LOG_FILE");

initLogger({
  component: "bot",
  level: logLevelEnv?.toUpperCase() as LogLevel | undefined,
  filePath: logFileEnv ?? undefined,
});

export const botLogger = createLogger("bot");
