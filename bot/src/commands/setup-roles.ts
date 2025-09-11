import {
  CommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { ensureRoles } from "../features/role-management.ts";
import { t, m } from "@adteemo/messages";

export const data = new SlashCommandBuilder()
  .setName("setup-roles")
  .setDescription(
    "Creates the necessary roles for the bot if they are missing.",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: t(m.common.info.guildOnlyCommand),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await ensureRoles(interaction.guild);
  let message = "";

  switch (result.status) {
    case "SUCCESS": {
      const { created, existing } = result.summary;
      if (created.length > 0) {
        message = t(m.guild.setup.success.created, {
          count: created.length,
          roles: created.join(", "),
        });
        if (existing.length > 0) {
          message += t(m.guild.setup.success.existing, {
            count: existing.length,
            roles: existing.join(", "),
          });
        }
      } else {
        message = t(m.guild.setup.success.noAction);
      }
      break;
    }
    case "PERMISSION_ERROR":
      message = t(m.guild.setup.error.permission, { message: result.message });
      break;
    case "UNKNOWN_ERROR":
      message = t(m.guild.setup.error.unknown);
      console.error(
        `Error setting up roles via command in guild ${interaction.guild.id}:`,
        result.error,
      );
      break;
  }

  await interaction.editReply(message);
}
