import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import {
  Collection,
  DiscordAPIError,
  type Guild,
  RESTJSONErrorCodes,
  type Role,
  type RoleCreateOptions,
} from "discord.js";
import { ensureRoles } from "./role-management.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

describe("ensureRoles", () => {
  it("管理対象のロールが一つも存在しないギルドで実行すると、すべてのロールを作成する", async () => {
    const createSpy = spy(
      (options: RoleCreateOptions): Promise<Role> =>
        Promise.resolve({ name: options.name } as Role),
    );
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(),
        create: createSpy,
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(createSpy.calls.length, DISCORD_ROLES_TO_MANAGE.length);
    for (const roleName of DISCORD_ROLES_TO_MANAGE) {
      assertExists(
        createSpy.calls.find(({ args }) => args[0].name === roleName),
      );
    }

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
    const existingRoleNames = ["Top", "JG", "Custom"];
    const rolesToCreate = DISCORD_ROLES_TO_MANAGE.filter(
      (r) => !existingRoleNames.includes(r),
    );
    const createSpy = spy(
      (options: RoleCreateOptions): Promise<Role> =>
        Promise.resolve({ name: options.name } as Role),
    );
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(
          existingRoleNames.map((name, i) => [
            i.toString(),
            { name, id: i.toString() } as Role,
          ]),
        ),
        create: createSpy,
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(createSpy.calls.length, rolesToCreate.length);
    for (const roleName of rolesToCreate) {
      assertExists(
        createSpy.calls.find(({ args }) => args[0].name === roleName),
      );
    }

    assertEquals(result.status, "SUCCESS");
    if (result.status === "SUCCESS") {
      assertEquals(result.summary.created.sort(), rolesToCreate.sort());
      assertEquals(
        result.summary.existing.sort(),
        existingRoleNames.sort(),
      );
    }
  });

  it("管理対象のロールがすべて存在するギルドで実行すると、ロールを一つも作成しない", async () => {
    const existingRoleNames = [...DISCORD_ROLES_TO_MANAGE];
    const createSpy = spy(
      (options: RoleCreateOptions): Promise<Role> =>
        Promise.resolve({ name: options.name } as Role),
    );
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(
          existingRoleNames.map((name, i) => [
            i.toString(),
            { name, id: i.toString() } as Role,
          ]),
        ),
        create: createSpy,
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(createSpy.calls.length, 0);
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
    const error = new DiscordAPIError(
      { message: "Missing Permissions", code: 50013 },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      "POST",
      "/guilds/123/roles",
      {},
    );
    const createSpy = spy(
      (_options: RoleCreateOptions): Promise<Role> => Promise.reject(error),
    );
    const mockGuild = {
      roles: {
        cache: new Collection<string, Role>(),
        create: createSpy,
      },
    } as unknown as Guild;

    const result = await ensureRoles(mockGuild);

    assertEquals(result.status, "PERMISSION_ERROR");
  });
});
