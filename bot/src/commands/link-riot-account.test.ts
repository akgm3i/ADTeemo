import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, spy, stub } from "@std/testing/mock";
import { assert, assertEquals } from "@std/assert";
import { CommandInteraction, InteractionReplyOptions } from "discord.js";
import { execute, testable } from "./link-riot-account.ts";
import { MockInteractionBuilder } from "../test_utils.ts";

describe("Command: link-riot-account", () => {
  it("コマンドが実行されたとき、APIから取得した認証URLを返信する", async () => {
    // Setup
    const mockUserId = "user-456";
    const mockAuthUrl = "https://my-mock-auth-url.com/auth";
    const mockInteraction = new MockInteractionBuilder("link-riot-account")
      .withUser({ id: mockUserId })
      .build();

    using getLoginUrlStub = stub(
      testable.apiClient,
      "getLoginUrl",
      () =>
        Promise.resolve({
          success: true as const,
          url: mockAuthUrl,
          error: null,
        }),
    );
    const replySpy = spy(mockInteraction, "reply");

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    assertSpyCall(getLoginUrlStub, 0, {
      args: [mockUserId],
    });

    assertSpyCall(replySpy, 0);
    const replyOptions = replySpy.calls[0].args[0] as InteractionReplyOptions;
    assertEquals(replyOptions.ephemeral, true);
    assert(replyOptions.content?.includes(mockAuthUrl));
  });

  it("APIからURLの取得に失敗した場合、エラーメッセージを返す", async () => {
    // Setup
    const mockUserId = "user-456";
    const mockInteraction = new MockInteractionBuilder("link-riot-account")
      .withUser({ id: mockUserId })
      .build();

    using getLoginUrlStub = stub(
      testable.apiClient,
      "getLoginUrl",
      () => Promise.resolve({ success: false as const, error: "API Error" }),
    );
    const replySpy = spy(mockInteraction, "reply");

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    assertSpyCall(getLoginUrlStub, 0, {
      args: [mockUserId],
    });

    assertSpyCall(replySpy, 0);
    const replyOptions = replySpy.calls[0].args[0] as InteractionReplyOptions;
    assertEquals(replyOptions.ephemeral, true);
    assert(replyOptions.content?.includes("エラーが発生しました"));
  });
});
