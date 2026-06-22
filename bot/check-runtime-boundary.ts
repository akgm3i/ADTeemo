type Dependency = {
  code?: { specifier: string };
};

type Module = {
  specifier: string;
  dependencies?: Dependency[];
};

type ModuleGraph = {
  roots: string[];
  modules: Module[];
};

const defaultEntrypoints = [
  "bot/src/main.ts",
  "bot/src/deploy-commands.ts",
];

const forbiddenModulePatterns = [
  /\/api\/src\/app\.ts$/,
  /\/api\/src\/routes\//,
  /\/api\/src\/db\/(actions|index)\.ts$/,
  /\/api\/src\/(integrations|services)\//,
  /\/api\/src\/(riot_api|riot_static_data|rso)\.ts$/,
  /@libsql\/client/,
  /drizzle-orm.*\/libsql/,
];

async function loadModuleGraph(entrypoint: string): Promise<ModuleGraph> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    throw new Error(
      new TextDecoder().decode(output.stderr) ||
        `Failed to inspect module graph: ${entrypoint}`,
    );
  }
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

function runtimeModules(graph: ModuleGraph): Set<string> {
  const modules = new Map(
    graph.modules.map((module) => [module.specifier, module]),
  );
  const queue = [...graph.roots];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const specifier = queue.shift();
    if (!specifier || visited.has(specifier)) continue;
    visited.add(specifier);

    const module = modules.get(specifier);
    for (const dependency of module?.dependencies ?? []) {
      if (dependency.code?.specifier) queue.push(dependency.code.specifier);
    }
  }

  return visited;
}

const entrypoints = Deno.args.length > 0 ? Deno.args : defaultEntrypoints;
const violations: string[] = [];

for (const entrypoint of entrypoints) {
  const graph = await loadModuleGraph(entrypoint);
  for (const specifier of runtimeModules(graph)) {
    if (forbiddenModulePatterns.some((pattern) => pattern.test(specifier))) {
      violations.push(`${entrypoint}: ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Bot runtime boundary violations:\n${
      violations.map((value) => `- ${value}`).join("\n")
    }`,
  );
  Deno.exit(1);
}

console.log(
  `Bot runtime boundary is valid: ${entrypoints.join(", ")}`,
);
