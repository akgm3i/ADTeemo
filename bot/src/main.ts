import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
} from "npm:discord.js";
import { ensureRoles } from "./features/role-management.ts";
import { loadCommands } from "./common/command_loader.ts";
import { apiClient } from "./api_client.ts";

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

// Load commands and add them to the client
const commands = await loadCommands();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Listen for interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
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
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this command!",
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
            content:
              "An error occurred while canceling the event. Please try again later.",
            components: [],
          });
          return;
        }

        // It's possible for the event or message to be deleted by a user before the bot tries to.
        // So we should handle the errors gracefully.
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
          content: "The event has been canceled.",
          components: [],
        });
      } catch (e) {
        console.error("Error handling cancel-event-select:", e);
        await interaction.editReply({
          content: "There was an error canceling the event.",
          components: [],
        });
      }
    }
  }
});

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
          message =
            `サーバー「${guild.name}」へのご招待ありがとうございます！\n必要なロール (${createdCount}件) を自動作成しました: ${
              result.summary.created.join(", ")
            }`;
        } else {
          message =
            `サーバー「${guild.name}」へのご招待ありがとうございます！\n必要なロールはすべて存在していたため、何も作成しませんでした。`;
        }
        break;
      }
      case "PERMISSION_ERROR":
        message =
          `サーバー「${guild.name}」に招待されましたが、ロールを作成する権限 (ロールの管理) がありません。サーバー設定を確認してください。`;
        break;
      case "UNKNOWN_ERROR":
        message =
          `サーバー「${guild.name}」でロールのセットアップ中に不明なエラーが発生しました。`;
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
function startBot() {
  const token = Deno.env.get("DISCORD_TOKEN");
  if (!token) {
    console.error("Error: DISCORD_TOKEN environment variable not set.");
    Deno.exit(1);
  }
  client.login(token);
}

// Run the bot only when this file is the main module
if (import.meta.main) {
  startBot();
}

export { client };
