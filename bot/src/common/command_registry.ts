import { ApplicationIntegrationType, InteractionContextType } from "discord.js";

export type CommandStatus = "enabled" | "disabled";

export interface EnabledCommandRegistration {
  fileName: string;
  expectedName: string;
  status: "enabled";
  contexts: readonly InteractionContextType[];
  integrationTypes: readonly ApplicationIntegrationType[];
}

export interface DisabledCommandRegistration {
  fileName: string;
  expectedName: string;
  status: "disabled";
  disabledReason: string;
}

export type CommandRegistration =
  | EnabledCommandRegistration
  | DisabledCommandRegistration;

const guildInstall = [ApplicationIntegrationType.GuildInstall] as const;
const guildOnly = [InteractionContextType.Guild] as const;
const guildAndBotDm = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
] as const;

export const commandRegistry = [
  {
    fileName: "cancel-custom-game.ts",
    expectedName: "cancel-custom-game",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "create-custom-game.ts",
    expectedName: "create-custom-game",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "health.ts",
    expectedName: "health",
    status: "enabled",
    contexts: guildAndBotDm,
    integrationTypes: guildInstall,
  },
  {
    fileName: "link-riot-account.ts",
    expectedName: "link-riot-account",
    status: "disabled",
    disabledReason:
      "Issue #117でcanonical Riot account modelへ接続するまで未提供",
  },
  {
    fileName: "record-match.ts",
    expectedName: "record-match",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "set-main-role.ts",
    expectedName: "set-main-role",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "set-riot-id.ts",
    expectedName: "set-riot-id",
    status: "enabled",
    contexts: guildAndBotDm,
    integrationTypes: guildInstall,
  },
  {
    fileName: "setup-roles.ts",
    expectedName: "setup-roles",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "split-teams.ts",
    expectedName: "split-teams",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "unwatch-match.ts",
    expectedName: "unwatch-match",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "watch-list.ts",
    expectedName: "watch-list",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "watch-match.ts",
    expectedName: "watch-match",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
] as const satisfies readonly CommandRegistration[];

export function enabledCommandRegistrations(
  registry: readonly CommandRegistration[] = commandRegistry,
): readonly EnabledCommandRegistration[] {
  return registry.filter(
    (entry): entry is EnabledCommandRegistration => entry.status === "enabled",
  );
}
