import { Collection, CommandInteraction, Message, Snowflake } from "discord.js";
import { messageHandler, type MessageKey } from "../messages.ts";

export type StatCollectionResult<T> =
  | { status: "value"; value: T }
  | { status: "timeout" }
  | { status: "cancelled" }
  | { status: "failure"; error: unknown };

type CollectorResult =
  | {
    status: "collected";
    messages: Collection<Snowflake, Message>;
    reason: string;
  }
  | { status: "timeout" };

function isCancellationInput(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized === "cancel" || normalized === "キャンセル";
}

async function askForStat<T extends string | number>(
  interaction: CommandInteraction,
  username: string,
  validationRegex: RegExp,
  promptKey: MessageKey,
  errorKey: MessageKey,
): Promise<StatCollectionResult<T>> {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return {
      status: "failure",
      error: new Error("Stat collection requires a guild chat input command"),
    };
  }

  while (true) {
    try {
      await interaction.editReply(
        messageHandler.formatMessage(promptKey, { username }),
      );

      const filter = (message: Message) =>
        message.author.id === interaction.user.id;
      if (!interaction.channel) {
        return {
          status: "failure",
          error: new Error("Stat collection requires a message channel"),
        };
      }
      const collector = interaction.channel.createMessageCollector({
        filter,
        time: 60000,
        max: 1,
      });

      const collectorResult = await new Promise<CollectorResult>(
        (resolve, reject) => {
          try {
            collector.on("end", (collected, reason) => {
              if (reason === "time") {
                resolve({ status: "timeout" });
                return;
              }
              resolve({
                status: "collected",
                messages: new Collection(collected),
                reason,
              });
            });
          } catch (error) {
            reject(error);
          }
        },
      );

      if (collectorResult.status === "timeout") {
        return { status: "timeout" };
      }

      const message = collectorResult.messages.first();
      if (!message) {
        return {
          status: "failure",
          error: new Error(
            `Collector ended without a message: ${collectorResult.reason}`,
          ),
        };
      }

      await message.delete();

      if (isCancellationInput(message.content)) {
        return { status: "cancelled" };
      }

      validationRegex.lastIndex = 0;
      if (validationRegex.test(message.content)) {
        if (promptKey.includes("KDA")) {
          return { status: "value", value: message.content as T };
        }
        return {
          status: "value",
          value: parseInt(message.content, 10) as T,
        };
      }

      const warning = await interaction.followUp({
        content: messageHandler.formatMessage(errorKey),
        ephemeral: true,
      });
      setTimeout(() => warning.delete().catch(() => {}), 5000);
    } catch (error) {
      return { status: "failure", error };
    }
  }
}

export const statCollector = {
  askForStat,
};
