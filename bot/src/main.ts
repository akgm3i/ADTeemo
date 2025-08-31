import { Client, GatewayIntentBits } from 'discord.js';

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent, // Needed to read message content if required
  ],
});

// When the client is ready, run this code (only once)
client.once('ready', (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Main function to start the bot
function startBot() {
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
