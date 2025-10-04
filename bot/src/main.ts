import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
} from "discord.js";
import { ensureRoles } from "./features/role-management.ts";
import { loadCommands } from "./common/command_loader.ts";
import { apiClient } from "./api_client.ts";
import { messageHandler, messageKeys } from "./messages.ts";

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
});

client.commands = new Collection();

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

export async function handleInteractionCreate(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(
      interaction.commandName,
    );

    if (!command) {
      console.error(
        `No command matching ${interaction.commandName} was found.`,
      );
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: messageHandler.formatMessage(
            messageKeys.common.error.command,
          ),
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: messageHandler.formatMessage(
            messageKeys.common.error.command,
          ),
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "cancel-event-select") {
      await interaction.deferUpdate();

      try {
        const [discordEventId, recruitmentMessageId] = interaction.values[0]
          .split(":");

        const deleteResult = await apiClient.deleteCustomGameEvent(
          discordEventId,
        );

        if (!deleteResult.success) {
          console.error(
            `Failed to delete event ${discordEventId} from DB`,
            deleteResult.error,
          );
          await interaction.editReply({
            content: messageHandler.formatMessage(
              messageKeys.customGame.cancel.error.interaction,
            ),
            components: [],
          });
          return;
        }

        try {
          await interaction.guild?.scheduledEvents.delete(discordEventId);
        } catch (e) {
          console.error(
            `Failed to delete scheduled event ${discordEventId}:`,
            e,
          );
        }

        try {
          if (interaction.channel) {
            await interaction.channel.messages.delete(recruitmentMessageId);
          }
        } catch (e) {
          console.error(
            `Failed to delete recruitment message ${recruitmentMessageId}:`,
            e,
          );
        }

        await interaction.editReply({
          content: messageHandler.formatMessage(
            messageKeys.customGame.cancel.success,
          ),
          components: [],
        });
      } catch (e) {
        console.error("Error handling cancel-event-select:", e);
        await interaction.editReply({
          content: messageHandler.formatMessage(
            messageKeys.customGame.cancel.error.generic,
          ),
          components: [],
        });
      }
    }
  }
}

// Listen for interactions
client.on(Events.InteractionCreate, handleInteractionCreate);

// When the bot joins a new guild, run this code
client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined a new guild: ${guild.name} (id: ${guild.id})`);

  try {
    const owner = await guild.fetchOwner();
    const result = await ensureRoles(guild);
    let message = "";

    switch (result.status) {
      case "SUCCESS": {
        const createdCount = result.summary.created.length;
        if (createdCount > 0) {
          message = messageHandler.formatMessage(
            messageKeys.guild.welcome.success.createdRoles,
            {
              guildName: guild.name,
              count: createdCount,
              roles: result.summary.created.join(", "),
            },
          );
        } else {
          message = messageHandler.formatMessage(
            messageKeys.guild.welcome.success.noAction,
            {
              guildName: guild.name,
            },
          );
        }
        break;
      }
      case "PERMISSION_ERROR":
        message = messageHandler.formatMessage(
          messageKeys.guild.welcome.error.permission,
          {
            guildName: guild.name,
          },
        );
        break;
      case "UNKNOWN_ERROR":
        message = messageHandler.formatMessage(
          messageKeys.guild.welcome.error.unknown,
          {
            guildName: guild.name,
          },
        );
        console.error(
          `Error setting up roles for guild ${guild.id}:`,
          result.error,
        );
        break;
    }

    await owner.send(message);
  } catch (error) {
    console.error(
      `Could not fetch owner or send DM to owner of guild ${guild.id}`,
      error,
    );
  }
});

// Main function to start the bot
async function startBot() {
  const token = Deno.env.get("DISCORD_TOKEN");
  if (!token) {
    console.error("Error: DISCORD_TOKEN environment variable not set.");
    Deno.exit(1);
  }
  const commands = await loadCommands();
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
  client.login(token);
}

// Run the bot only when this file is the main module
if (import.meta.main) {
  startBot();
}

export { client };
