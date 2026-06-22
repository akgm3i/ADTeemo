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

function runtimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importFromPattern =
    /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;

  for (const match of source.matchAll(importFromPattern)) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;

    if (clause.startsWith("{") && clause.endsWith("}")) {
      const imports = clause.slice(1, -1).split(",").map((value) =>
        value.trim()
      ).filter(Boolean);
      if (
        imports.length > 0 &&
        imports.every((value) => value.startsWith("type "))
      ) {
        continue;
      }
    }

    specifiers.push(match[2]);
  }

  const sideEffectImportPattern = /^\s*import\s+["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(sideEffectImportPattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

async function botRuntimeBoundaryViolations(): Promise<string[]> {
  const apiDirectory = new URL("../../api/", import.meta.url);
  const apiConfig = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", apiDirectory)),
  );
  const apiExports = apiConfig.exports as Record<string, string>;
  const forbiddenPaths = [
    "/api/src/db/actions.ts",
    "/api/src/db/index.ts",
    "/api/src/integrations/",
    "/api/src/riot_static_data.ts",
    "/api/src/services/",
  ];
  const forbiddenPackages = new Set([
    "@libsql/client",
    "drizzle-orm/libsql",
  ]);
  const queue = [
    {
      module: new URL("./main.ts", import.meta.url),
      chain: ["bot/src/main.ts"],
    },
    {
      module: new URL("./deploy-commands.ts", import.meta.url),
      chain: ["bot/src/deploy-commands.ts"],
    },
  ];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.module.href)) continue;
    visited.add(current.module.href);

    const source = await Deno.readTextFile(current.module);
    for (const specifier of runtimeImportSpecifiers(source)) {
      if (forbiddenPackages.has(specifier)) {
        violations.push([...current.chain, specifier].join(" -> "));
        continue;
      }

      let dependency: URL | undefined;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        dependency = new URL(specifier, current.module);
      } else if (
        specifier === "@adteemo/api" || specifier.startsWith("@adteemo/api/")
      ) {
        const exportName = specifier === "@adteemo/api"
          ? "."
          : `.${specifier.slice("@adteemo/api".length)}`;
        const exportedPath = apiExports[exportName];
        if (exportedPath) dependency = new URL(exportedPath, apiDirectory);
      }

      if (!dependency || !dependency.pathname.endsWith(".ts")) continue;

      const nextChain = [...current.chain, dependency.pathname];
      if (forbiddenPaths.some((path) => dependency.pathname.includes(path))) {
        violations.push(nextChain.join(" -> "));
        continue;
      }
      queue.push({ module: dependency, chain: nextChain });
    }
  }

  return violations;
}

test("Bot実行環境がBackend内部実装とDB設定に依存しない", async () => {
  // Arrange
  const violations: string[] = [];
  const sourceDirectory = new URL("./", import.meta.url);
  for (const file of await runtimeTypeScriptFiles(sourceDirectory)) {
    const source = await Deno.readTextFile(file);
    if (
      [
        "@adteemo/api/riot-static-data",
        "/db/actions",
        "/db/index",
        "@libsql/client",
      ].some((forbiddenImport) => source.includes(forbiddenImport))
    ) {
      violations.push(`Backend内部実装をimportしている: ${file.pathname}`);
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

test("Bot entrypointの実行時依存を推移的にたどるとき、Backendの外部サービス実装とDB clientへ到達しない", async () => {
  // Arrange / Act
  const violations = await botRuntimeBoundaryViolations();

  // Assert
  assertEquals(violations, []);
});
