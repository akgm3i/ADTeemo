import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertStringIncludes } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Spy, Stub } from "@std/testing/mock";
import { main as checkMessagesMain } from "./check-messages.ts";

const MOCK_SOURCE = {
  a: "A",
  b: { c: "BC" },
  d: "D",
};

const MOCK_TARGET_OK = { ...MOCK_SOURCE };

const MOCK_TARGET_MISSING = {
  a: "A",
  b: {}, // 'c' is missing
};

describe("check-messages script", () => {
  let exitStub: Stub<typeof Deno>;
  let consoleLogSpy: Spy<typeof console>;
  let consoleWarnSpy: Spy<typeof console>;
  let consoleErrorSpy: Spy<typeof console>;

  beforeEach(() => {
    exitStub = stub(Deno, "exit");
    consoleLogSpy = spy(console, "log");
    consoleWarnSpy = spy(console, "warn");
    consoleErrorSpy = spy(console, "error");
  });

  afterEach(() => {
    exitStub.restore();
    consoleLogSpy.restore();
    consoleWarnSpy.restore();
    consoleErrorSpy.restore();
  });

  it("すべてのキーが存在する場合、成功メッセージを表示して正常終了する", () => {
    using _readFileSyncStub = stub(
      Deno,
      "readTextFileSync",
      () => JSON.stringify(MOCK_TARGET_OK),
    );

    checkMessagesMain();

    assertSpyCalls(exitStub, 0);
    const lastLogCall = consoleLogSpy.calls[consoleLogSpy.calls.length - 1];
    assertStringIncludes(
      lastLogCall.args[0] as string,
      "All message files are in sync!",
    );
  });

  it("キーが不足している場合、警告とエラーを表示してコード1で終了する", () => {
    using _readFileSyncStub = stub(Deno, "readTextFileSync", (path) => {
      if (String(path).endsWith("system.json")) {
        return JSON.stringify(MOCK_SOURCE);
      }
      return JSON.stringify(MOCK_TARGET_MISSING);
    });

    checkMessagesMain();

    assertSpyCall(consoleWarnSpy, 0, { args: ["  -  Missing key: b.c"] });
    assertSpyCall(consoleWarnSpy, 1, { args: ["  -  Missing key: d"] });
    assertSpyCall(consoleErrorSpy, 0, {
      args: ["  ❌ Found 2 missing key(s)."],
    });
    assertSpyCall(exitStub, 0, { args: [1] });
    assertSpyCalls(exitStub, 1);
  });

  it("対象ファイルが見つからない場合、警告を表示してコード1で終了する", () => {
    using _readFileSyncStub = stub(Deno, "readTextFileSync", (path) => {
      if (String(path).endsWith("system.json")) {
        return JSON.stringify(MOCK_SOURCE);
      }
      if (String(path).endsWith("teemo.json")) {
        throw new Deno.errors.NotFound();
      }
      return JSON.stringify(MOCK_TARGET_OK);
    });

    checkMessagesMain();

    assertSpyCall(consoleWarnSpy, 0, {
      args: ["  - File not found, skipping."],
    });
    assertSpyCall(consoleErrorSpy, 0, {
      args: ["\n❌ Some target files were not found and were skipped."],
    });
    assertSpyCalls(consoleErrorSpy, 1);
    assertSpyCall(exitStub, 0, { args: [1] });
    assertSpyCalls(exitStub, 1);
  });
});
