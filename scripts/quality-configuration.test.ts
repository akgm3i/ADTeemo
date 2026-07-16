import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";

const root = new URL("../", import.meta.url);

describe("quality workflow", () => {
  test("Pull Requestとmain pushのとき、固定job qualityがfrozen lockfileで品質確認を実行する", async () => {
    // Arrange
    const workflow = await Deno.readTextFile(
      new URL(".github/workflows/quality.yml", root),
    );

    // Act
    const usesSecret = workflow.includes("secrets.");

    // Assert
    assertStringIncludes(
      workflow,
      "on:\n  pull_request:\n  push:\n    branches:\n      - main",
    );
    assertStringIncludes(workflow, "permissions:\n  contents: read");
    assertStringIncludes(
      workflow,
      "group: ${{ github.workflow }}-${{ github.ref }}",
    );
    assertStringIncludes(workflow, "cancel-in-progress: true");
    assertStringIncludes(workflow, "  quality:\n    name: quality");
    assertStringIncludes(workflow, "timeout-minutes: 15");
    assertStringIncludes(workflow, "uses: actions/checkout@v7");
    assertStringIncludes(workflow, "persist-credentials: false");
    assertStringIncludes(workflow, "uses: denoland/setup-deno@v2");
    assertStringIncludes(workflow, "deno-version-file: .dvmrc");
    assertStringIncludes(workflow, "cache: true");
    assertStringIncludes(workflow, "run: deno install --frozen=true");
    assertStringIncludes(workflow, "run: deno task quality");
    assertEquals(usesSecret, false);
  });
});

describe("test tasks", () => {
  test("targeted testとfull testのとき、どちらも.env.exampleだけを読み込む", async () => {
    // Arrange
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", root)),
    ) as { tasks: Record<string, string | { dependencies: string[] }> };

    // Act
    const targetTask = config.tasks["test:target"];
    const fullTask = config.tasks["test:all"];

    // Assert
    assertEquals(typeof targetTask, "string");
    assertEquals(typeof fullTask, "string");
    assertStringIncludes(targetTask as string, "--env-file=.env.example");
    assertStringIncludes(fullTask as string, "--env-file=.env.example");
    assertStringIncludes(
      fullTask as string,
      "--ignore=api/src/riot_api.live.test.ts",
    );
    assertEquals((targetTask as string).includes("--allow-net"), false);
    assertEquals((fullTask as string).includes("--allow-net"), false);
  });

  test("quality実行時、coverage testは静的検査の完了後に開始する", async () => {
    // Arrange
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", root)),
    ) as {
      tasks: Record<
        string,
        string | { command?: string; dependencies: string[] }
      >;
    };

    // Act
    const qualityTask = config.tasks.quality;

    // Assert
    assertEquals(typeof qualityTask, "object");
    assertEquals(
      (qualityTask as { command?: string }).command,
      "deno task test:all",
    );
    assertEquals(
      (qualityTask as { dependencies: string[] }).dependencies.includes(
        "test:all",
      ),
      false,
    );
  });
});
