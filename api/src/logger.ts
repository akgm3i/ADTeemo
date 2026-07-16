import {
  createLogger,
  initLogger,
  type LogLevel,
} from "../../lib/logger/mod.ts";

const logLevelEnv = Deno.env.get("API_LOG_LEVEL");
const logFileEnv = Deno.env.get("API_LOG_FILE");

initLogger({
  component: "api",
  level: logLevelEnv?.toUpperCase() as LogLevel | undefined,
  filePath: logFileEnv ?? undefined,
});

export const apiLogger = createLogger("api");
