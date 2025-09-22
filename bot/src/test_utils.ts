import {
  Channel,
  ChatInputCommandInteraction,
  Client,
  Collection,
  CommandInteractionOptionResolver,
  Guild,
  GuildMember,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  InteractionReplyOptions,
  InteractionType,
  Message,
  Role,
  RoleCreateOptions,
  Snowflake,
  User,
} from "discord.js";
import { Command } from "./types.ts";

// Helper for deep partial types
type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
  }
  : T;

// --- Internal State for Builders ---

interface MockInteractionState {
  type: InteractionType;
  commandName: string;
  user: DeepPartial<User>;
  guild: DeepPartial<Guild> | null;
  channel: DeepPartial<Channel>;
  client: DeepPartial<Client>;
  channelId: Snowflake;
  guildId: Snowflake | null;
  stringOptions: Map<string, string | null>;
  channelOptions: Map<string, DeepPartial<Channel> | null>;
  isChatInputCommand: () => boolean;
}

// --- Mock Builders ---

/**
 * A fluent builder for creating mock `ChatInputCommandInteraction` objects for testing.
 */
export class MockInteractionBuilder {
  private state: MockInteractionState;

  constructor(commandName = "test-command") {
    this.state = {
      type: InteractionType.ApplicationCommand,
      commandName,
      user: { id: "mock-user-id", username: "MockUser" },
      guild: { id: "mock-guild-id", name: "Mock Guild" },
      channel: { id: "mock-channel-id" },
      client: { commands: new Collection<string, Command>() },
      channelId: "mock-channel-id",
      guildId: "mock-guild-id",
      stringOptions: new Map(),
      channelOptions: new Map(),
      isChatInputCommand: () => true,
    };
  }

  withUser(user: DeepPartial<User>) {
    this.state.user = user;
    return this;
  }

  withGuild(guild: DeepPartial<Guild> | null) {
    this.state.guild = guild;
    this.state.guildId = guild?.id ?? null;
    return this;
  }

  withChannel(channel: DeepPartial<Channel>) {
    this.state.channel = channel;
    this.state.channelId = channel.id!;
    return this;
  }

  withClient(client: DeepPartial<Client>) {
    this.state.client = client;
    return this;
  }

  withStringOption(name: string, value: string | null) {
    this.state.stringOptions.set(name, value);
    return this;
  }

  withChannelOption(name: string, value: DeepPartial<Channel> | null) {
    this.state.channelOptions.set(name, value);
    return this;
  }

  setIsChatInputCommand(is: boolean) {
    this.state.isChatInputCommand = () => is;
    return this;
  }

  build(): ChatInputCommandInteraction {
    const interaction = {
      ...this.state,
      isButton: () => false,
      isStringSelectMenu: () => false,
      deferReply: () => Promise.resolve({} as Message),
      editReply: () => Promise.resolve({} as Message),
      reply: (_options: InteractionReplyOptions) =>
        Promise.resolve({} as Message),
      followUp: () => Promise.resolve({} as Message),
      options: {
        getString: (name: string) => this.state.stringOptions.get(name) ?? null,
        getChannel: (name: string) =>
          this.state.channelOptions.get(name) ?? null,
      } as unknown as CommandInteractionOptionResolver,
    };

    return interaction as unknown as ChatInputCommandInteraction;
  }
}

/**
 * A fluent builder for creating mock `Guild` objects.
 */
export class MockGuildBuilder {
  private props: DeepPartial<Guild>;

  constructor(id = "mock-guild-id") {
    this.props = {
      id,
      name: "Mock Guild",
      roles: {
        cache: new Collection<Snowflake, Role>(),
        create: (options: RoleCreateOptions) =>
          Promise.resolve({ name: options.name, id: options.name } as Role),
      },
      scheduledEvents: {
        cache: new Collection<Snowflake, GuildScheduledEvent>(),
        create: (options: GuildScheduledEventCreateOptions) =>
          Promise.resolve(
            {
              id: "mock-event-id",
              ...options,
            } as unknown as GuildScheduledEvent,
          ),
        delete: () => Promise.resolve(),
        fetch: () =>
          Promise.resolve(
            this.props.scheduledEvents!.cache as Collection<
              Snowflake,
              GuildScheduledEvent
            >,
          ),
      },
      members: {
        cache: new Collection<Snowflake, GuildMember>(),
        fetch: (
          options: Snowflake | { user: Snowflake | Snowflake[] },
        ) => {
          const cache = this.props.members!.cache as Collection<
            Snowflake,
            GuildMember
          >;
          if (typeof options === "string") {
            return Promise.resolve(cache.get(options));
          }
          if (options?.user) {
            const ids = Array.isArray(options.user)
              ? options.user
              : [options.user];
            const results = new Collection<Snowflake, GuildMember>();
            for (const id of ids) {
              const member = cache.get(id);
              if (member) {
                results.set(id, member);
              }
            }
            return Promise.resolve(results);
          }
          return Promise.resolve(new Collection<Snowflake, GuildMember>());
        },
      },
      channels: {
        cache: new Collection<Snowflake, Channel>(),
        fetch: (id?: Snowflake) => {
          if (id) {
            return Promise.resolve(
              (this.props.channels!.cache as Collection<Snowflake, Channel>)
                .get(id),
            );
          }
          return Promise.resolve(
            this.props.channels!.cache as Collection<Snowflake, Channel>,
          );
        },
      },
    };
  }

  withRole(role: DeepPartial<Role>) {
    (this.props.roles!.cache as Collection<Snowflake, Role>).set(
      role.id as Snowflake,
      role as Role,
    );
    return this;
  }

  withMember(member: DeepPartial<GuildMember>) {
    (this.props.members!.cache as Collection<Snowflake, GuildMember>).set(
      member.id as Snowflake,
      member as GuildMember,
    );
    return this;
  }

  withChannel(channel: DeepPartial<Channel>) {
    (this.props.channels!.cache as Collection<Snowflake, Channel>).set(
      channel.id as Snowflake,
      channel as Channel,
    );
    return this;
  }

  withScheduledEvent(event: DeepPartial<GuildScheduledEvent>) {
    (
      this.props.scheduledEvents!.cache as Collection<
        Snowflake,
        GuildScheduledEvent
      >
    ).set(event.id as Snowflake, event as GuildScheduledEvent);
    return this;
  }

  build(): Guild {
    return this.props as Guild;
  }
}
