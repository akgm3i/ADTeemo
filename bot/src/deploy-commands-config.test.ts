import { assertStringIncludes } from "@std/assert";
import { test } from "@std/testing/bdd";

test("file loggerを設定した配備経路では、taskとComposeがwrite権限を付与する", async () => {
  const rootConfig = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  ) as { tasks: Record<string, string> };
  const compose = await Deno.readTextFile(
    new URL("../../docker-compose.yml", import.meta.url),
  );
  const deployerBlock = compose.slice(
    compose.indexOf("  command-deployer:"),
    compose.indexOf("  # --- Development service"),
  );

  assertStringIncludes(rootConfig.tasks["deploy-commands"], "--allow-write");
  assertStringIncludes(
    rootConfig.tasks["dev:deploy-commands"],
    "--allow-write",
  );
  assertStringIncludes(deployerBlock, "      - --allow-write");
});
