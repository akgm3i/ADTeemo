import {
    CommandInteraction,
    Message,
    Collection,
    Snowflake
  } from "discord.js";
  import { formatMessage, type MessageKey } from "../messages.ts";

  export async function askForStat<T extends string | number>(
      interaction: CommandInteraction,
      username: string,
      validationRegex: RegExp,
      promptKey: MessageKey,
      errorKey: MessageKey,
    ): Promise<T | null> {
      while (true) {
        await interaction.editReply(formatMessage(promptKey, { username }));

        const filter = (m: Message) => m.author.id === interaction.user.id;
        const collector = interaction.channel!.createMessageCollector({
            filter,
            time: 60000,
            max: 1,
        });

        try {
            const collected = await new Promise<Collection<Snowflake, Message>>(
                (resolve, reject) => {
                  collector.on("end", (collected, reason) => {
                    if (reason === "time") {
                      return reject(new Error("Collector timed out"));
                    }
                // deno-lint-ignore no-explicit-any
                    resolve(collected as any);
                  });
                },
              );

          const message = collected.first();
          await message?.delete().catch(() => {});

          if (message && validationRegex.test(message.content)) {
            if (promptKey.includes("KDA")) {
              return message.content as T;
            } else {
              return parseInt(message.content, 10) as T;
            }
          } else {
            const warning = await interaction.followUp({
              content: formatMessage(errorKey),
              ephemeral: true,
            });
            setTimeout(() => warning.delete().catch(() => {}), 5000);
          }
        } catch {
          return null; // Timeout
        }
      }
    }
