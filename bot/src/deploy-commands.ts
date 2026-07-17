import { REST, Routes } from "discord.js";
import {
  type CommandLoadResult,
  formatCommandLoadErrors,
  loadCommands,
} from "./common/command_loader.ts";
import { botLogger } from "./logger.ts";

type JsonObject = Record<string, unknown>;
const NO_SEMANTIC_DEFAULT = Symbol("no-semantic-default");
const GUILD_UNSUPPORTED_FIELDS = new Set([
  "contexts",
  "integration_types",
  "dm_permission",
]);

export interface CommandRestClient {
  get(route: string): Promise<unknown>;
  put(route: string, options: { body: unknown }): Promise<unknown>;
}

export interface CommandDiff {
  added: string[];
  removed: string[];
  updated: string[];
}

export type CommandSyncResult = {
  status: "unchanged" | "updated";
  expectedNames: string[];
  diff: CommandDiff;
};

interface SyncApplicationCommandsOptions {
  rest: CommandRestClient;
  clientId: string;
  guildId?: string;
  loadResult: CommandLoadResult;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function semanticDefault(
  key: string,
  guildScoped: boolean,
): unknown | typeof NO_SEMANTIC_DEFAULT {
  if (key === "name_localizations" || key === "description_localizations") {
    return null;
  }
  if (key === "default_permission") return true;
  if (key === "default_member_permissions") return null;
  if (key === "dm_permission") {
    return guildScoped ? NO_SEMANTIC_DEFAULT : true;
  }
  if (key === "nsfw" || key === "required" || key === "autocomplete") {
    return false;
  }
  return NO_SEMANTIC_DEFAULT;
}

function canonicalDesired(value: unknown, guildScoped: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalDesired(entry, guildScoped));
  }
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (
        entry === undefined &&
        (key === "contexts" || key === "integration_types" ||
          (guildScoped && key === "dm_permission"))
      ) {
        // Omitted context fields inherit Discord application-level settings.
        return [];
      }
      const defaultValue = semanticDefault(key, guildScoped);
      const desired = entry === undefined &&
          defaultValue !== NO_SEMANTIC_DEFAULT
        ? defaultValue
        : canonicalDesired(entry, guildScoped);
      return [[key, desired]];
    }),
  );
}

function projectToTemplate(
  current: unknown,
  template: unknown,
  guildScoped: boolean,
): unknown {
  if (Array.isArray(template)) {
    if (!Array.isArray(current)) return current;
    if (current.length !== template.length) return current;
    return template.map((entry, index) =>
      projectToTemplate(current[index], entry, guildScoped)
    );
  }
  if (!isJsonObject(template) || !isJsonObject(current)) return current;
  return Object.fromEntries(
    Object.entries(template).map(([key, entry]) => {
      const defaultValue = semanticDefault(key, guildScoped);
      const actual = current[key] === undefined &&
          defaultValue !== NO_SEMANTIC_DEFAULT
        ? defaultValue
        : current[key];
      return [key, projectToTemplate(actual, entry, guildScoped)];
    }),
  );
}

interface CommandIdentity {
  key: string;
  label: string;
}

function commandIdentity(value: unknown): CommandIdentity | undefined {
  if (!isJsonObject(value) || typeof value.name !== "string") return undefined;
  const type = value.type === undefined ? 1 : value.type;
  if (!Number.isInteger(type) || (type as number) < 1) return undefined;
  return {
    key: `${type}:${value.name}`,
    label: type === 1 ? value.name : `${value.name} (type ${type})`,
  };
}

function commandIndex(values: unknown[], source: string) {
  const result = new Map<string, { label: string; value: unknown }>();
  for (const [index, value] of values.entries()) {
    const identity = commandIdentity(value);
    if (!identity) {
      throw new Error(`${source} command at index ${index} is invalid`);
    }
    if (result.has(identity.key)) {
      throw new Error(`${source} command is duplicated: ${identity.label}`);
    }
    result.set(identity.key, { label: identity.label, value });
  }
  return result;
}

function commandDiff(
  current: unknown[],
  desired: JsonObject[],
  guildScoped: boolean,
): CommandDiff {
  const currentByIdentity = commandIndex(current, "Current Discord");
  const desiredByIdentity = commandIndex(desired, "Desired");

  const added = [...desiredByIdentity.entries()].flatMap(([key, desired]) =>
    currentByIdentity.has(key) ? [] : [desired.label]
  ).sort();
  const removed = [...currentByIdentity.entries()].flatMap(([key, current]) =>
    desiredByIdentity.has(key) ? [] : [current.label]
  ).sort();
  const updated = [...desiredByIdentity.entries()].flatMap(
    ([key, desiredCommand]) => {
      const currentCommand = currentByIdentity.get(key);
      if (!currentCommand) return [];
      const expected = canonicalDesired(desiredCommand.value, guildScoped);
      const comparable = projectToTemplate(
        currentCommand.value,
        expected,
        guildScoped,
      );
      return JSON.stringify(stableValue(comparable)) ===
          JSON.stringify(stableValue(expected))
        ? []
        : [desiredCommand.label];
    },
  ).sort();

  return { added, removed, updated };
}

