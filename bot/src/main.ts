import { Client, Collection, Events, GatewayIntentBits, Interaction } from 'npm:discord.js';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'https://deno.land/x/dotenv@v3.2.2/mod.ts';

// Define a type for our client that includes the commands collection
interface ClientWithCommands extends Client {
    commands: Collection<string, any>;
}

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent,
  ],
}) as ClientWithCommands;

client.commands = new Collection();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = (await readdir(commandsPath)).filter(file => file.endsWith('.ts'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = await import(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Listen for slash commands
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const command = (interaction.client as ClientWithCommands).commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});


// Main function to start the bot
async function startBot() {
  await config({ path: './.env.dev', export: true });
  const token = Deno.env.get('DISCORD_TOKEN');
  if (!token) {
    console.error('Error: DISCORD_TOKEN environment variable not set.');
    Deno.exit(1);
  }
  client.login(token);
}

// Run the bot only when this file is the main module
if (import.meta.main) {
  startBot();
}

export { client };
