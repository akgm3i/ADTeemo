import {
  CommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { roleManager } from "../features/role-management.ts";
import { messageHandler, messageKeys } from "../messages.ts";

export const data = new SlashCommandBuilder()
  .setName("setup-roles")
  .setDescription(
    "Botが必要とするロールを自動で作成します。",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await roleManager.ensureRoles(interaction.guild);
  let message = "";

  switch (result.status) {
    case "SUCCESS": {
      const { created, existing } = result.summary;
      if (created.length > 0) {
        message = messageHandler.formatMessage(
          messageKeys.guild.setup.success.created,
          {
            count: created.length,
            roles: created.join(", "),
          },
        );
        if (existing.length > 0) {
          message += messageHandler.formatMessage(
            messageKeys.guild.setup.success.existing,
            {
              count: existing.length,
              roles: existing.join(", "),
            },
          );
        }
      } else {
        message = messageHandler.formatMessage(
          messageKeys.guild.setup.success.noAction,
        );
      }
      break;
    }
    case "PERMISSION_ERROR":
      message = messageHandler.formatMessage(
        messageKeys.guild.setup.error.permission,
        {
          message: result.message,
        },
      );
      break;
    case "UNKNOWN_ERROR":
      message = messageHandler.formatMessage(
        messageKeys.guild.setup.error.unknown,
      );
      console.error(
        `Error setting up roles via command in guild ${interaction.guild.id}:`,
        result.error,
      );
      break;
  }

  await interaction.editReply(message);
}
