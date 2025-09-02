import {
  CommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "npm:discord.js";
import { ensureRoles } from "../features/role-management.ts";

export const data = new SlashCommandBuilder()
  .setName("setup-roles")
  .setDescription("Creates the necessary roles for the bot if they are missing.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await ensureRoles(interaction.guild);
  let message = "";

  switch (result.status) {
    case "SUCCESS": {
      const { created, existing } = result.summary;
      if (created.length > 0) {
        message =
          `✅ セットアップ完了！\n作成したロール (${created.length}件): \`${
            created.join(", ")
          }\`\n既存のロール (${existing.length}件): \`${existing.join(", ")}\``;
      } else {
        message = `✅ セットアップ不要！\n必要なロールはすべて存在しています。`;
      }
      break;
    }
    case "PERMISSION_ERROR":
      message = `❌ 権限エラー！\n${result.message}`;
      break;
    case "UNKNOWN_ERROR":
      message = `❌ 不明なエラー！\nロールのセットアップ中にエラーが発生しました。`;
      console.error(
        `Error setting up roles via command in guild ${interaction.guild.id}:`,
        result.error,
      );
      break;
  }

  await interaction.editReply(message);
}
