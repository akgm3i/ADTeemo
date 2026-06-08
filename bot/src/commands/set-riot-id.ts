import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { RiotPlatform, RiotRegion } from "@adteemo/api/schema";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const platformChoices: RiotPlatform[] = [
  "jp1",
  "kr",
  "na1",
  "euw1",
  "eun1",
  "br1",
  "la1",
  "la2",
  "oc1",
  "tr1",
  "ru",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
];

function regionForPlatform(platform: RiotPlatform): RiotRegion {
  if (["na1", "br1", "la1", "la2"].includes(platform)) return "americas";
  if (["euw1", "eun1", "tr1", "ru"].includes(platform)) return "europe";
  if (["ph2", "sg2", "th2", "tw2", "vn2"].includes(platform)) return "sea";
  return "asia";
}

export const data = new SlashCommandBuilder()
  .setName("set-riot-id")
  .setDescription("Riot IDを登録・更新します。(例: Faker#KR1)")
  .addStringOption((option) =>
    option
      .setName("riot-id")
      .setDescription("サモナー名#タグライン の形式で入力してください。")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("platform")
      .setDescription("LoLサーバー")
      .setRequired(false)
      .addChoices(
        ...platformChoices.map((platform) => ({
          name: platform.toUpperCase(),
          value: platform,
        })),
      )
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const riotId = interaction.options.getString("riot-id", true);
  const parts = riotId.split("#");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    await interaction.editReply({
      content: messageHandler.formatMessage(
        messageKeys.riotAccount.set.error.invalidFormat,
      ),
    });
    return;
  }

  const [gameName, tagLine] = parts;
  const platform =
    (interaction.options.getString("platform") ?? "jp1") as RiotPlatform;
  const region = regionForPlatform(platform);

  const result = await apiClient.linkAccountByRiotId(
    interaction.user.id,
    gameName,
    tagLine,
    platform,
    region,
  );

  if (!result.success) {
    await interaction.editReply({
      content: messageHandler.formatMessage(
        messageKeys.riotAccount.link.error.generic,
        {
          error: result.error || "",
        },
      ),
    });
    return;
  }

  await interaction.editReply({
    content: messageHandler.formatMessage(
      messageKeys.riotAccount.link.success.title,
    ),
  });
}
