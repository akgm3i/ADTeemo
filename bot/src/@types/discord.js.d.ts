import type { Collection } from "npm:discord.js";
import { Command } from "../types.ts";

declare module "npm:discord.js" {
  export interface Client {
    commands: Collection<string, Command>;
  }
}
