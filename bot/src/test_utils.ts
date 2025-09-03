import { type Spy, spy } from "jsr:@std/testing/mock";
import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  Collection,
  type CommandInteraction,
  type CommandInteractionOptionResolver,
  type Guild,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type MessagePayload,
  type Role,
  type RoleManager,
  type Snowflake,
} from "npm:discord.js";
import type { Command } from "./types.ts";

type MockOptions = {
  isChatInputCommand: boolean;
  commandName: string;
  guild: Partial<Guild> | null;
  client: Partial<Client> & { commands: Collection<string, Command> };
  replied: boolean;
  deferred: boolean;
  user: { id: string };
  options: {
    getString?: (name: string, required?: boolean) => string | null;
  };
};

export function newMockInteractionBuilder(commandName = "test-command") {
  const props: MockOptions = {
    commandName,
    isChatInputCommand: true,
    guild: {
      id: "mock-guild-id",
      roles: {
        cache: new Collection<Snowflake, Role>(),
        create: spy(() => Promise.resolve({} as Role)),
      } as unknown as RoleManager, // This cast is necessary for a partial mock
    } as Partial<Guild>,
    client: {
      commands: new Collection<string, Command>(),
    },
    replied: false,
    deferred: false,
    user: { id: "test-user-id" },
    options: {},
  };

  const builder = {
    withCommandName(name: string) {
      props.commandName = name;
      return this;
    },

    withIsChatInputCommand(is: boolean) {
      props.isChatInputCommand = is;
      return this;
    },

    withClient(
      client: Partial<Client> & { commands: Collection<string, Command> },
    ) {
      props.client = client;
      return this;
    },

    withGuild(guild: Partial<Guild> | null) {
      props.guild = guild;
      return this;
    },

    withStringOption(
      fn: (name: string, required?: boolean) => string | null,
    ) {
      props.options.getString = fn;
      return this;
    },

    setReplied(replied: boolean) {
      props.replied = replied;
      return this;
    },

    build() {
      const interaction = {
        isChatInputCommand: (): this is ChatInputCommandInteraction<
          CacheType
        > => props.isChatInputCommand,
        commandName: props.commandName,
        deferReply: spy(
          (_o?: InteractionDeferReplyOptions) => Promise.resolve(),
        ),
        editReply: spy(
          (_o: string | MessagePayload | InteractionEditReplyOptions) =>
            Promise.resolve(),
        ),
        followUp: spy(
          (_o: string | MessagePayload | InteractionEditReplyOptions) =>
            Promise.resolve(),
        ),
        reply: spy(
          (_o: string | MessagePayload | InteractionEditReplyOptions) =>
            Promise.resolve(),
        ),
        guild: props.guild,
        client: props.client,
        replied: props.replied,
        deferred: props.deferred,
        user: props.user,
        options: {
          getString: spy(
            (name: string, required?: boolean) =>
              props.options.getString?.(name, required),
          ),
        },
      };

      return interaction as unknown as CommandInteraction & {
        deferReply: Spy;
        editReply: Spy;
        followUp: Spy;
        reply: Spy;
        guild: typeof props.guild;
        client: typeof props.client;
        options: {
          getString: Spy<CommandInteractionOptionResolver["getString"]>;
        };
      };
    },
  };

  return builder;
}
