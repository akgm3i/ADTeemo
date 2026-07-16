import {
  APIGuild,
  APIUser,
  REST,
  RESTPutAPIApplicationCommandsResult,
  RESTPutAPIApplicationGuildCommandsResult,
  Routes,
} from "discord.js";
import { loadCommands } from "./common/command_loader.ts";

const token = Deno.env.get("DISCORD_TOKEN");
const clientId = Deno.env.get("DISCORD_CLIENT_ID");
const guildId = Deno.env.get("DISCORD_GUILD_ID");

if (!token || !clientId) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file",
  );
}

const loadedCommands = await loadCommands();
const commands = loadedCommands.map((command) => command.data.toJSON());

const rest = new REST().setToken(token);

try {
  console.log(
    `Started refreshing ${commands.length} application (/) commands.`,
  );

  if (guildId) {
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    ) as RESTPutAPIApplicationGuildCommandsResult;
    console.log(
      `Successfully reloaded ${data.length} application guild (/) commands for bot ${
        (await rest.get(Routes.user()) as APIUser).username
      } in guild ${(await rest.get(Routes.guild(guildId)) as APIGuild).name}.`,
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
  Deno.exit(1);
}
