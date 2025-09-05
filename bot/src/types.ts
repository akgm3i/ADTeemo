import { CommandInteraction, SlashCommandBuilder } from "npm:discord.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: CommandInteraction) => Promise<void>;
}

export interface CustomGameEvent {
  id: number;
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  createdAt: string;
}
