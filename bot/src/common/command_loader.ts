import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.ts";
import {
  type CommandRegistration,
  commandRegistry,
  type EnabledCommandRegistration,
  enabledCommandRegistrations,
} from "./command_registry.ts";

export type CommandLoadErrorCode =
  | "REGISTRY_MISMATCH"
  | "IMPORT_FAILED"
  | "INVALID_MODULE"
  | "INVALID_SCHEMA"
  | "NAME_MISMATCH"
  | "DUPLICATE_NAME";

export interface CommandLoadError {
  code: CommandLoadErrorCode;
  fileName: string;
  message: string;
}

export function formatCommandLoadErrors(
  errors: readonly CommandLoadError[],
): string {
  return errors.map((error) =>
    `${error.fileName} (${error.code}): ${error.message}`
  ).join(", ");
}

export type CommandLoadResult =
  | { ok: true; commands: readonly Command[] }
  | { ok: false; errors: readonly CommandLoadError[] };

export interface CommandLoaderDependencies {
  registry: readonly CommandRegistration[];
  listCommandFiles(): Promise<readonly string[]>;
  importCommand(fileName: string): Promise<unknown>;
}

const commandsDirectory = new URL("../commands/", import.meta.url);

async function listDefaultCommandFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(commandsDirectory)) {
    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

function importDefaultCommand(fileName: string): Promise<unknown> {
  const fileUrl = new URL(fileName, commandsDirectory);
  return import(fileUrl.href);
}

const defaultDependencies: CommandLoaderDependencies = {
  registry: commandRegistry,
  listCommandFiles: listDefaultCommandFiles,
  importCommand: importDefaultCommand,
};

function error(
  code: CommandLoadErrorCode,
  fileName: string,
  message: string,
): CommandLoadError {
  return { code, fileName, message };
}

function registryErrors(
  files: readonly string[],
  registry: readonly CommandRegistration[],
): CommandLoadError[] {
  const errors: CommandLoadError[] = [];
  const fileSet = new Set(files);
  const registryFiles = new Set(registry.map((entry) => entry.fileName));
  const registrationsByFile = new Map<string, CommandRegistration[]>();
  const registrationsByName = new Map<string, CommandRegistration[]>();

  for (const entry of registry) {
    const fileRegistrations = registrationsByFile.get(entry.fileName) ?? [];
    fileRegistrations.push(entry);
    registrationsByFile.set(entry.fileName, fileRegistrations);

    const nameRegistrations = registrationsByName.get(entry.expectedName) ?? [];
    nameRegistrations.push(entry);
    registrationsByName.set(entry.expectedName, nameRegistrations);
  }

  for (const fileName of files) {
    if (!registryFiles.has(fileName)) {
      errors.push(error(
        "REGISTRY_MISMATCH",
        fileName,
        `Command file is not registered: ${fileName}`,
      ));
    }
  }
  for (const entry of registry) {
    if (!fileSet.has(entry.fileName)) {
      errors.push(error(
        "REGISTRY_MISMATCH",
        entry.fileName,
        `Registered command file does not exist: ${entry.fileName}`,
      ));
    }
    if (entry.status === "disabled" && !entry.disabledReason) {
      errors.push(error(
        "REGISTRY_MISMATCH",
        entry.fileName,
        `Disabled command requires a reason: ${entry.fileName}`,
      ));
    }
  }
  for (const [fileName, registrations] of registrationsByFile) {
    if (registrations.length > 1) {
      errors.push(error(
        "REGISTRY_MISMATCH",
        fileName,
        `Command file is registered more than once: ${fileName}`,
      ));
    }
  }
  for (const [name, registrations] of registrationsByName) {
    if (registrations.length > 1) {
      for (const registration of registrations) {
        errors.push(error(
          "DUPLICATE_NAME",
          registration.fileName,
          `Command name is registered more than once: ${name}`,
        ));
      }
    }
  }
  return errors.sort((left, right) =>
    left.fileName.localeCompare(right.fileName) ||
    left.code.localeCompare(right.code)
  );
}

function commandFromModule(
  module: unknown,
  registration: EnabledCommandRegistration,
): { command?: Command; errors: CommandLoadError[] } {
  if (typeof module !== "object" || module === null) {
    return {
      errors: [error(
        "INVALID_MODULE",
        registration.fileName,
        "Command module must export data and execute",
      )],
    };
  }

  const candidate = module as Record<string, unknown>;
  const data = candidate.data;
  const execute = candidate.execute;
  if (!data || typeof execute !== "function") {
    return {
      errors: [error(
        "INVALID_MODULE",
        registration.fileName,
        "Command module must export data and execute()",
      )],
    };
  }
  if (!(data instanceof SlashCommandBuilder)) {
    return {
      errors: [error(
        "INVALID_SCHEMA",
        registration.fileName,
        "Command data must be a SlashCommandBuilder",
      )],
    };
  }

  let payload: ReturnType<Command["data"]["toJSON"]>;
  try {
    data.setContexts(...registration.contexts);
    data.setIntegrationTypes(...registration.integrationTypes);
    payload = data.toJSON();
  } catch {
    return {
      errors: [error(
        "INVALID_SCHEMA",
        registration.fileName,
        "Command data could not be serialized",
      )],
    };
  }
  if (
    typeof payload.name !== "string" || payload.name.length === 0 ||
    typeof payload.description !== "string" || payload.description.length === 0
  ) {
    return {
      errors: [error(
        "INVALID_SCHEMA",
        registration.fileName,
        "Command data must contain a name and description",
      )],
    };
  }
  if (data.name !== payload.name) {
    return {
      errors: [error(
        "INVALID_SCHEMA",
        registration.fileName,
        "Command builder name does not match its serialized payload",
      )],
    };
  }
  if (payload.name !== registration.expectedName) {
    return {
      errors: [error(
        "NAME_MISMATCH",
        registration.fileName,
        `Expected command name ${registration.expectedName}, got ${payload.name}`,
      )],
    };
  }

  return {
    command: { data, execute: execute as Command["execute"] },
    errors: [],
  };
}

export async function loadCommands(
  dependencies: CommandLoaderDependencies = defaultDependencies,
): Promise<CommandLoadResult> {
  const files = await dependencies.listCommandFiles();
  const errors = registryErrors(files, dependencies.registry);
  if (errors.length > 0) return { ok: false, errors };

  const commands: Command[] = [];
  for (
    const registration of enabledCommandRegistrations(dependencies.registry)
  ) {
    let module: unknown;
    try {
      module = await dependencies.importCommand(registration.fileName);
    } catch {
      errors.push(error(
        "IMPORT_FAILED",
        registration.fileName,
        `Failed to import command: ${registration.fileName}`,
      ));
      continue;
    }

    const loaded = commandFromModule(module, registration);
    errors.push(...loaded.errors);
    if (loaded.command) commands.push(loaded.command);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors: errors.sort((left, right) =>
        left.fileName.localeCompare(right.fileName) ||
        left.code.localeCompare(right.code)
      ),
    };
  }

  commands.sort((left, right) => left.data.name.localeCompare(right.data.name));
  return { ok: true, commands };
}
