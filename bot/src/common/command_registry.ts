export type CommandStatus = "enabled" | "disabled";

export interface CommandRegistration {
  fileName: string;
  expectedName: string;
  status: CommandStatus;
  disabledReason?: string;
}

export const commandRegistry = [
  {
    fileName: "cancel-custom-game.ts",
    expectedName: "cancel-custom-game",
    status: "enabled",
  },
  {
    fileName: "create-custom-game.ts",
    expectedName: "create-custom-game",
    status: "enabled",
  },
  { fileName: "health.ts", expectedName: "health", status: "enabled" },
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
  },
  {
    fileName: "set-main-role.ts",
    expectedName: "set-main-role",
    status: "enabled",
  },
  {
    fileName: "set-riot-id.ts",
    expectedName: "set-riot-id",
    status: "enabled",
  },
  {
    fileName: "setup-roles.ts",
    expectedName: "setup-roles",
    status: "enabled",
  },
  {
    fileName: "split-teams.ts",
    expectedName: "split-teams",
    status: "enabled",
  },
  {
    fileName: "unwatch-match.ts",
    expectedName: "unwatch-match",
    status: "enabled",
  },
  { fileName: "watch-list.ts", expectedName: "watch-list", status: "enabled" },
  {
    fileName: "watch-match.ts",
    expectedName: "watch-match",
    status: "enabled",
  },
] as const satisfies readonly CommandRegistration[];

export function enabledCommandRegistrations(
  registry: readonly CommandRegistration[] = commandRegistry,
) {
  return registry.filter((entry) => entry.status === "enabled");
}
