import { assert, assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { spy } from "jsr:@std/testing/mock";
import {
  Collection,
  type CommandInteraction,
  DiscordAPIError,
  type Guild,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessagePayload,
  RESTJSONErrorCodes,
  type Role,
} from "npm:discord.js";
import { execute } from "./setup-roles.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";

describe("Setup Roles Command", () => {
  // Helper to create a mock interaction and guild
  const setupMocks = (
    existingRoles: string[] = [],
    roleCreateError?: Error,
  ) => {
    const deferReplySpy = spy((_o?: InteractionDeferReplyOptions) =>
      Promise.resolve()
    );
    const editReplySpy = spy((
      _o: string | MessagePayload | InteractionEditReplyOptions,
    ) => Promise.resolve());
    const replySpy = spy((_o: string | InteractionReplyOptions) =>
      Promise.resolve()
    );

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

    return {
      deferReplySpy,
      editReplySpy,
      replySpy,
      interaction,
      rolesCreateSpy,
    };
  };

  it("ギルド（サーバー）外でコマンドを実行すると、エラーメッセージを返信する", async () => {
    const { replySpy, interaction } = setupMocks();
    (interaction as { guild: Guild | null }).guild = null;
    await execute(interaction);
    assertEquals(replySpy.calls.length, 1);
    const replyArgs = replySpy.calls[0].args[0] as InteractionReplyOptions;
    assertEquals(
      replyArgs.content,
      "This command can only be used in a server.",
    );
    assertEquals(replyArgs.ephemeral, true);
  });

  it("不足しているロールがある場合にコマンドを実行すると、それらを作成して成功を報告する", async () => {
    const { deferReplySpy, editReplySpy, interaction, rolesCreateSpy } =
      setupMocks(["Top", "JG"]);
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

  it("管理対象の全ロールが既に存在する場合にコマンドを実行すると、ロールを作成せずに成功を報告する", async () => {
    const { deferReplySpy, editReplySpy, interaction, rolesCreateSpy } =
      setupMocks([...DISCORD_ROLES_TO_MANAGE]);
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(rolesCreateSpy.calls.length, 0);
    assertEquals(editReplySpy.calls.length, 1);
    assertEquals(
      editReplySpy.calls[0].args[0],
      "✅ 必要なロールはすべて存在しています。",
    );
  });

  it("ロール作成中に権限エラーが発生した場合、コマンドは権限エラーとして処理する", async () => {
    const error = new DiscordAPIError(
      {
        message: "Missing Permissions",
        code: RESTJSONErrorCodes.MissingPermissions,
      },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      "PUT",
      "/guilds/id/roles",
      {},
    );
    const { deferReplySpy, editReplySpy, interaction } = setupMocks(
      [],
      error,
    );
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls.length, 1);
    assertEquals(
      editReplySpy.calls[0].args[0],
      "❌ 権限エラー。\nThe bot lacks the 'Manage Roles' permission.",
    );
  });

  it("ロール作成中に不明なエラーが発生した場合、コマンドは不明なエラーとして処理する", async () => {
    const { deferReplySpy, editReplySpy, interaction } = setupMocks(
      [],
      new Error("Some other error"),
    );
    await execute(interaction);

    assertEquals(deferReplySpy.calls.length, 1);
    assertEquals(editReplySpy.calls.length, 1);
    assert(
      (editReplySpy.calls[0].args[0] as string).startsWith(
        "❌ 不明なエラー。",
      ),
    );
  });
});
