import {
  createLogger,
  initLogger,
  type LogLevel,
} from "../../lib/logger/mod.ts";

const logLevelEnv = Deno.env.get("API_LOG_LEVEL");

initLogger({
  component: "api",
  level: logLevelEnv?.toUpperCase() as LogLevel | undefined,
});

export const apiLogger = createLogger("api");
