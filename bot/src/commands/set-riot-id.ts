import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import {
  type CurrentRiotPlatform,
  currentRiotPlatforms,
  defaultRiotPlatform,
  riotRegionForPlatform,
} from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

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
        ...currentRiotPlatforms.map((platform) => ({
          name: platform.toUpperCase(),
          value: platform,
        })),
      )
  ).addStringOption((option) =>
    option.setName("watch-preference").setDescription(
      "このサーバーでの本人の監視設定",
    ).addChoices({ name: "停止する", value: "opt-out" }, {
      name: "監視を許可する",
      value: "opt-in",
    })
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
  const platform = (interaction.options.getString("platform") ??
    defaultRiotPlatform) as CurrentRiotPlatform;
  const region = riotRegionForPlatform(platform);

  const preference = interaction.options.getString("watch-preference");
  if (preference && !interaction.guildId) {
    await interaction.editReply({
      content: messageHandler.formatMessage(
        messageKeys.common.info.guildOnlyCommand,
      ),
    });
    return;
  }
  if (preference && interaction.guildId) {
    const updated = await apiClient.setMatchWatchOptOut(
      interaction.guildId,
      interaction.user.id,
      preference === "opt-out",
    );
    if (!updated.success) {
      await interaction.editReply({
        content: messageHandler.formatMessage(messageKeys.watchPolicy.error),
      });
      return;
    }
  }
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
    ) + "\n" +
      messageHandler.formatMessage(messageKeys.watchPolicy.registration),
  });
}
