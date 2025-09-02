import { CommandInteraction, SlashCommandBuilder } from "npm:discord.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: CommandInteraction) => Promise<void>;
}
