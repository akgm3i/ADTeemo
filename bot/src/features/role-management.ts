import { DiscordAPIError, type Guild, RESTJSONErrorCodes } from "discord.js";
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

  if (missing.length === 0) {
    return {
      status: "SUCCESS",
      summary: {
        existing,
        created: [],
      },
    };
  }

  const created: string[] = [];
  try {
    const createPromises = missing.map((roleName) =>
      guild.roles.create({
        name: roleName,
      })
    );
    const createdRoles = await Promise.allSettled(createPromises);

    for (const result of createdRoles) {
      if (result.status === "fulfilled") {
        if (result.value) {
          created.push(result.value.name);
        }
      } else {
        // A role creation failed. Handle the error.
        const error = result.reason;
        if (
          error instanceof DiscordAPIError &&
          error.code === RESTJSONErrorCodes.MissingPermissions
        ) {
          return {
            status: "PERMISSION_ERROR",
            message: "The bot lacks the 'Manage Roles' permission.",
          };
        }
        // For any other error, treat it as an unknown error.
        return {
          status: "UNKNOWN_ERROR",
          error,
        };
      }
    }
  } catch (error) {
    // This catch block is for unexpected errors outside of the promises.
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

export const roleManager = {
  ensureRoles,
};
