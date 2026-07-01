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

const forbiddenBackendRuntimeImportPatterns = [
  /from\s+["']@adteemo\/api["']/,
  /from\s+["']@adteemo\/api\/hc["']/,
  /from\s+["']@adteemo\/api\/schema["']/,
  /from\s+["']@adteemo\/api\/validators["']/,
  /from\s+["']@adteemo\/api\/riot-static-data["']/,
  /from\s+["'][^"']*\/api\/src\//,
  /from\s+["'][^"']*\/db\/actions(?:\.ts)?["']/,
  /from\s+["'][^"']*\/db\/default_actions(?:\.ts)?["']/,
  /from\s+["'][^"']*\/db\/default_connection(?:\.ts)?["']/,
  /from\s+["'][^"']*\/db\/index(?:\.ts)?["']/,
  /from\s+["'][^"']*\/db\/repositories\//,
  /from\s+["'][^"']*\/db\/schema(?:\.ts)?["']/,
  /from\s+["']@libsql\/client["']/,
  /from\s+["']drizzle-orm\/sqlite-core["']/,
];

test("Bot実行環境がBackend内部実装とDB設定に依存しない", async () => {
  // Arrange
  const violations: string[] = [];
  const sourceDirectory = new URL("./", import.meta.url);
  for (const file of await runtimeTypeScriptFiles(sourceDirectory)) {
    const source = await Deno.readTextFile(file);
    if (
      forbiddenBackendRuntimeImportPatterns.some((forbiddenImport) =>
        forbiddenImport.test(source)
      )
    ) {
      violations.push(
        `Backend内部実装またはDB schemaをimportしている: ${file.pathname}`,
      );
    }
    if (source.includes("./opgg.ts") || source.includes("https://op.gg")) {
      violations.push(`OP.GGへ直接依存している: ${file.pathname}`);
    }
    if (source.includes("OPGG_ENABLED")) {
      violations.push(`BotがOP.GG設定を参照している: ${file.pathname}`);
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

test("record-matchコマンドがmatch tracking機能に依存しない", async () => {
  // Arrange
  const source = await Deno.readTextFile(
    new URL("./commands/record-match.ts", import.meta.url),
  );

  // Act / Assert
  assertEquals(source.includes("../features/match_tracking.ts"), false);
});
