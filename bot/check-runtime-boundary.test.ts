import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import * as path from "@std/path";
import { runtimeCommandEntrypoints } from "./check-runtime-boundary.ts";
import { isRuntimeCommandFile } from "./src/common/runtime_command_files.ts";

describe("check-runtime-boundary", () => {
  describe("正常系", () => {
    test("commandsディレクトリに実行時commandとテストが混在するとき、実行時に動的importされるcommandだけを境界検査rootに含める", () => {
      // Arrange
      const commandsDirectory = new URL("file:///tmp/adteemo-commands/");
      const commandEntries = [
        dirEntry("create-custom-game.ts"),
        dirEntry("health.ts"),
        dirEntry("health.test.ts"),
        dirEntry("link-riot-account.ts"),
        dirEntry("README.md"),
      ];

      // Act
      const entrypoints = runtimeCommandEntrypoints(
        commandsDirectory,
        commandEntries,
      );

      // Assert
      assertEquals(entrypoints, [
        path.join("/tmp/adteemo-commands", "create-custom-game.ts"),
        path.join("/tmp/adteemo-commands", "health.ts"),
      ]);
    });

    test("commandファイル名を判定するとき、command loaderと同じ除外条件になる", () => {
      // Arrange
      const cases: [string, boolean][] = [
        ["health.ts", true],
        ["health.test.ts", false],
        ["link-riot-account.ts", false],
        ["README.md", false],
      ];

      // Act
      const actual = cases.map(([fileName]) => [
        fileName,
        isRuntimeCommandFile(fileName),
      ]);

      // Assert
      assertEquals(actual, cases);
    });
  });
});

function dirEntry(name: string): Deno.DirEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  };
}
