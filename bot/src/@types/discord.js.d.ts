import type { Collection } from "discord.js";
import { Command } from "../types.ts";

declare module "discord.js" {
  export interface Client {
    commands: Collection<string, Command>;
  }
}
