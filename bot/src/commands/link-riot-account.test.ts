import { describe, it } from "@std/testing/bdd";
import { assertSpyCall, spy, stub } from "@std/testing/mock";
import { assertEquals } from "@std/assert";
import { CommandInteraction, InteractionReplyOptions } from "discord.js";
import { execute, testable } from "./link-riot-account.ts";
import { MockInteractionBuilder } from "../test_utils.ts";

describe("Command: link-riot-account", () => {
  it("コマンドが実行されたとき、APIを呼び出してstateを保存し、RSO認証URLをDMで返信する", async () => {
    // Setup
    const mockState = "123e4567-e89b-12d3-a456-426614174000";
    const mockUserId = "user-456";
    const mockInteraction = new MockInteractionBuilder("link-riot-account")
      .withUser({ id: mockUserId })
      .build();

    using _uuidStub = stub(testable.uuid, "generate", () => mockState);
    using createAuthStateStub = stub(
      testable.apiClient,
      "createAuthState",
      () => Promise.resolve({ success: true, error: null }),
    );
    const replySpy = spy(mockInteraction, "reply");

    const clientId = "test-client-id";
    const redirectUriBase = "http://localhost:8000";
    Deno.env.set("RSO_CLIENT_ID", clientId);
    Deno.env.set("RSO_REDIRECT_URI", redirectUriBase);

    // Action
    await execute(mockInteraction as unknown as CommandInteraction);

    // Assertion
    // 1. API client was called correctly
    assertSpyCall(createAuthStateStub, 0, {
      args: [mockState, mockUserId],
    });

    // 2. Reply was sent with the correct URL components
    assertSpyCall(replySpy, 0);
    const replyOptions = replySpy.calls[0].args[0] as InteractionReplyOptions;
    assertEquals(replyOptions.ephemeral, true);

    const actualUrl = new URL(
      replyOptions.content!.split("\n\n")[1],
    );
    assertEquals(actualUrl.origin, "https://auth.riotgames.com");
    assertEquals(actualUrl.pathname, "/authorize");
    assertEquals(actualUrl.searchParams.get("response_type"), "code");
    assertEquals(actualUrl.searchParams.get("client_id"), clientId);
    assertEquals(
      actualUrl.searchParams.get("redirect_uri"),
      `${redirectUriBase}/auth/rso/callback`,
    );
    assertEquals(actualUrl.searchParams.get("scope"), "openid");
    assertEquals(actualUrl.searchParams.get("state"), mockState);

    // Cleanup env vars
    Deno.env.delete("RSO_CLIENT_ID");
    Deno.env.delete("RSO_REDIRECT_URI");
  });
});
