import type {
  ApplicationIntegrationType,
  InteractionContextType,
} from "discord.js";

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

// Discord API enum values. Keep this registry data-only so boundary checks do
// not load discord.js and its HTTP stack just to enumerate command files.
const guildContext = 0 as InteractionContextType;
const botDmContext = 1 as InteractionContextType;
const guildInstallType = 0 as ApplicationIntegrationType;

const guildInstall = [guildInstallType] as const;
const guildOnly = [guildContext] as const;
const guildAndBotDm = [
  guildContext,
  botDmContext,
] as const;

export const commandRegistry = [
  {
    fileName: "setup-custom-game.ts",
    expectedName: "setup-custom-game",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "start-matching.ts",
    expectedName: "start-matching",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "next-game.ts",
    expectedName: "next-game",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
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
      "RSOのProduction承認・client credential・redirect登録を未確認のため未提供",
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
    status: "disabled",
    disabledReason:
      "全登録accountの既定監視へ移行。watch-settingsと本人のwatch-preferenceを使用",
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
    status: "disabled",
    disabledReason:
      "全登録accountの既定監視へ移行。watch-settingsと本人のwatch-preferenceを使用",
  },
  {
    fileName: "riot-accounts.ts",
    expectedName: "riot-accounts",
    status: "enabled",
    contexts: guildAndBotDm,
    integrationTypes: guildInstall,
  },
  {
    fileName: "watch-settings.ts",
    expectedName: "watch-settings",
    status: "enabled",
    contexts: guildOnly,
    integrationTypes: guildInstall,
  },
  {
    fileName: "watch-preference.ts",
    expectedName: "watch-preference",
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
