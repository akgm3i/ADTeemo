import { assertEquals, assertFalse } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { equalDigest } from "./service_auth.ts";

describe("service_auth.ts", () => {
  describe("equalDigest", () => {
    test("同じ内容のdigestを比較したとき、trueを返す", () => {
      // Arrange
      const left = new Uint8Array([1, 2, 3]);
      const right = new Uint8Array([1, 2, 3]);

      // Act
      const result = equalDigest(left, right);

      // Assert
      assertEquals(result, true);
    });

    test("共通prefixを持つ長さの異なるdigestを比較したとき、falseを返す", () => {
      // Arrange
      const left = new Uint8Array([1, 2]);
      const right = new Uint8Array([1, 2, 0]);

      // Act
      const result = equalDigest(left, right);

      // Assert
      assertFalse(result);
    });
  });

  describe(".env.example", () => {
    test("templateをそのままcopyしたとき、Bot service credentialが空で起動を拒否できる", async () => {
      // Arrange
      const envExample = await Deno.readTextFile(
        new URL("../../.env.example", import.meta.url),
      );

      // Act
      const sampleCredential = /^BOT_SERVICE_TOKEN=(.*)$/m.exec(envExample)
        ?.[1];

      // Assert
      assertEquals(sampleCredential, '""');
    });
  });
});
