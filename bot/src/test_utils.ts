import { type Spy, spy } from "@std/testing/mock";
import {
  type CacheType,
  type Channel,
  type ChatInputCommandInteraction,
  type Client,
  Collection,
  type CommandInteraction,
  type CommandInteractionOptionResolver,
  type Guild,
  type GuildMember,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventStatus,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  InteractionType,
  type Message,
  type MessagePayload,
  type Role,
  type RoleManager,
  type Snowflake,
} from "discord.js";
import type { Command } from "./types.ts";

type MockOptions = {
  isChatInputCommand: boolean;
  commandName: string;
  guild: Partial<Guild> | null;
  client: Partial<Client> & { commands: Collection<string, Command> };
  replied: boolean;
  deferred: boolean;
  user: { id: string };
  channel: Partial<Channel>;
  options: {
    getString?: (name: string, required?: boolean) => string | null;
    getChannel?: (name: string, required?: boolean) => Channel | null;
  };
  deferReplyFn?: (
    options?: InteractionDeferReplyOptions,
  ) => Promise<Message | void>;
};

export function newMockChatInputCommandInteractionBuilder(
  commandName = "test-command",
) {
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
    channel: {},
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

    withUser(user: { id: string }) {
      props.user = user;
      return this;
    },

    withStringOption(
      fn: (name: string, required?: boolean) => string | null,
    ) {
      props.options.getString = fn;
      return this;
    },

    withChannelOption(
      name: string,
      channel: Channel,
    ) {
      props.options.getChannel = (optionName: string) => {
        if (optionName === name) return channel;
        return null;
      };
      return this;
    },

    withChannel(channel: Partial<Channel>) {
      props.channel = channel;
      return this;
    },

    withDeferReply(
      fn: (options?: InteractionDeferReplyOptions) => Promise<Message | void>,
    ) {
      props.deferReplyFn = fn;
      return this;
    },

    setReplied(replied: boolean) {
      props.replied = replied;
      return this;
    },

    build() {
      const interaction = {
        type: InteractionType.ApplicationCommand,
        isChatInputCommand: (): this is ChatInputCommandInteraction<
          CacheType
        > => props.isChatInputCommand,
        isStringSelectMenu: () => false,
        isButton: () => false,
        commandName: props.commandName,
        deferReply: spy(
          props.deferReplyFn ??
            ((_o?: InteractionDeferReplyOptions) => Promise.resolve()),
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
        channel: props.channel,
        replied: props.replied,
        deferred: props.deferred,
        user: props.user,
        options: {
          getString: spy(
            (name: string, required?: boolean) =>
              props.options.getString?.(name, required),
          ),
          getChannel: spy(
            (name: string, required?: boolean) =>
              props.options.getChannel?.(name, required),
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
          getChannel: Spy<CommandInteractionOptionResolver["getChannel"]>;
        };
      };
    },
  };

  return builder;
}

export function createMockMessage(content: string) {
  return {
    content,
    author: {
      bot: false,
    },
  } as Message;
}

export function newMockStringSelectMenuInteractionBuilder(
  customId: string,
  values: string[],
) {
  const interaction = {
    type: InteractionType.MessageComponent,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    customId,
    values,
    deferUpdate: spy(() => Promise.resolve()),
    editReply: spy(
      (_o: string | MessagePayload | InteractionEditReplyOptions) =>
        Promise.resolve(),
    ),
    guild: {
      scheduledEvents: {
        delete: spy(() => Promise.resolve()),
      },
    },
    channel: {
      messages: {
        delete: spy(() => Promise.resolve()),
      },
    },
    user: { id: "test-user-id" },
  };

  return {
    build: () =>
      interaction as unknown as ({
        isStringSelectMenu: () => true;
        deferUpdate: Spy;
        editReply: Spy;
        guild: {
          scheduledEvents: {
            delete: Spy;
          };
        };
        channel: {
          messages: {
            delete: Spy;
          };
        };
      }),
  };
}

export function newMockGuildBuilder(id = "mock-guild-id") {
  const props = {
    id,
    scheduledEvents: new Collection<string, GuildScheduledEvent>(),
    channels: new Collection<string, Channel>(),
    members: new Collection<string, GuildMember>(),
    createEventSpy: spy(
      (
        _options: GuildScheduledEventCreateOptions,
      ): Promise<GuildScheduledEvent> =>
        Promise.resolve({ id: "mock-event-id" } as GuildScheduledEvent),
    ),
  };

  const builder = {
    withScheduledEvent(
      event: { id: string; status: GuildScheduledEventStatus },
    ) {
      props.scheduledEvents.set(
        event.id,
        { id: event.id, status: event.status } as GuildScheduledEvent,
      );
      return this;
    },
    withChannel(channel: Channel) {
      props.channels.set(channel.id, channel);
      return this;
    },
    withMember(member: GuildMember) {
      props.members.set(member.id, member);
      return this;
    },
    getCreateEventSpy() {
      return props.createEventSpy;
    },
    build() {
      return {
        id: props.id,
        scheduledEvents: {
          fetch: () => Promise.resolve(props.scheduledEvents),
          create: props.createEventSpy,
        },
        channels: {
          fetch: (id: string) => Promise.resolve(props.channels.get(id)),
          cache: props.channels,
        },
        members: {
          fetch: (options: { user: string } | string) => {
            const id = typeof options === "string" ? options : options.user;
            return Promise.resolve(props.members.get(id));
          },
        },
      } as unknown as Guild;
    },
  };

  return builder;
}
