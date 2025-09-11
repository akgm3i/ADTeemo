import * as path from "@std/path";
import { Command } from "../types.ts";

export async function loadCommands(): Promise<Command[]> {
  const commands: Command[] = [];
  const dirname = path.dirname(path.fromFileUrl(import.meta.url));
  const commandsPath = path.join(dirname, "..", "commands");

  for await (const dirEntry of Deno.readDir(commandsPath)) {
    if (
      dirEntry.isFile && dirEntry.name.endsWith(".ts") &&
      !dirEntry.name.endsWith(".test.ts")
    ) {
      const filePath = path.join(commandsPath, dirEntry.name);
      try {
        const command = await import(path.toFileUrl(filePath).href);
        if ("data" in command && "execute" in command) {
          commands.push(command as Command);
        } else {
          console.log(
            `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
          );
        }
      } catch (error) {
        console.error(`Error loading command at ${filePath}:`, error);
      }
    }
  }
  return commands;
}
