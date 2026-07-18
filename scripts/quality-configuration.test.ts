import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { parse } from "@std/yaml";

const root = new URL("../", import.meta.url);

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface QualityWorkflow {
  on: {
    pull_request?: unknown;
    push?: { branches?: string[] };
    [event: string]: unknown;
  };
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

describe("quality workflow", () => {
  test("Pull Requestとmain pushのとき、read-onlyのquality jobが固定Denoで品質確認を実行する", async () => {
    // Arrange
    const workflow = parse(
      await Deno.readTextFile(
        new URL(".github/workflows/quality.yml", root),
      ),
    ) as unknown as QualityWorkflow;

    // Act
    const quality = workflow.jobs.quality;
    const steps = quality?.steps ?? [];
    const denoSetup = steps.find((step) =>
      step.uses?.startsWith("denoland/setup-deno@")
    );
    const frozenInstallIndex = steps.findIndex((step) =>
      /\bdeno install\b[^\n]*--frozen(?:=true)?(?:\s|$)/.test(step.run ?? "")
    );
    const qualityIndex = steps.findIndex((step) =>
      step.run?.split(/\r?\n/).some((line) =>
        line.trim() === "deno task quality"
      )
    );
    const serialized = JSON.stringify(workflow);

    // Assert
    assert("pull_request" in workflow.on);
    assert(workflow.on.push?.branches?.includes("main"));
    assert(quality);
    assertEquals(quality.name ?? "quality", "quality");
    assertEquals(workflow.permissions.contents, "read");
    assertFalse(Object.values(workflow.permissions).includes("write"));
    assertFalse(Object.values(quality.permissions ?? {}).includes("write"));
    assertEquals(denoSetup?.with?.["deno-version-file"], ".dvmrc");
    assert(frozenInstallIndex >= 0);
    assert(qualityIndex > frozenInstallIndex);
    assertFalse(/"secrets":|\$\{\{[^}]*\bsecrets\b/.test(serialized));
    assertFalse(serialized.includes("test:riot-live"));
    assertFalse(serialized.includes("RIOT_LIVE_TEST"));
    assertFalse(serialized.includes("riot_api.live.test.ts"));
  });

  test("quality jobを実行するとき、secretやservice起動なしで全Compose profileをparseする", async () => {
    // Arrange
    const workflow = parse(
      await Deno.readTextFile(
        new URL(".github/workflows/quality.yml", root),
      ),
    ) as unknown as QualityWorkflow;

    // Act
    const runCommands = (workflow.jobs.quality?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");
    const composeCommand =
      runCommands.split(/\r?\n/).find((line) =>
        line.trimStart().startsWith("docker compose ") &&
        line.includes(" config")
      ) ?? "";

    // Assert
    assertStringIncludes(composeCommand, "--env-file .env.example");
    assert(/--profile\s+(?:"\*"|'\*'|\*)/.test(composeCommand));
    assertStringIncludes(composeCommand, "config");
    assertStringIncludes(composeCommand, "--quiet");
    assertStringIncludes(composeCommand, "--no-env-resolution");
    assertFalse(
      /\bdocker[^\n]*\b(?:build|buildx|pull)\b/.test(runCommands),
    );
    assertFalse(
      /\bdocker compose[^\n]*\b(?:create|restart|run|start|up)\b/.test(
        runCommands,
      ),
    );
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
