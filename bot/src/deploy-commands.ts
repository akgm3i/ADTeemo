import {
  APIUser,
  REST,
  RESTPutAPIApplicationCommandsResult,
  RESTPutAPIApplicationGuildCommandsResult,
  Routes,
} from "npm:discord.js";
import { loadCommands } from "./common/command_loader.ts";

const token = Deno.env.get("DISCORD_TOKEN");
const clientId = Deno.env.get("DISCORD_CLIENT_ID");
const guildId = Deno.env.get("DISCORD_GUILD_ID");

if (!token || !clientId) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env.dev file",
  );
}

const loadedCommands = await loadCommands();
const commands = loadedCommands.map((command) => command.data.toJSON());

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`,
    );

    // The put method is used to fully refresh all commands in the guild with the current set
    if (guildId) {
      const data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      ) as RESTPutAPIApplicationGuildCommandsResult;
      console.log(
        `Successfully reloaded ${data.length} application guild (/) commands for bot ${
          (await rest.get(Routes.user()) as APIUser).username
        }.`,
      );
    } else {
      const data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      ) as RESTPutAPIApplicationCommandsResult;
      console.log(
        `Successfully reloaded ${data.length} application (/) commands for bot ${
          (await rest.get(Routes.user()) as APIUser).username
        }.`,
      );
    }
  } catch (error) {
    console.error(error);
  }
})();
