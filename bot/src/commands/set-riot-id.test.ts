import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { CommandInteraction } from "discord.js";
import { execute } from "./set-riot-id.ts";
import { apiClient } from "../api_client.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { formatMessage, messageKeys } from "../messages.ts";

describe("Command: set-riot-id", () => {
  it("有効なRiot ID (サモナー名#タグライン) が指定された場合、APIを呼び出してアカウント連携を試み、成功メッセージを返す", async () => {
    // Setup
    const mockUserId = "user-123";
    const riotId = "TestSummoner#JP1";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", riotId)
      .build();

    using linkAccountByRiotIdStub = stub(
      apiClient,
      "linkAccountByRiotId",
      () => Promise.resolve({ success: true, discordId: mockUserId }),
    );
    const editReplySpy = spy(mockInteraction, "editReply");

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    const [gameName, tagLine] = riotId.split("#");
    assertSpyCall(linkAccountByRiotIdStub, 0, {
      args: [mockUserId, gameName, tagLine],
    });

    assertSpyCall(editReplySpy, 0, {
      args: [{
        content: formatMessage(messageKeys.riotAccount.link.success.title),
      }],
    });
  });

  it("APIでの連携に失敗した場合、エラーメッセージを返す", async () => {
    // Setup
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
    const editReplySpy = spy(mockInteraction, "editReply");

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    const [gameName, tagLine] = riotId.split("#");
    assertSpyCall(linkAccountByRiotIdStub, 0, {
      args: [mockUserId, gameName, tagLine],
    });

    assertSpyCall(editReplySpy, 0, {
      args: [{
        content: formatMessage(messageKeys.riotAccount.link.error.generic, {
          error: apiError,
        }),
      }],
    });
  });

  it("Riot IDの形式が不正な場合 (#が含まれない)、フォーマットエラーメッセージを返す", async () => {
    // Setup
    const mockUserId = "user-123";
    const invalidRiotId = "InvalidFormat";
    const mockInteraction = new MockInteractionBuilder("set-riot-id")
      .withUser({ id: mockUserId })
      .withStringOption("riot-id", invalidRiotId)
      .build();

    const linkAccountSpy = spy(apiClient, "linkAccountByRiotId");
    const editReplySpy = spy(mockInteraction, "editReply");

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    assertSpyCalls(linkAccountSpy, 0);

    assertSpyCall(editReplySpy, 0, {
      args: [{
        content: formatMessage(
          messageKeys.riotAccount.link.error.invalidFormat,
        ),
      }],
    });
  });
});
