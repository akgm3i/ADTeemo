import { handleMatchingSelection } from "./commands/split-teams.ts";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  type Guild,
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
import { createMatchWatchMembershipSync } from "./features/match_watch_membership.ts";
import { handleRiotAccountSelection } from "./commands/riot-accounts.ts";
import { matchTracker } from "./features/match_tracking.ts";
import {
  findCustomGameRecruitmentMessage,
  findCustomGameScheduledEvent,
} from "./features/custom_game_event_discord.ts";
import { createCustomGameEventSaga } from "./features/custom_game_event_saga.ts";
import { messageHandler, messageKeys } from "./messages.ts";
import { botLogger, correlationIdForInteraction } from "./logger.ts";
import type { Command } from "./types.ts";

const customGameEventSaga = createCustomGameEventSaga(apiClient);

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const membershipSync = createMatchWatchMembershipSync(apiClient, {
  onFailure: (guildId, error) =>
    botLogger.error("watch.membership_sync_failed", {
      correlationId: crypto.randomUUID(),
      guildId,
      errorCategory: "remote_api",
    }, error),
});

async function initializeMatchTracking(readyClient: Client<true>) {
  try {
    const persisted = await apiClient.getEnabledMatchWatchers();
    if (!persisted.success) {
      throw new Error("Persisted watchers could not be loaded");
    }
    for (
      const guildId of new Set(
        persisted.watchers.map((watcher) => watcher.guildId),
      )
    ) {
      if (!readyClient.guilds.cache.has(guildId)) {
        await membershipSync.sync(guildId, () => Promise.resolve([]));
      }
    }
    await membershipSync.initialize(
      [...readyClient.guilds.cache.values()].map((guild) => ({
        id: guild.id,
        readMemberIds: async () => {
          const members = await guild.members.fetch();
          return members.filter((member) => !member.user.bot).map((member) =>
            member.id
          );
        },
      })),
      () => matchTracker.startMatchTrackingWorker(readyClient),
    );
  } catch (error) {
    botLogger.error("watch.membership_initial_sync_failed", {
      correlationId: crypto.randomUUID(),
      errorCategory: "remote_api",
    }, error);
    // A failed membership read must not resume persisted outbox work. Retry the
    // complete startup boundary after the service/Discord connection recovers.
    setTimeout(() => {
      void initializeMatchTracking(readyClient);
    }, 30_000);
  }
}
async function refreshGuildMembers(guild: Guild) {
  await membershipSync.refresh(guild.id, async () => {
    if (!client.guilds.cache.has(guild.id)) return [];
    const members = await guild.members.fetch();
    return members.filter((member) => !member.user.bot).map((member) =>
      member.id
    );
  });
}
client.on(Events.GuildMemberAdd, (member) => {
  void refreshGuildMembers(member.guild);
});
client.on(Events.GuildMemberRemove, (member) => {
  void refreshGuildMembers(member.guild);
});
client.on(Events.GuildAvailable, (guild) => {
  void refreshGuildMembers(guild);
});
client.on(Events.GuildDelete, (guild) => {
  membershipSync.cancelRefresh(guild.id);
  void membershipSync.refresh(guild.id, () => Promise.resolve([]));
});

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (c) => {
  botLogger.info("bot.ready", {
    correlationId: crypto.randomUUID(),
    userTag: c.user.tag,
    userId: c.user.id,
  });
  void initializeMatchTracking(c);
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
    if (interaction.customId.startsWith("riot-accounts:")) {
      await handleRiotAccountSelection(interaction);
      return;
    }
    if (interaction.customId === "split-event-select") {
      await handleMatchingSelection(interaction);
      return;
    }
    if (interaction.customId === "cancel-event-select") {
      await interaction.deferUpdate();

      try {
        if (
          !interaction.inGuild() || !interaction.guild || !interaction.channel
        ) {
          await interaction.editReply({
            content: messageHandler.formatMessage(
              messageKeys.customGame.cancel.error.interaction,
            ),
            components: [],
          });
          return;
        }

        const eventId = Number(interaction.values[0]);
        if (!Number.isSafeInteger(eventId) || eventId <= 0) {
          await interaction.editReply({
            content: messageHandler.formatMessage(
              messageKeys.customGame.cancel.error.interaction,
            ),
            components: [],
          });
          return;
        }

        const guild = interaction.guild;
        const recruitmentChannel = interaction.channel;
        const ownedEventsResult = await apiClient.getCustomGameEventsByCreator(
          guild.id,
          recruitmentChannel.id,
          interaction.user.id,
        );
        if (
          !ownedEventsResult.success ||
          !ownedEventsResult.events.some((event) => event.id === eventId)
        ) {
          await interaction.editReply({
            content: messageHandler.formatMessage(
              messageKeys.customGame.cancel.error.interaction,
            ),
            components: [],
          });
          return;
        }

        const cancelResult = await customGameEventSaga.cancel({
          eventId,
          guildId: guild.id,
          recruitmentChannelId: recruitmentChannel.id,
        }, {
          findScheduledEvent: async ({ operationKey }) => {
            const event = await findCustomGameScheduledEvent(
              guild,
              operationKey,
            );
            return event ? { id: event.id } : null;
          },
          findRecruitmentMessage: async (lookupInput) => {
            const message = await findCustomGameRecruitmentMessage(
              recruitmentChannel.messages,
              lookupInput,
            );
            return message ? { id: message.id } : null;
          },
          deleteScheduledEvent: async (discordScheduledEventId) => {
            await guild.scheduledEvents.delete(discordScheduledEventId);
          },
          deleteRecruitmentMessage: async (recruitmentMessageId) => {
            await recruitmentChannel.messages.delete(recruitmentMessageId);
          },
        });

        if (!cancelResult.success) {
          botLogger.error(
            "custom_game.cancel.saga_failed",
            {
              correlationId,
              errorCategory: "remote_api",
              eventId,
              failedStep: cancelResult.error.primaryFailure.step,
              recoveryFailureCount: cancelResult.error.recoveryFailures.length,
              channelId: recruitmentChannel.id,
              guildId: guild.id,
            },
            cancelResult.error,
          );
          await interaction.editReply({
            content: messageHandler.formatMessage(
              messageKeys.customGame.cancel.error.interaction,
            ),
            components: [],
          });
          return;
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
    await refreshGuildMembers(guild);
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
