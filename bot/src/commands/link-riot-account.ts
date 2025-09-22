import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { apiClient } from "../api_client.ts";
import { Command } from "../types.ts";
import { v1 as uuid } from "@std/uuid";

// Exported for testing purposes
export const testable = {
  apiClient,
  uuid,
};

const RSO_PROVIDER_URL = "https://auth.riotgames.com";
const RSO_CALLBACK_PATH = "/auth/rso/callback";

export async function execute(interaction: CommandInteraction) {
  const state = testable.uuid.generate() as string;
  const discordId = interaction.user.id;

  const result = await testable.apiClient.createAuthState(state, discordId);

  if (!result.success) {
    await interaction.reply({
      content: `エラーが発生しました: ${result.error}`,
      ephemeral: true,
    });
    return;
  }

  const clientId = Deno.env.get("RSO_CLIENT_ID");
  const redirectUriBase = Deno.env.get("RSO_REDIRECT_URI");

  if (!clientId || !redirectUriBase) {
    console.error("RSO environment variables are not set for the bot.");
    await interaction.reply({
      content: "現在この機能は利用できません。管理者にお問い合わせください。",
      ephemeral: true,
    });
    return;
  }

  const authUrl = new URL(`${RSO_PROVIDER_URL}/authorize`);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", clientId);
  authUrl.searchParams.append(
    "redirect_uri",
    `${redirectUriBase}${RSO_CALLBACK_PATH}`,
  );
  authUrl.searchParams.append("scope", "openid");
  authUrl.searchParams.append("state", state);

  await interaction.reply({
    content:
      `Riot Gamesアカウントと連携するには、以下のリンクにアクセスして認証を完了してください。\n\n${authUrl.toString()}`,
    ephemeral: true,
  });
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("link-riot-account")
    .setDescription("Riot GamesアカウントをBotに連携します。"),
  execute,
};
