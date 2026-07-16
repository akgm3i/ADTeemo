import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { parse } from "@std/yaml";

const root = new URL("../", import.meta.url);

interface QualityWorkflow {
  on: {
    pull_request: null;
    push: {
      branches: string[];
    };
  };
  permissions: {
    contents: string;
  };
  concurrency: {
    group: string;
    "cancel-in-progress": boolean;
  };
  jobs: {
    quality: {
      name: string;
      "runs-on": string;
      "timeout-minutes": number;
      steps: Array<{
        name: string;
        uses?: string;
        run?: string;
        with?: Record<string, unknown>;
      }>;
    };
  };
}

describe("quality workflow", () => {
  test("Pull Requestとmain pushのとき、固定job qualityがfrozen lockfileで品質確認を実行する", async () => {
    // Arrange
    const workflow = parse(
      await Deno.readTextFile(
        new URL(".github/workflows/quality.yml", root),
      ),
    ) as unknown as QualityWorkflow;

    // Act
    const quality = workflow.jobs.quality;
    const usesSecret = JSON.stringify(workflow).includes("secrets.");

    // Assert
    assertEquals(workflow.on, {
      pull_request: null,
      push: { branches: ["main"] },
    });
    assertEquals(workflow.permissions, { contents: "read" });
    assertEquals(workflow.concurrency, {
      group: "${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": true,
    });
    assertEquals(quality.name, "quality");
    assertEquals(quality["runs-on"], "ubuntu-latest");
    assertEquals(quality["timeout-minutes"], 15);
    assertEquals(quality.steps, [
      {
        name: "Checkout repository",
        uses: "actions/checkout@v7",
        with: { "persist-credentials": false },
      },
      {
        name: "Set up Deno",
        uses: "denoland/setup-deno@v2",
        with: {
          "deno-version-file": ".dvmrc",
          cache: true,
        },
      },
      {
        name: "Install locked dependencies",
        run: "deno install --frozen=true",
      },
      {
        name: "Run quality checks",
        run: "deno task quality",
      },
    ]);
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
