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
      assertEquals(options.map((option) => option.name), ["riot-id"]);
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
      args: [mockUserId, gameName, tagLine],
    });
    assertSpyCall(editReplySpy, 0);
    assertSpyCall(formatMessageSpy, 0, {
      args: [messageKeys.riotAccount.link.success.title],
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
      args: [mockUserId, gameName, tagLine],
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
