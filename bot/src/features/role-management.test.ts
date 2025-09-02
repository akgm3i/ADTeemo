import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { Collection, DiscordAPIError } from "npm:discord.js";
import type { Guild, Role, RoleCreateOptions } from "npm:discord.js";
import { ensureRoles } from "./role-management.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

describe("ensureRoles", () => {
  it("should identify and create all roles if none exist", async () => {
    const createdRolesLog: RoleCreateOptions[] = [];
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(),
        // Manual mock/spy for the 'create' function
        create: (options: RoleCreateOptions) => {
          createdRolesLog.push(options);
          return Promise.resolve({ name: options.name } as Role);
        },
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    // Assert that the create function was called for each required role
    assertEquals(createdRolesLog.length, DISCORD_ROLES_TO_MANAGE.length);
    for (const roleName of DISCORD_ROLES_TO_MANAGE) {
      assertExists(createdRolesLog.find((role) => role.name === roleName));
    }

    // Assert the result summary is correct
    assertEquals(result.status, "SUCCESS");
    if (result.status === "SUCCESS") {
      assertEquals(
        result.summary.created.sort(),
        [...DISCORD_ROLES_TO_MANAGE].sort(),
      );
      assertEquals(result.summary.existing, []);
    }
  });
  it("should only create roles that are missing", async () => {
    const existingRoles = ["Top", "JG", "Custom"];
    const rolesToCreate = ["Mid", "Bot", "Sup"];

    const createdRolesLog: RoleCreateOptions[] = [];
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(
          existingRoles.map((name, i) => [
            i.toString(),
            { name, id: i.toString() } as Role,
          ]),
        ),
        create: (options: RoleCreateOptions) => {
          createdRolesLog.push(options);
          return Promise.resolve({ name: options.name } as Role);
        },
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    // Assert that create was only called for the missing roles
    assertEquals(createdRolesLog.length, rolesToCreate.length);
    for (const roleName of rolesToCreate) {
      assertExists(createdRolesLog.find((role) => role.name === roleName));
    }

    // Assert the result summary is correct
    assertEquals(result.status, "SUCCESS");
    if (result.status === "SUCCESS") {
      assertEquals(result.summary.created.sort(), rolesToCreate.sort());
      assertEquals(result.summary.existing.sort(), existingRoles.sort());
    }
  });
  it("should not create any roles if all already exist", async () => {
    const createdRolesLog: RoleCreateOptions[] = [];
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(
          DISCORD_ROLES_TO_MANAGE.map((name, i) => [
            i.toString(),
            { name, id: i.toString() } as Role,
          ]),
        ),
        create: (options: RoleCreateOptions) => {
          createdRolesLog.push(options);
          return Promise.resolve({ name: options.name } as Role);
        },
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(createdRolesLog.length, 0);
    assertEquals(result.status, "SUCCESS");
    if (result.status === "SUCCESS") {
      assertEquals(result.summary.created, []);
      assertEquals(
        result.summary.existing.sort(),
        [...DISCORD_ROLES_TO_MANAGE].sort(),
      );
    }
  });

  it("should return a permission error if role creation fails", async () => {
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(),
        create: () => {
          // Simulate a Discord API error for missing permissions
          const errorPayload = { message: "Missing Permissions", code: 50013 };
          throw new DiscordAPIError(errorPayload, 50013, 403, "POST", "/guilds/123/roles", {});
        },
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(result.status, "PERMISSION_ERROR");
  });
});
