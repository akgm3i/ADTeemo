import { assertEquals, assertExists } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { Collection, DiscordAPIError } from "npm:discord.js";
import type { Guild, Role, RoleCreateOptions } from "npm:discord.js";
import { ensureRoles } from "./role-management.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

describe("ensureRoles", () => {
  it("管理対象のロールが一つも存在しないギルドで実行すると、すべてのロールを作成する", async () => {
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

  it("管理対象のロールが一部のみ存在するギルドで実行すると、不足しているロールのみを作成する", async () => {
    const existingRoles = ["Top", "JG", "Custom"];
    const rolesToCreate = DISCORD_ROLES_TO_MANAGE.filter(
      (r) => !existingRoles.includes(r),
    );

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

  it("管理対象のロールがすべて存在するギルドで実行すると、ロールを一つも作成しない", async () => {
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

  it("ロールの作成中に権限エラーが発生すると、PERMISSION_ERRORステータスを返す", async () => {
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(),
        create: () => {
          // Simulate a Discord API error for missing permissions
          const errorPayload = { message: "Missing Permissions", code: 50013 };
          const error = new DiscordAPIError(
            errorPayload,
            50013,
            403,
            "POST",
            "/guilds/123/roles",
            {},
          );
          return Promise.reject(error);
        },
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(result.status, "PERMISSION_ERROR");
  });
});
