import {
  ActionRowBuilder,
  type CommandInteraction,
  escapeMarkdown,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const PAGE_SIZE = 10;
export const data = new SlashCommandBuilder().setName("riot-accounts")
  .setDescription("登録アカウントの一覧・メイン選択・解除を行います。")
  .addStringOption((option) =>
    option.setName("action").setDescription("操作").addChoices(
      { name: "一覧", value: "list" },
      { name: "メイン変更", value: "main" },
      { name: "選択して解除", value: "remove" },
    )
  )
  .addIntegerOption((option) =>
    option.setName("page").setDescription("一覧のページ番号").setMinValue(1)
  );
export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await apiClient.getRiotAccounts(interaction.user.id);
  if (!result.success || !result.accounts.length) {
    await interaction.editReply({
      content: messageHandler.formatMessage(
        result.success
          ? messageKeys.riotAccounts.empty
          : messageKeys.riotAccounts.error,
      ),
    });
    return;
  }
  const action = interaction.options.getString("action") ?? "list";
  const pages = Math.ceil(result.accounts.length / PAGE_SIZE);
  const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
  const accounts = result.accounts.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const mainLabel = messageHandler.formatMessage(messageKeys.riotAccounts.main);
  const content = [
    messageHandler.formatMessage(messageKeys.riotAccounts.header, {
      page,
      pages,
    }),
    ...accounts.map((account) =>
      `${account.isMain ? `★ ${mainLabel}: ` : ""}${
        escapeMarkdown(`${account.gameName}#${account.tagLine}`)
      } (${account.platform.toUpperCase()})`
    ),
  ].join("\n");
  const components = action === "list"
    ? []
    : [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(
        `riot-accounts:${action}:${interaction.user.id}`,
      )
        .setPlaceholder(
          messageHandler.formatMessage(messageKeys.riotAccounts.choose),
        )
        .addOptions(accounts.map((account) => ({
          label: `${account.gameName}#${account.tagLine}`.slice(0, 100),
          value: account.puuid,
          description: `${
            account.isMain ? `${mainLabel} / ` : ""
          }${account.platform.toUpperCase()}`,
        }))),
    )];
  await interaction.editReply({ content, components });
}
export async function handleRiotAccountSelection(
  interaction: StringSelectMenuInteraction,
) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (
    ownerId !== interaction.user.id || !["main", "remove"].includes(action) ||
    interaction.values.length !== 1
  ) {
    await interaction.reply({
      content: messageHandler.formatMessage(messageKeys.riotAccounts.ownerOnly),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  const result = action === "main"
    ? await apiClient.setMainRiotAccount(
      interaction.user.id,
      interaction.values[0],
    )
    : await apiClient.deleteRiotAccount(
      interaction.user.id,
      interaction.values[0],
    );
  await interaction.editReply({
    content: messageHandler.formatMessage(
      result.success
        ? (action === "main"
          ? messageKeys.riotAccounts.saved
          : messageKeys.riotAccounts.removed)
        : messageKeys.riotAccounts.error,
    ),
    components: [],
  });
}
