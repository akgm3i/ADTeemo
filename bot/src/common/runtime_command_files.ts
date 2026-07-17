import { commandRegistry } from "./command_registry.ts";

export function isRuntimeCommandFile(name: string): boolean {
  return commandRegistry.some((entry) =>
    entry.fileName === name && entry.status === "enabled"
  );
}
