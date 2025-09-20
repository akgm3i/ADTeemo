import {
  CommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import * as roleManager from "../features/role-management.ts";
import { formatMessage, messageKeys } from "../messages.ts";

// Exported for testing purposes
export const testable = {
  formatMessage,
  ensureRoles: roleManager.ensureRoles,
};

export const data = new SlashCommandBuilder()
  .setName("setup-roles")
  .setDescription(
    "Creates the necessary roles for the bot if they are missing.",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: testable.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await testable.ensureRoles(interaction.guild);
  let message = "";

  switch (result.status) {
    case "SUCCESS": {
      const { created, existing } = result.summary;
      if (created.length > 0) {
        message = testable.formatMessage(
          messageKeys.guild.setup.success.created,
          {
            count: created.length,
            roles: created.join(", "),
          },
        );
        if (existing.length > 0) {
          message += testable.formatMessage(
            messageKeys.guild.setup.success.existing,
            {
              count: existing.length,
              roles: existing.join(", "),
            },
          );
        }
      } else {
        message = testable.formatMessage(
          messageKeys.guild.setup.success.noAction,
        );
      }
      break;
    }
    case "PERMISSION_ERROR":
      message = testable.formatMessage(
        messageKeys.guild.setup.error.permission,
        {
          message: result.message,
        },
      );
      break;
    case "UNKNOWN_ERROR":
      message = testable.formatMessage(messageKeys.guild.setup.error.unknown);
      console.error(
        `Error setting up roles via command in guild ${interaction.guild.id}:`,
        result.error,
      );
      break;
  }

  await interaction.editReply(message);
}
