import * as path from "@std/path";
import { Command } from "../types.ts";
import { botLogger } from "../logger.ts";
import { isRuntimeCommandFile } from "./runtime_command_files.ts";

export async function loadCommands(): Promise<Command[]> {
  const correlationId = crypto.randomUUID();
  const commands: Command[] = [];
  const dirname = path.dirname(path.fromFileUrl(import.meta.url));
  const commandsPath = path.join(dirname, "..", "commands");

  for await (const dirEntry of Deno.readDir(commandsPath)) {
    if (
      dirEntry.isFile && isRuntimeCommandFile(dirEntry.name)
    ) {
      const filePath = path.join(commandsPath, dirEntry.name);
      try {
        const command = await import(path.toFileUrl(filePath).href);
        if ("data" in command && "execute" in command) {
          commands.push(command as Command);
        } else {
          botLogger.warn("command.load.invalid_export", {
            correlationId,
            commandFile: dirEntry.name,
          });
        }
      } catch (error) {
        botLogger.error("command.load.failed", {
          correlationId,
          errorCategory: "unexpected",
          commandFile: dirEntry.name,
        }, error);
      }
    }
  }
  return commands;
}
