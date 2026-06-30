import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import * as path from "@std/path";
import {
  type ModuleGraph,
  moduleGraphBoundaryViolations,
  runtimeCommandEntrypoints,
} from "./check-runtime-boundary.ts";
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

    test("Bot runtimeが実装を含まないAPI契約exportを参照するとき、境界違反として扱わない", () => {
      // Arrange
      const entrypoint = "bot/src/main.ts";
      const graph = moduleGraph({
        "file:///repo/bot/src/main.ts": [
          "file:///repo/bot/src/api_client.ts",
        ],
        "file:///repo/bot/src/api_client.ts": [
          "file:///repo/api/src/contract/mod.ts",
          "file:///repo/api/src/contract/schemas.ts",
          "file:///repo/api/src/contract/hc.ts",
          "jsr:@hono/hono@4.9.6/client",
        ],
        "file:///repo/api/src/contract/mod.ts": [
          "file:///repo/api/src/contract/schemas.ts",
          "file:///repo/api/src/contract/hc.ts",
        ],
        "file:///repo/api/src/contract/schemas.ts": [],
        "file:///repo/api/src/contract/hc.ts": [
          "jsr:@hono/hono@4.9.6/client",
        ],
        "jsr:@hono/hono@4.9.6/client": [],
      });

      // Act
      const violations = moduleGraphBoundaryViolations(entrypoint, graph);

      // Assert
      assertEquals(violations, []);
    });
  });

  describe("異常系", () => {
    test("Bot runtimeがBackend実装pathを参照するとき、境界違反として検出する", () => {
      // Arrange
      const entrypoint = "bot/src/main.ts";
      const graph = moduleGraph({
        "file:///repo/bot/src/main.ts": [
          "file:///repo/api/src/app.ts",
          "file:///repo/api/src/routes/users.ts",
          "file:///repo/api/src/db/actions.ts",
          "file:///repo/api/src/db/repositories/users.ts",
          "file:///repo/api/src/services/opgg_match_detail.ts",
          "file:///repo/api/src/riot_api.ts",
        ],
        "file:///repo/api/src/app.ts": [],
        "file:///repo/api/src/routes/users.ts": [],
        "file:///repo/api/src/db/actions.ts": [],
        "file:///repo/api/src/db/repositories/users.ts": [],
        "file:///repo/api/src/services/opgg_match_detail.ts": [],
        "file:///repo/api/src/riot_api.ts": [],
      });

      // Act
      const violations = moduleGraphBoundaryViolations(entrypoint, graph);

      // Assert
      assertEquals(violations, [
        "bot/src/main.ts: file:///repo/api/src/app.ts",
        "bot/src/main.ts: file:///repo/api/src/routes/users.ts",
        "bot/src/main.ts: file:///repo/api/src/db/actions.ts",
        "bot/src/main.ts: file:///repo/api/src/db/repositories/users.ts",
        "bot/src/main.ts: file:///repo/api/src/services/opgg_match_detail.ts",
        "bot/src/main.ts: file:///repo/api/src/riot_api.ts",
      ]);
    });

    test("Bot runtimeがdomain enum目的でDB schemaを参照するとき、境界違反として検出する", () => {
      // Arrange
      const entrypoint = "bot/src/main.ts";
      const graph = moduleGraph({
        "file:///repo/bot/src/main.ts": [
          "file:///repo/api/src/validators.ts",
        ],
        "file:///repo/api/src/validators.ts": [
          "file:///repo/api/src/db/schema.ts",
        ],
        "file:///repo/api/src/db/schema.ts": [
          "npm:drizzle-orm@0.44.5/sqlite-core",
        ],
        "npm:drizzle-orm@0.44.5/sqlite-core": [],
      });

      // Act
      const violations = moduleGraphBoundaryViolations(entrypoint, graph);

      // Assert
      assertEquals(violations, [
        "bot/src/main.ts: file:///repo/api/src/db/schema.ts",
        "bot/src/main.ts: npm:drizzle-orm@0.44.5/sqlite-core",
      ]);
    });
  });
});

function moduleGraph(
  dependenciesByModule: Record<string, string[]>,
): ModuleGraph {
  const [root] = Object.keys(dependenciesByModule);
  return {
    roots: [root],
    modules: Object.entries(dependenciesByModule).map((
      [specifier, dependencies],
    ) => ({
      specifier,
      dependencies: dependencies.map((dependency) => ({
        code: { specifier: dependency },
      })),
    })),
  };
}

function dirEntry(name: string): Deno.DirEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  };
}
