import { DiscordAPIError, type Guild } from "npm:discord.js";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

export type EnsureRolesResult =
  | {
      status: "SUCCESS";
      summary: {
        existing: string[];
        created: string[];
      };
    }
  | {
      status: "PERMISSION_ERROR";
      message: string;
    }
  | {
      status: "UNKNOWN_ERROR";
      error: unknown;
    };

/**
 * Checks a guild for the required bot roles and creates any that are missing.
 * @param guild The discord.js Guild object.
 * @returns A result object summarizing the actions taken or any errors.
 */
export async function ensureRoles(guild: Guild): Promise<EnsureRolesResult> {
  const existingRoleNames = new Set(guild.roles.cache.map((role) => role.name));
  const existing: string[] = [];
  const missing: string[] = [];

  for (const roleName of DISCORD_ROLES_TO_MANAGE) {
    if (existingRoleNames.has(roleName)) {
      existing.push(roleName);
    } else {
      missing.push(roleName);
    }
  }

  const created: string[] = [];
  try {
    for (const roleName of missing) {
      const createdRole = await guild.roles.create({
        name: roleName,
        // Using default permissions, color, etc., as requested.
      });
      created.push(createdRole.name);
    }
  } catch (error) {
    // Handle permission errors specifically
    if (error instanceof DiscordAPIError && error.code === 50013) { // 50013: Missing Permissions
      return {
        status: "PERMISSION_ERROR",
        message: "The bot lacks the 'Manage Roles' permission.",
      };
    }
    // Handle other potential errors
    return {
      status: "UNKNOWN_ERROR",
      error,
    };
  }

  return {
    status: "SUCCESS",
    summary: {
      existing,
      created,
    },
  };
}
