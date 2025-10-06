import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, spy, stub } from "@std/testing/mock";
import { assertEquals, assertObjectMatch } from "@std/assert";
import { CommandInteraction } from "discord.js";
import { data, execute } from "./link-riot-account.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { apiClient } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

describe("Command: link-riot-account", () => {
  describe("定義", () => {
    test("コマンド名と説明が期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "link-riot-account");
      assertEquals(json.description, "Riot GamesアカウントをBotに連携します。");
    });
  });

  test("コマンドが実行されたとき、APIから取得した認証URLを返信する", async () => {
    // Arrange
    const mockUserId = "user-456";
    const mockAuthUrl = "https://my-mock-auth-url.com/auth";
    const MOCKED_MESSAGE = "mocked success message";
    const mockInteraction = new MockInteractionBuilder("link-riot-account")
      .withUser({ id: mockUserId })
      .build();
    using getLoginUrlStub = stub(
      apiClient,
      "getLoginUrl",
      () => Promise.resolve({ success: true as const, url: mockAuthUrl }),
    );
    using formatMessageStub = stub(
      messageHandler,
      "formatMessage",
      () => MOCKED_MESSAGE,
    );
    const replySpy = spy(mockInteraction, "reply");

    // Act
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assert
    assertSpyCall(getLoginUrlStub, 0, { args: [mockUserId] });
    assertSpyCall(replySpy, 0);
    assertObjectMatch(replySpy.calls[0].args[0] as object, {
      content: MOCKED_MESSAGE,
      ephemeral: true,
    });
    assertSpyCall(formatMessageStub, 0, {
      args: [messageKeys.riotAccount.link.instructions, {
        url: mockAuthUrl,
      }],
    });
  });

  test("APIからURLの取得に失敗した場合、エラーメッセージを返す", async () => {
    // Arrange
    const mockUserId = "user-456";
    const MOCKED_MESSAGE = "mocked error message";
    const mockInteraction = new MockInteractionBuilder("link-riot-account")
      .withUser({ id: mockUserId })
      .build();
    using getLoginUrlStub = stub(
      apiClient,
      "getLoginUrl",
      () => Promise.resolve({ success: false as const, error: "API Error" }),
    );
    using formatMessageStub = stub(
      messageHandler,
      "formatMessage",
      () => MOCKED_MESSAGE,
    );
    const replySpy = spy(mockInteraction, "reply");

    // Act
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assert
    assertSpyCall(getLoginUrlStub, 0, { args: [mockUserId] });
    assertSpyCall(replySpy, 0);
    assertObjectMatch(replySpy.calls[0].args[0] as object, {
      content: MOCKED_MESSAGE,
      ephemeral: true,
    });
    assertSpyCall(formatMessageStub, 0, {
      args: [messageKeys.riotAccount.link.error.generic, {
        error: "API Error",
      }],
    });
  });
});
