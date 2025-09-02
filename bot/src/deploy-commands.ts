import {
  APIUser,
  REST,
  RESTPutAPIApplicationGuildCommandsResult,
  RESTPutAPIApplicationCommandsResult,
  Routes,
} from "npm:discord.js";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const token = Deno.env.get("DISCORD_TOKEN");
const clientId = Deno.env.get("DISCORD_CLIENT_ID");
const guildId = Deno.env.get("DISCORD_GUILD_ID");

if (!token || !clientId) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env.dev file",
  );
}

const commands = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsPath = path.join(__dirname, "commands");
const commandFiles = (await readdir(commandsPath)).filter((file) =>
  file.endsWith(".ts")
);

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = await import(filePath);
  if ("data" in command && "execute" in command) {
    commands.push(command.data.toJSON());
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
    );
  }
}

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
