import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";

async function runtimeTypeScriptFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory) {
      files.push(
        ...await runtimeTypeScriptFiles(new URL(`${entry.name}/`, directory)),
      );
    } else if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") && entry.name !== "test_utils.ts"
    ) {
      files.push(url);
    }
  }
  return files;
}

test("Bot実行環境がBackend内部実装とDB設定に依存しない", async () => {
  // Arrange
  const violations: string[] = [];
  const sourceDirectory = new URL("./", import.meta.url);
  for (const file of await runtimeTypeScriptFiles(sourceDirectory)) {
    const source = await Deno.readTextFile(file);
    if (source.includes("@adteemo/api/riot-static-data")) {
      violations.push(`Backend内部実装をimportしている: ${file.pathname}`);
    }
  }

  const botConfig = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );
  if (String(botConfig.tasks?.dev ?? "").includes("DATABASE_URL")) {
    violations.push("botのdev taskにDATABASE_URLが設定されている");
  }

  const apiConfig = JSON.parse(
    await Deno.readTextFile(new URL("../../api/deno.json", import.meta.url)),
  );
  if ("./riot-static-data" in (apiConfig.exports ?? {})) {
    violations.push("API workspaceがriot-static-data内部実装を公開している");
  }

  const compose = await Deno.readTextFile(
    new URL("../../docker-compose.yml", import.meta.url),
  );
  const botService = compose.match(
    /\n[ ]{2}bot:\n([\s\S]*?)(?=\n[ ]{2}[a-z][\w-]*:|\n[ ]{2}# ---)/,
  )?.[1] ?? "";
  if (botService.includes("prod-db-data:/app/data")) {
    violations.push("bot serviceがDB volumeをmountしている");
  }
  if (botService.includes("DATABASE_URL")) {
    violations.push("bot serviceにDATABASE_URLが設定されている");
  }

  // Act / Assert
  assertEquals(violations, []);
});
