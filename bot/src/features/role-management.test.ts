import { assertEquals, assertExists } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { ensureRoles } from "./role-management.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";
import { MockGuildBuilder } from "../test_utils.ts";

describe("ensureRoles", () => {
  test("管理対象のロールが一つも存在しないギルドで実行すると、すべてのロールを作成する", async () => {
    // Arrange
    const mockGuild = new MockGuildBuilder().build();
    using createSpy = spy(mockGuild.roles, "create");

    // Act
    const result = await ensureRoles(mockGuild);

    // Assert
    assertSpyCalls(createSpy, DISCORD_ROLES_TO_MANAGE.length);
    for (const roleName of DISCORD_ROLES_TO_MANAGE) {
      assertExists(
        createSpy.calls.find((call) => call.args[0]?.name === roleName),
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

  test("管理対象のロールが一部のみ存在するギルドで実行すると、不足しているロールのみを作成する", async () => {
    // Arrange
    const existingRoleNames = ["Top", "JG", "Custom"];
    const rolesToCreate = DISCORD_ROLES_TO_MANAGE.filter(
      (r) => !existingRoleNames.includes(r),
    );
    const guildBuilder = new MockGuildBuilder();
    for (const roleName of existingRoleNames) {
      guildBuilder.withRole({ id: roleName, name: roleName });
    }
    const mockGuild = guildBuilder.build();
    using createSpy = spy(mockGuild.roles, "create");

    // Act
    const result = await ensureRoles(mockGuild);

    // Assert
    assertSpyCalls(createSpy, rolesToCreate.length);
    for (const roleName of rolesToCreate) {
      assertExists(
        createSpy.calls.find((call) => call.args[0]?.name === roleName),
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

  test("管理対象のロールがすべて存在するギルドで実行すると、ロールを一つも作成しない", async () => {
    // Arrange
    const guildBuilder = new MockGuildBuilder();
    for (const roleName of DISCORD_ROLES_TO_MANAGE) {
      guildBuilder.withRole({ id: roleName, name: roleName });
    }
    const mockGuild = guildBuilder.build();
    using createSpy = spy(mockGuild.roles, "create");

    // Act
    const result = await ensureRoles(mockGuild);

    // Assert
    assertSpyCalls(createSpy, 0);
    assertEquals(result.status, "SUCCESS");
    if (result.status === "SUCCESS") {
      assertEquals(result.summary.created, []);
      assertEquals(
        result.summary.existing.sort(),
        [...DISCORD_ROLES_TO_MANAGE].sort(),
      );
    }
  });

  test("ロールの作成中に権限エラーが発生すると、PERMISSION_ERRORステータスを返す", async () => {
    // Arrange
    const error = new DiscordAPIError(
      { message: "Missing Permissions", code: 50013 },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      "POST",
      "/guilds/123/roles",
      {},
    );
    const mockGuild = new MockGuildBuilder().build();
    using _createStub = stub(
      mockGuild.roles,
      "create",
      () => Promise.reject(error),
    );

    // Act
    const result = await ensureRoles(mockGuild);

    // Assert
    assertEquals(result.status, "PERMISSION_ERROR");
  });
});
