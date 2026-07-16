import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, test } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Stub } from "@std/testing/mock";
import { initializeMessages } from "./main.ts";
import type { MessageKey } from "./main.ts";

const MOCK_JA_SYSTEM = {
  greeting: "こんにちは、{name}さん",
  common: {
    ok: "はい",
    cancel: "キャンセル",
  },
};

const MOCK_JA_TEEMO = {
  greeting: "やぁ、{name}！",
  common: {
    ok: "調子はどう？",
  },
};

describe("formatMessage (Message Translation)", () => {
  let readTextFileSyncStub: Stub<typeof Deno>;
  let formatMessage: (
    key: MessageKey,
    replacements?: Record<string, string | number>,
  ) => string;

  beforeEach(() => {
    readTextFileSyncStub = stub(Deno, "readTextFileSync", (path) => {
      const filePath = String(path);
      if (filePath.endsWith("ja/system.json")) {
        return JSON.stringify(MOCK_JA_SYSTEM);
      }
      if (filePath.endsWith("ja/teemo.json")) {
        return JSON.stringify(MOCK_JA_TEEMO);
      }
      throw new Deno.errors.NotFound(`File not found: ${path}`);
    });
  });

  afterEach(() => {
    readTextFileSyncStub.restore();
  });

  describe("デフォルトテーマ(system)の場合", () => {
    let envStub: Stub<typeof Deno.env>;

    beforeEach(() => {
      envStub = stub(Deno.env, "get", () => undefined);
      ({ formatMessage } = initializeMessages({ lang: "ja" }));
    });

    afterEach(() => {
      envStub.restore();
    });

    test("指定したキーのメッセージを返す", () => {
      // Act
      const result = formatMessage("common.ok" as MessageKey);

      // Assert
      assertEquals(result, "はい");
    });

    test("プレースホルダーを置換したメッセージを返す", () => {
      // Act
      const result = formatMessage("greeting" as MessageKey, {
        name: "ゲスト",
      });

      // Assert
      assertEquals(result, "こんにちは、ゲストさん");
    });

    test("見つからないキーについては、警告を表示しキー自体を文字列として返す", () => {
      // Arrange
      const missingKey = "a.b.c" as MessageKey;
      using consoleWarnSpy = spy(console, "warn");

      // Act
      const result = formatMessage(missingKey);

      // Assert
      assertEquals(result, missingKey);
      assertSpyCalls(consoleWarnSpy, 1);
    });
  });

  describe("カスタムテーマ(teemo)が設定されている場合", () => {
    let envStub: Stub<typeof Deno.env>;

    beforeEach(() => {
      envStub = stub(
        Deno.env,
        "get",
        (key) => (key === "BOT_MESSAGE_THEME" ? "teemo" : undefined),
      );
      ({ formatMessage } = initializeMessages({ lang: "ja", theme: "teemo" }));
    });

    afterEach(() => {
      envStub.restore();
    });

    test("テーマに存在するキーは、テーマのメッセージを優先して返す", () => {
      // Act
      const greeting = formatMessage("greeting" as MessageKey, {
        name: "隊長",
      });
      const ok = formatMessage("common.ok" as MessageKey);

      // Assert
      assertEquals(greeting, "やぁ、隊長！");
      assertEquals(ok, "調子はどう？");
    });

    test("テーマに存在しないがデフォルトには存在するキーは、デフォルトのメッセージを返す", () => {
      // Act
      const result = formatMessage("common.cancel" as MessageKey);

      // Assert
      assertEquals(result, "キャンセル");
    });
  });
});
