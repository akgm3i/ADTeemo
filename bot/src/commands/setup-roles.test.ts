import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { execute, testable } from "./setup-roles.ts";
import { messageKeys } from "../messages.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import { EnsureRolesResult } from "../features/role-management.ts";

describe("Setup Roles Command", () => {
  it("ギルド（サーバー）外でコマンドを実行すると、エラーメッセージを返信する", async () => {
    using formatMessageSpy = spy(testable, "formatMessage");
    const interaction = new MockInteractionBuilder().withGuild(null).build();
    using replySpy = spy(interaction, "reply");
    using deferSpy = spy(interaction, "deferReply");

    await execute(interaction);

    assertSpyCall(replySpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.common.info.guildOnlyCommand],
    });
    assertSpyCalls(deferSpy, 0);
  });

  it("不足しているロールがある場合にコマンドを実行すると、それらを作成して成功を報告する", async () => {
    const mockGuild = new MockGuildBuilder().build();
    const interaction = new MockInteractionBuilder().withGuild(mockGuild)
      .build();
    const ensureRolesResult: EnsureRolesResult = {
      status: "SUCCESS",
      summary: { created: ["Top", "Mid"], existing: ["Bot"] },
    };
    using ensureRolesStub = stub(
      testable,
      "ensureRoles",
      () => Promise.resolve(ensureRolesResult),
    );
    using formatMessageSpy = spy(testable, "formatMessage");
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(ensureRolesStub, 0, { args: [mockGuild] });
    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [
        messageKeys.guild.setup.success.created,
        { count: 2, roles: "Top, Mid" },
      ],
    });
    assertSpyCall(formatMessageSpy, 1, {
      args: [
        messageKeys.guild.setup.success.existing,
        { count: 1, roles: "Bot" },
      ],
    });
  });

  it("管理対象の全ロールが既に存在する場合にコマンドを実行すると、ロールを作成せずに成功を報告する", async () => {
    const mockGuild = new MockGuildBuilder().build();
    const interaction = new MockInteractionBuilder().withGuild(mockGuild)
      .build();
    const ensureRolesResult: EnsureRolesResult = {
      status: "SUCCESS",
      summary: { created: [], existing: ["Top", "Mid", "Bot"] },
    };
    using ensureRolesStub = stub(
      testable,
      "ensureRoles",
      () => Promise.resolve(ensureRolesResult),
    );
    using formatMessageSpy = spy(testable, "formatMessage");
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(ensureRolesStub, 0, { args: [mockGuild] });
    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.guild.setup.success.noAction],
    });
  });

  it("ロール作成中に権限エラーが発生した場合、コマンドは権限エラーとして処理する", async () => {
    const mockGuild = new MockGuildBuilder().build();
    const interaction = new MockInteractionBuilder().withGuild(mockGuild)
      .build();
    const ensureRolesResult: EnsureRolesResult = {
      status: "PERMISSION_ERROR",
      message: "Test permission error",
    };
    using ensureRolesStub = stub(
      testable,
      "ensureRoles",
      () => Promise.resolve(ensureRolesResult),
    );
    using formatMessageSpy = spy(testable, "formatMessage");
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(ensureRolesStub, 0, { args: [mockGuild] });
    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [
        messageKeys.guild.setup.error.permission,
        { message: "Test permission error" },
      ],
    });
  });

  it("ロール作成中に不明なエラーが発生した場合、コマンドは不明なエラーとして処理する", async () => {
    const mockGuild = new MockGuildBuilder().build();
    const interaction = new MockInteractionBuilder().withGuild(mockGuild)
      .build();
    const ensureRolesResult: EnsureRolesResult = {
      status: "UNKNOWN_ERROR",
      error: "Test unknown error",
    };
    using ensureRolesStub = stub(
      testable,
      "ensureRoles",
      () => Promise.resolve(ensureRolesResult),
    );
    using formatMessageSpy = spy(testable, "formatMessage");
    using deferSpy = spy(interaction, "deferReply");
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCall(ensureRolesStub, 0, { args: [mockGuild] });
    assertSpyCall(deferSpy, 0);
    assertSpyCall(editSpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.guild.setup.error.unknown],
    });
  });
});
