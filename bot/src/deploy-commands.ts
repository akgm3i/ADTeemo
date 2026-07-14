import {
  REST,
  RESTPutAPIApplicationCommandsResult,
  RESTPutAPIApplicationGuildCommandsResult,
  Routes,
} from "discord.js";
import { loadCommands } from "./common/command_loader.ts";
import { botLogger } from "./logger.ts";

const token = Deno.env.get("DISCORD_TOKEN");
const clientId = Deno.env.get("DISCORD_CLIENT_ID");
const guildId = Deno.env.get("DISCORD_GUILD_ID");
const correlationId = crypto.randomUUID();

if (!token || !clientId) {
  botLogger.error("commands.deploy.missing_configuration", {
    correlationId,
    errorCategory: "validation",
  });
  Deno.exit(1);
}

const rest = new REST().setToken(token);

try {
  const loadedCommands = await loadCommands();
  const commands = loadedCommands.map((command) => command.data.toJSON());
  botLogger.info("commands.deploy.started", {
    correlationId,
    commandCount: commands.length,
    scope: guildId ? "guild" : "global",
  });

  if (guildId) {
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    ) as RESTPutAPIApplicationGuildCommandsResult;
    botLogger.info("commands.deploy.completed", {
      correlationId,
      commandCount: data.length,
      scope: "guild",
    });
  } else {
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    ) as RESTPutAPIApplicationCommandsResult;
    botLogger.info("commands.deploy.completed", {
      correlationId,
      commandCount: data.length,
      scope: "global",
    });
  }
} catch (error) {
  botLogger.error("commands.deploy.failed", {
    correlationId,
    errorCategory: "remote_api",
  }, error);
  Deno.exit(1);
}
