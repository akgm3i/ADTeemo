import { assertFalse } from "@std/assert";
import { test } from "@std/testing/bdd";

test("stdout-only loggerを使う配備経路では、taskとComposeにwrite権限を付与しない", async () => {
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

  assertFalse(rootConfig.tasks["deploy-commands"].includes("--allow-write"));
  assertFalse(
    rootConfig.tasks["dev:deploy-commands"].includes("--allow-write"),
  );
  assertFalse(deployerBlock.includes("      - --allow-write"));
});
