import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
} from "discord.js";
import { ensureRoles } from "./features/role-management.ts";
import {
  formatCommandLoadErrors,
  loadCommands,
} from "./common/command_loader.ts";
import {
  apiClient,
  configureApiClient,
  createApiClient,
  createApiRpcClients,
} from "./api_client.ts";
import { matchTracker } from "./features/match_tracking.ts";
import { messageHandler, messageKeys } from "./messages.ts";
import { botLogger, correlationIdForInteraction } from "./logger.ts";
import type { Command } from "./types.ts";

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
  botLogger.info("bot.ready", {
    correlationId: crypto.randomUUID(),
    userTag: c.user.tag,
    userId: c.user.id,
  });
  matchTracker.startMatchTrackingWorker(c);
});

export async function handleInteractionCreate(interaction: Interaction) {
  const correlationId = correlationIdForInteraction(interaction);
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(
      interaction.commandName,
    );

    if (!command) {
      botLogger.warn("command.not_found", {
        correlationId,
        commandName: interaction.commandName,
        guildId: interaction.guild?.id ?? null,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      botLogger.error(
        "command.execution_failed",
        {
          correlationId,
          errorCategory: "unexpected",
          commandName: interaction.commandName,
          guildId: interaction.guild?.id ?? null,
          userId: interaction.user.id,
        },
        error,
      );
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
          botLogger.error(
            "custom_game.cancel.discord_event_delete_failed",
            {
              correlationId,
              errorCategory: "remote_api",
              discordEventId,
              guildId: interaction.guild?.id ?? null,
            },
            e,
          );
        }

        try {
          if (interaction.channel) {
            await interaction.channel.messages.delete(recruitmentMessageId);
          }
        } catch (e) {
          botLogger.error(
            "custom_game.cancel.recruitment_delete_failed",
            {
              correlationId,
              errorCategory: "remote_api",
              recruitmentMessageId,
              channelId: interaction.channel?.id ?? null,
              guildId: interaction.guild?.id ?? null,
            },
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
        botLogger.error(
          "custom_game.cancel.unhandled_error",
          {
            correlationId,
            errorCategory: "unexpected",
            guildId: interaction.guild?.id ?? null,
          },
          e,
        );
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
  const correlationId = crypto.randomUUID();
  botLogger.info("guild.joined", {
    correlationId,
    guildId: guild.id,
    guildName: guild.name,
  });

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
        botLogger.error(
          "guild.roles.setup_failed",
          {
            correlationId,
            errorCategory: "unexpected",
            guildId: guild.id,
            guildName: guild.name,
          },
          result.error,
        );
        break;
    }

    await owner.send(message);
  } catch (error) {
    botLogger.error(
      "guild.owner_notification_failed",
      {
        correlationId,
        errorCategory: "remote_api",
        guildId: guild.id,
        guildName: guild.name,
      },
      error,
    );
  }
});

export class BotStartupError extends Error {
  constructor(
    readonly code:
      | "MISSING_CONFIGURATION"
      | "INVALID_SERVICE_CREDENTIAL"
      | "COMMAND_LOAD_FAILED"
      | "DISCORD_LOGIN_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BotStartupError";
  }
}

type EnvReader = { get(name: string): string | undefined };

interface StartBotDependencies {
  env: EnvReader;
  client: Client;
  loadCommands: typeof loadCommands;
  createApiRpcClients: typeof createApiRpcClients;
  createApiClient: typeof createApiClient;
  configureApiClient: typeof configureApiClient;
}

type StartupLogger = {
  error(
    event: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void;
};

interface BotEntrypointDependencies {
  startBot(): Promise<void>;
  logger: StartupLogger;
  correlationId(): string;
  setExitCode(code: number): void;
}

const defaultStartBotDependencies: StartBotDependencies = {
  env: Deno.env,
  client,
  loadCommands,
  createApiRpcClients,
  createApiClient,
  configureApiClient,
};

// Main function to start the bot
export async function startBot(
  overrides: Partial<StartBotDependencies> = {},
) {
  const dependencies = { ...defaultStartBotDependencies, ...overrides };
  const discordToken = dependencies.env.get("DISCORD_TOKEN");
  if (!discordToken) {
    throw new BotStartupError(
      "MISSING_CONFIGURATION",
      "DISCORD_TOKEN is required",
    );
  }
  const apiUrl = dependencies.env.get("API_URL");
  if (!apiUrl) {
    throw new BotStartupError(
      "MISSING_CONFIGURATION",
      "API_URL is required",
    );
  }
  const botServiceCredential = dependencies.env.get("BOT_SERVICE_TOKEN");
  if (!botServiceCredential) {
    throw new BotStartupError(
      "MISSING_CONFIGURATION",
      "BOT_SERVICE_TOKEN is required",
    );
  }
  let rpcClients: ReturnType<typeof createApiRpcClients>;
  try {
    rpcClients = dependencies.createApiRpcClients({
      apiUrl,
      credential: botServiceCredential,
    });
  } catch (error) {
    throw new BotStartupError(
      "INVALID_SERVICE_CREDENTIAL",
      "BOT_SERVICE_TOKEN is invalid",
      { cause: error },
    );
  }

  let loadResult: Awaited<ReturnType<typeof loadCommands>>;
  try {
    loadResult = await dependencies.loadCommands();
  } catch (error) {
    throw new BotStartupError(
      "COMMAND_LOAD_FAILED",
      "Failed to load slash commands",
      { cause: error },
    );
  }
  if (!loadResult.ok) {
    throw new BotStartupError(
      "COMMAND_LOAD_FAILED",
      `Failed to load slash commands: ${
        formatCommandLoadErrors(loadResult.errors)
      }`,
    );
  }
  const nextCommands = new Collection<string, Command>();
  for (const command of loadResult.commands) {
    nextCommands.set(command.data.name, command);
  }

  const { publicRpcClient, botServiceRpcClient } = rpcClients;
  dependencies.configureApiClient(dependencies.createApiClient({
    rpcClient: botServiceRpcClient,
    publicRpcClient,
  }));
  dependencies.client.commands = nextCommands;
  try {
    await dependencies.client.login(discordToken);
  } catch (error) {
    throw new BotStartupError(
      "DISCORD_LOGIN_FAILED",
      "Discord login failed",
      { cause: error },
    );
  }
}

function classifyBotStartupFailure(error: unknown): {
  reason:
    | "configuration_invalid"
    | "service_credential_invalid"
    | "command_load_failed"
    | "discord_login_failed"
    | "unexpected";
  errorCategory: "validation" | "remote_api" | "unexpected";
} {
  if (!(error instanceof BotStartupError)) {
    return { reason: "unexpected", errorCategory: "unexpected" };
  }

  switch (error.code) {
    case "MISSING_CONFIGURATION":
      return {
        reason: "configuration_invalid",
        errorCategory: "validation",
      };
    case "INVALID_SERVICE_CREDENTIAL":
      return {
        reason: "service_credential_invalid",
        errorCategory: "validation",
      };
    case "COMMAND_LOAD_FAILED":
      return { reason: "command_load_failed", errorCategory: "unexpected" };
    case "DISCORD_LOGIN_FAILED":
      return { reason: "discord_login_failed", errorCategory: "remote_api" };
  }
}

const defaultEntrypointDependencies: BotEntrypointDependencies = {
  startBot: () => startBot(),
  logger: botLogger,
  correlationId: () => crypto.randomUUID(),
  setExitCode: (code) => {
    Deno.exitCode = code;
  },
};

export async function runBotEntrypoint(
  dependencies: BotEntrypointDependencies = defaultEntrypointDependencies,
): Promise<void> {
  const correlationId = dependencies.correlationId();
  try {
    await dependencies.startBot();
  } catch (error) {
    const failure = classifyBotStartupFailure(error);
    dependencies.logger.error(
      "bot.start.failed",
      {
        correlationId,
        errorCategory: failure.errorCategory,
        reason: failure.reason,
      },
      error,
    );
    dependencies.setExitCode(1);
  }
}

// Run the bot only when this file is the main module
if (import.meta.main) {
  await runBotEntrypoint();
}

export { client };
