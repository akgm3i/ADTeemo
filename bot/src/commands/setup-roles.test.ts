import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";
import {
  Collection,
  DiscordAPIError,
  type Guild,
  type InteractionReplyOptions,
  MessageFlags,
  RESTJSONErrorCodes,
  type Role,
} from "discord.js";
import { execute } from "./setup-roles.ts";
import { DISCORD_ROLES_TO_MANAGE } from "../constants.ts";
import { newMockChatInputCommandInteractionBuilder } from "../test_utils.ts";

describe("Setup Roles Command", () => {
  it("ギルド（サーバー）外でコマンドを実行すると、エラーメッセージを返信する", async () => {
    const interaction = newMockChatInputCommandInteractionBuilder().withGuild(
      null,
    ).build();

    await execute(interaction);

    assertEquals(interaction.reply.calls.length, 1);
    const replyArgs = interaction.reply.calls[0]
      .args[0] as InteractionReplyOptions;
    assertEquals(
      replyArgs.content,
      "This command can only be used in a server.",
    );
    assertEquals(replyArgs.flags, MessageFlags.Ephemeral);
  });

  it("不足しているロールがある場合にコマンドを実行すると、それらを作成して成功を報告する", async () => {
    const existingRoles = ["Top", "JG"];
    const rolesCreateSpy = spy(() => Promise.resolve({} as Role));
    const mockGuild = {
      id: "mock-guild-id",
      roles: {
        cache: new Collection<string, Role>(
          existingRoles.map((name, i) => [`role_id_${i}`, { name } as Role]),
        ),
        create: rolesCreateSpy,
      },
    } as unknown as Guild;
    const interaction = newMockChatInputCommandInteractionBuilder()
      .withGuild(mockGuild)
      .build();

    await execute(interaction);

    const expectedToCreate = DISCORD_ROLES_TO_MANAGE.length - 2;
    assertEquals(interaction.deferReply.calls.length, 1);
    assertEquals(rolesCreateSpy.calls.length, expectedToCreate);
    assertEquals(interaction.editReply.calls.length, 1);
    const replyMessage = interaction.editReply.calls[0].args[0] as string;
    assert(replyMessage.includes("✅ セットアップ完了！"));
    assert(replyMessage.includes(`作成したロール (${expectedToCreate}件)`));
    assert(replyMessage.includes("既存のロール (2件)"));
  });

  it("管理対象の全ロールが既に存在する場合にコマンドを実行すると、ロールを作成せずに成功を報告する", async () => {
    const existingRoles = [...DISCORD_ROLES_TO_MANAGE];
    const rolesCreateSpy = spy(() => Promise.resolve({} as Role));
    const mockGuild = {
      id: "mock-guild-id",
      roles: {
        cache: new Collection<string, Role>(
          existingRoles.map((name, i) => [`role_id_${i}`, { name } as Role]),
        ),
        create: rolesCreateSpy,
      },
    } as unknown as Guild;
    const interaction = newMockChatInputCommandInteractionBuilder()
      .withGuild(mockGuild)
      .build();

    await execute(interaction);

    assertEquals(interaction.deferReply.calls.length, 1);
    assertEquals(rolesCreateSpy.calls.length, 0);
    assertEquals(interaction.editReply.calls.length, 1);
    assertEquals(
      interaction.editReply.calls[0].args[0],
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
    const rolesCreateSpy = spy(() => Promise.reject(error));
    const mockGuild = {
      id: "mock-guild-id",
      roles: {
        cache: new Collection<string, Role>(),
        create: rolesCreateSpy,
      },
    } as unknown as Guild;
    const interaction = newMockChatInputCommandInteractionBuilder()
      .withGuild(mockGuild)
      .build();

    await execute(interaction);

    assertEquals(interaction.deferReply.calls.length, 1);
    assertEquals(interaction.editReply.calls.length, 1);
    assertEquals(
      interaction.editReply.calls[0].args[0],
      "❌ 権限エラー。\nThe bot lacks the 'Manage Roles' permission.",
    );
  });

  it("ロール作成中に不明なエラーが発生した場合、コマンドは不明なエラーとして処理する", async () => {
    const rolesCreateSpy = spy(() =>
      Promise.reject(new Error("Some other error"))
    );
    const mockGuild = {
      id: "mock-guild-id",
      roles: {
        cache: new Collection<string, Role>(),
        create: rolesCreateSpy,
      },
    } as unknown as Guild;
    const interaction = newMockChatInputCommandInteractionBuilder()
      .withGuild(mockGuild)
      .build();

    await execute(interaction);

    assertEquals(interaction.deferReply.calls.length, 1);
    assertEquals(interaction.editReply.calls.length, 1);
    assert(
      (interaction.editReply.calls[0].args[0] as string).startsWith(
        "❌ 不明なエラー。",
      ),
    );
  });
});