function commandPayload(
  value: JsonObject,
  guildScoped: boolean,
): JsonObject {
  if (!guildScoped) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !GUILD_UNSUPPORTED_FIELDS.has(key)),
  );
}

function hasDiff(diff: CommandDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 ||
    diff.updated.length > 0;
}

function validatePublishedCommands(
  response: unknown,
  desired: JsonObject[],
  guildScoped: boolean,
) {
  if (!Array.isArray(response)) {
    throw new Error("Discord returned an invalid published command list");
  }
  const publishedNames = [
    ...commandIndex(response, "Published Discord").keys(),
  ]
    .sort();
  const expectedNames = [...commandIndex(desired, "Desired").keys()].sort();
  const diff = commandDiff(response, desired, guildScoped);
  if (hasDiff(diff)) {
    throw new Error(
      "Discord published unexpected command payload. " +
        `Expected: [${expectedNames.join(", ")}], ` +
        `Published: [${publishedNames.join(", ")}], ` +
        `Added: [${diff.added.join(", ")}], ` +
        `Removed: [${diff.removed.join(", ")}], ` +
        `Updated: [${diff.updated.join(", ")}]`,
    );
  }
}

export async function syncApplicationCommands(
  options: SyncApplicationCommandsOptions,
): Promise<CommandSyncResult> {
  if (!options.loadResult.ok) {
    throw new Error(
      `Command loading failed: ${
        formatCommandLoadErrors(options.loadResult.errors)
      }`,
    );
  }
  if (options.loadResult.commands.length === 0) {
    throw new Error(
      "No enabled commands; refusing to replace Discord commands",
    );
  }

  const guildScoped = options.guildId !== undefined;
  const desired = options.loadResult.commands
    .map((command) =>
      commandPayload(
        command.data.toJSON() as unknown as JsonObject,
        guildScoped,
      )
    )
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const expectedNames = desired.map((payload) => String(payload.name));
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);

  const response = await options.rest.get(route);
  if (!Array.isArray(response)) {
    throw new Error("Discord returned an invalid command list");
  }
  const diff = commandDiff(response, desired, guildScoped);
  if (!hasDiff(diff)) {
    return { status: "unchanged", expectedNames, diff };
  }

  const published = await options.rest.put(route, { body: desired });
  validatePublishedCommands(published, desired, guildScoped);
  return { status: "updated", expectedNames, diff };
}

type EnvReader = { get(name: string): string | undefined };

type DeploymentLogger = {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  error(
    event: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void;
};

interface RunCommandDeploymentDependencies {
  env: EnvReader;
  loadCommands: typeof loadCommands;
  createRest(token: string): CommandRestClient;
  logger: DeploymentLogger;
  correlationId(): string;
}

interface CommandDeploymentEntrypointDependencies {
  runCommandDeployment(correlationId: string): Promise<CommandSyncResult>;
  logger: DeploymentLogger;
  correlationId(): string;
  setExitCode(code: number): void;
}

const defaultDependencies: RunCommandDeploymentDependencies = {
  env: Deno.env,
  loadCommands,
  createRest: (token) => new REST().setToken(token),
  logger: botLogger,
  correlationId: () => crypto.randomUUID(),
};

export async function runCommandDeployment(
  dependencies: RunCommandDeploymentDependencies = defaultDependencies,
): Promise<CommandSyncResult> {
  const token = dependencies.env.get("DISCORD_TOKEN");
  const clientId = dependencies.env.get("DISCORD_CLIENT_ID");
  const guildId = dependencies.env.get("DISCORD_GUILD_ID") || undefined;
  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
  }

  const correlationId = dependencies.correlationId();
  const loadResult = await dependencies.loadCommands();
  const expectedCount = loadResult.ok ? loadResult.commands.length : 0;
  dependencies.logger.info("command.deploy.started", {
    correlationId,
    scope: guildId ? "guild" : "global",
    expectedCount,
  });

  const result = await syncApplicationCommands({
    rest: dependencies.createRest(token),
    clientId,
    guildId,
    loadResult,
  });
  dependencies.logger.info(`command.deploy.${result.status}`, {
    correlationId,
    expectedCount: result.expectedNames.length,
    expectedNames: result.expectedNames,
    diff: result.diff,
  });
  return result;
}

const defaultEntrypointDependencies: CommandDeploymentEntrypointDependencies = {
  runCommandDeployment: (correlationId) =>
    runCommandDeployment({
      ...defaultDependencies,
      correlationId: () => correlationId,
    }),
  logger: botLogger,
  correlationId: () => crypto.randomUUID(),
  setExitCode: (code) => {
    Deno.exitCode = code;
  },
};

export async function runCommandDeploymentEntrypoint(
  dependencies: CommandDeploymentEntrypointDependencies =
    defaultEntrypointDependencies,
): Promise<void> {
  const correlationId = dependencies.correlationId();
  try {
    await dependencies.runCommandDeployment(correlationId);
  } catch (error) {
    dependencies.logger.error(
      "command.deploy.failed",
      {
        correlationId,
        errorCategory: "unexpected",
      },
      error,
    );
    dependencies.setExitCode(1);
  }
}

if (import.meta.main) {
  await runCommandDeploymentEntrypoint();
}
