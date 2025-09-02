import { assert, assertEquals } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";
import {
  Collection,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type CommandInteraction,
  type Guild,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessagePayload,
  type Role,
} from "npm:discord.js";
import { execute } from "./setup-roles.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

Deno.test("Setup Roles Command", async (t) => {
  // Helper to create a mock interaction and guild
  const setupMocks = (
    existingRoles: string[] = [],
    roleCreateError?: Error,
  ) => {
    const deferReplySpy = spy((_o?: InteractionDeferReplyOptions) => Promise.resolve());
    const editReplySpy = spy((_o: string | MessagePayload | InteractionEditReplyOptions) => Promise.resolve());
    const replySpy = spy((_o: string | InteractionReplyOptions) => Promise.resolve());

    const mockRoles = new Collection<string, Role>(
      existingRoles.map((name, i) => [
        `role_id_${i}`,
        { name } as Role,
      ]),
    );

    const rolesCreateSpy = spy((options?: { name: string }) => {
        if (roleCreateError) return Promise.reject(roleCreateError);
        return Promise.resolve({ name: options?.name } as Role);
    });

    const mockGuild = {
      id: "mock-guild-id",
      roles: {
        cache: mockRoles,
        create: rolesCreateSpy,
      },
    } as unknown as Guild;

    const interaction = {
      isChatInputCommand: () => true,
      deferReply: deferReplySpy,
      editReply: editReplySpy,
      reply: replySpy,
      guild: mockGuild,
    } as unknown as CommandInteraction;

    return { deferReplySpy, editReplySpy, replySpy, interaction, rolesCreateSpy };
  };

  await t.step("should reply with an error if not used in a guild", async () => {
    const { replySpy, interaction } = setupMocks();
    (interaction as { guild: Guild | null }).guild = null;
    await execute(interaction);
    assertEquals(replySpy.calls.length, 1);
    const replyArgs = replySpy.calls[0].args[0] as InteractionReplyOptions;
    assertEquals(replyArgs.content, "This command can only be used in a server.");
    assertEquals(replyArgs.ephemeral, true);
  });

  await t.step("should create missing roles and report success", async () => {
    const { deferReplySpy, editReplySpy, interaction, rolesCreateSpy } = setupMocks(["Top", "JG"]);
    await execute(interaction);

    const expectedToCreate = DISCORD_ROLES_TO_MANAGE.length - 2;
    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(rolesCreateSpy.calls.length, expectedToCreate);
    assertEquals(editReplySpy.calls.length, 1);
    const replyMessage = editReplySpy.calls[0].args[0] as string;
    assert(replyMessage.includes("✅ セットアップ完了！"));
    assert(replyMessage.includes(`作成したロール (${expectedToCreate}件)`));
    assert(replyMessage.includes("既存のロール (2件)"));
  });

  await t.step("should report success when all roles already exist", async () => {
    const { deferReplySpy, editReplySpy, interaction, rolesCreateSpy } = setupMocks([...DISCORD_ROLES_TO_MANAGE]);
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(rolesCreateSpy.calls.length, 0);
    assertEquals(editReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls[0].args[0], "✅ 必要なロールはすべて存在しています。");
  });

  await t.step("should handle permission errors during role creation", async () => {
      const error = new DiscordAPIError(
          { message: "Missing Permissions", code: RESTJSONErrorCodes.MissingPermissions },
          RESTJSONErrorCodes.MissingPermissions,
          403,
          "PUT",
          "/guilds/id/roles",
          {}
      );
    const { deferReplySpy, editReplySpy, interaction } = setupMocks([], error);
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls[0].args[0], "❌ 権限エラー。\nThe bot lacks the 'Manage Roles' permission.");
  });

  await t.step("should handle unknown errors during role creation", async () => {
    const { deferReplySpy, editReplySpy, interaction } = setupMocks([], new Error("Some other error"));
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls.length, 1);
    assert((editReplySpy.calls[0].args[0] as string).startsWith("❌ 不明なエラー。"));
  });
});
