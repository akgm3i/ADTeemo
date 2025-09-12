import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Stub } from "@std/testing/mock";
import { initializeMessages, t } from "./main.ts";
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

describe("t (Message Translation)", () => {
  let readTextFileSyncStub: Stub<typeof Deno>;

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
      initializeMessages({ lang: "ja" });
    });

    afterEach(() => {
      envStub.restore();
    });

    it("指定したキーのメッセージを返す", () => {
      assertEquals(t("common.ok" as MessageKey), "はい");
    });

    it("プレースホルダーを置換したメッセージを返す", () => {
      assertEquals(
        t("greeting" as MessageKey, { name: "ゲスト" }),
        "こんにちは、ゲストさん",
      );
    });

    it("見つからないキーについては、警告を表示しキー自体を文字列として返す", () => {
      const missingKey = "a.b.c" as MessageKey;
      using consoleWarnSpy = spy(console, "warn");
      assertEquals(t(missingKey), missingKey);
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
      initializeMessages({ lang: "ja", theme: "teemo" });
    });

    afterEach(() => {
      envStub.restore();
    });

    it("テーマに存在するキーは、テーマのメッセージを優先して返す", () => {
      assertEquals(
        t("greeting" as MessageKey, { name: "隊長" }),
        "やぁ、隊長！",
      );
      assertEquals(t("common.ok" as MessageKey), "調子はどう？");
    });

    it("テーマに存在しないがデフォルトには存在するキーは、デフォルトのメッセージを返す", () => {
      assertEquals(t("common.cancel" as MessageKey), "キャンセル");
    });
  });
});
