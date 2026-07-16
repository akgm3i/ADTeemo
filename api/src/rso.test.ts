import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { exchangeCodeForTokens, getUserInfo } from "./rso.ts";

describe("RSO provider failure", () => {
  test("token providerが失敗したとき、provider bodyを読まず直接consoleへ出力しない", async () => {
    // Arrange
    const response = new Response("provider-token-body-secret", {
      status: 500,
    });
    using _envStub = stub(Deno.env, "get", (key: string) => {
      const values: Record<string, string> = {
        RSO_CLIENT_ID: "client-id",
        RSO_CLIENT_SECRET: "client-secret",
        RSO_REDIRECT_URI: "http://localhost:8000",
      };
      return values[key];
    });
    using _fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(response),
    );
    using consoleErrorStub = stub(console, "error");

    // Act
    await assertRejects(
      () => exchangeCodeForTokens("oauth-code"),
      Error,
      "Failed to get tokens from Riot Sign On (Status: 500).",
    );

    // Assert
    assertEquals(response.bodyUsed, false);
    assertSpyCalls(consoleErrorStub, 0);
  });

  test("userinfo providerが失敗したとき、provider bodyを読まず直接consoleへ出力しない", async () => {
    // Arrange
    const response = new Response("provider-userinfo-body-secret", {
      status: 502,
    });
    using _fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(response),
    );
    using consoleErrorStub = stub(console, "error");

    // Act
    await assertRejects(
      () => getUserInfo("access-token"),
      Error,
      "Failed to get user info from Riot Sign On (Status: 502).",
    );

    // Assert
    assertEquals(response.bodyUsed, false);
    assertSpyCalls(consoleErrorStub, 0);
  });
});
