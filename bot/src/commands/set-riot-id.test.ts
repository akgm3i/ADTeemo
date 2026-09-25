import { describe, test } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { CommandInteraction } from "discord.js";
import { data, execute } from "./set-riot-id.ts";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { messageHandler, messageKeys } from "../messages.ts";

describe("Command: set-riot-id", () => {
  describe("定義", () => {
    test("コマンド名と説明、オプションが期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "set-riot-id");
      assertEquals(
        json.description,
        "Riot IDを登録・更新します。(例: Faker#KR1)",
      );

      const options = json.options ?? [];
      assertEquals(options.map((option) => option.name), [
        "riot-id",
        "platform",
        "watch-preference",
      ]);
      const riotIdOption = options[0];
      assertEquals(
        riotIdOption?.description,
        "サモナー名#タグライン の形式で入力してください。",
      );
      assertEquals(riotIdOption?.required, true);
    });
  });

  test("有効なRiot ID (サモナー名#タグライン) が指定された場合、APIを呼び出してアカウント連携を試み、成功メッセージを返す", async () => {
    // Arrange
    const mockUserId = "user-123";
    const riotId = "TestSummoner#JP1";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", riotId)
      .build();
    using linkAccountByRiotIdStub = stub(
      apiClient,
      "linkAccountByRiotId",
      () => Promise.resolve({ success: true as const }),
    );
    using formatMessageSpy = spy(messageHandler, "formatMessage");
    const editReplySpy = spy(mockInteraction, "editReply");

    // Act
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assert
    const [gameName, tagLine] = riotId.split("#");
    assertSpyCall(linkAccountByRiotIdStub, 0, {
      args: [mockUserId, gameName, tagLine, "jp1", "asia"],
    });
    assertSpyCall(editReplySpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.riotAccount.link.success.title],
    });
  });

  test("登録時にopt-outを指定すると、account登録より先に現在guildの本人停止を保存する", async () => {
    const interaction = new MockInteractionBuilder("set-riot-id").withUser({
      id: "owner",
    }).withStringOption("riot-id", "Sub#JP1").withStringOption(
      "watch-preference",
      "opt-out",
    ).build();
    const calls: unknown[] = [];
    using _preference = stub(apiClient, "setMatchWatchOptOut", (...args) => {
      calls.push(args);
      return Promise.resolve({ success: true });
    });
    using _register = stub(apiClient, "linkAccountByRiotId", (...args) => {
      calls.push(args);
      return Promise.resolve({ success: true });
    });
    await execute(interaction);
    assertEquals(calls, [["mock-guild-id", "owner", true], [
      "owner",
      "Sub",
      "JP1",
      "jp1",
      "asia",
    ]]);
  });

  test("OCEプラットフォームが指定された場合、Regional Routingをseaとして登録する", async () => {
    const mockUserId = "user-123";
    const riotId = "TestSummoner#OCE";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", riotId)
      .withStringOption("platform", "oc1")
      .build();
    using linkAccountByRiotIdStub = stub(
      apiClient,
      "linkAccountByRiotId",
      () => Promise.resolve({ success: true as const }),
    );

    await execute(mockInteraction as unknown as CommandInteraction);

    const [gameName, tagLine] = riotId.split("#");
    assertSpyCall(linkAccountByRiotIdStub, 0, {
      args: [mockUserId, gameName, tagLine, "oc1", "sea"],
    });
  });

  test("APIでの連携に失敗した場合、エラーメッセージを返す", async () => {
    // Arrange
    const mockUserId = "user-123";
    const riotId = "InvalidSummoner#FAIL";
    const apiError = "指定されたアカウントが見つかりません。";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", riotId)
      .build();
    using linkAccountByRiotIdStub = stub(
      apiClient,
      "linkAccountByRiotId",
      () => Promise.resolve({ success: false as const, error: apiError }),
    );
    using formatMessageSpy = spy(messageHandler, "formatMessage");
    const editReplySpy = spy(mockInteraction, "editReply");

    // Act
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assert
    const [gameName, tagLine] = riotId.split("#");
    assertSpyCall(linkAccountByRiotIdStub, 0, {
      args: [mockUserId, gameName, tagLine, "jp1", "asia"],
    });
    assertSpyCall(editReplySpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.riotAccount.link.error.generic, {
        error: apiError,
      }],
    });
  });

  test("Riot IDの形式が不正な場合 (#が含まれない)、フォーマットエラーメッセージを返す", async () => {
    // Arrange
    const mockUserId = "user-123";
    const invalidRiotId = "InvalidFormat";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", invalidRiotId)
      .build();
    const linkAccountSpy = spy(apiClient, "linkAccountByRiotId");
    using formatMessageSpy = spy(messageHandler, "formatMessage");
    const editReplySpy = spy(mockInteraction, "editReply");

    // Act
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assert
    assertSpyCalls(linkAccountSpy, 0);
    assertSpyCall(editReplySpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.riotAccount.set.error.invalidFormat],
    });
  });
});
