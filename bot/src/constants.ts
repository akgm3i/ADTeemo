// bot/src/constants.ts
import type { Lane } from "@adteemo/api/schema";

// Mapping from the API's internal role name (`Lane`) to the name displayed on Discord.
export const ROLE_DISPLAY_NAMES: Record<Lane, string> = {
  Top: "Top",
  Jungle: "JG",
  Middle: "Mid",
  Bottom: "Bot",
  Support: "Sup",
};

// An array of all Discord role names that the bot should create and manage.
export const DISCORD_ROLES_TO_MANAGE = [
  ...Object.values(ROLE_DISPLAY_NAMES),
  "Custom",
] as const;
export type DiscordRole = (typeof DISCORD_ROLES_TO_MANAGE)[number];

export const TEAM_A_VC_NAME = "Red Team";
export const TEAM_B_VC_NAME = "Blue Team";

export const ROLE_EMOJIS: Record<Lane, string> = {
  Top: "🇹",
  Jungle: "🇯",
  Middle: "🇲",
  Bottom: "🇧",
  Support: "🇸",
};
