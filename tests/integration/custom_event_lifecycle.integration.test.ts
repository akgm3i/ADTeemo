import { assert, assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { customGameEvents } from "../../api/src/db/schema.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import {
  type CreateCustomGameDiscordEffects,
  createCustomGameEventSaga,
} from "../../bot/src/features/custom_game_event_saga.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";
import { ApiContractError } from "../../bot/src/api_clients/transport.ts";

const input = {
  operationKey: "vertical-event-1",
  name: "週末カスタム",
  guildId: "guild-1",
  creatorId: "creator-1",
  recruitmentChannelId: "channel-1",
  voiceChannelId: "voice-1",
  scheduledStartAt: new Date("2026-08-01T12:00:00.000Z"),
  recruitmentMessageContent: "参加募集",
};
type Step = {
  method: keyof CreateCustomGameDiscordEffects;
  args?: unknown;
  value?: { id: string } | null;
  error?: Error;
};
function strictDiscordEffects(steps: Step[]) {
  const pending = [...steps], unexpected: string[] = [];
  const calls: {
    method: keyof CreateCustomGameDiscordEffects;
    args: unknown;
  }[] = [];
  function call(
    method: keyof CreateCustomGameDiscordEffects,
    args: unknown,
  ) {
    calls.push({ method, args });
    const step = pending.shift();
    if (!step || step.method !== method) {
      unexpected.push(method);
      throw new Error(`Unexpected Discord ${method}`);
    }
    if (step.args !== undefined) {
      try {
        assertEquals(args, step.args);
      } catch (error) {
        unexpected.push(method);
        throw error;
      }
    }
    if (step.error) throw step.error;
    return step.value;
  }
  async function created(
    method: keyof CreateCustomGameDiscordEffects,
    args: unknown,
  ) {
    const value = await call(method, args);
    assert(value);
    return value;
  }
  const effects: CreateCustomGameDiscordEffects = {
    createScheduledEvent: (args) => created("createScheduledEvent", args),
    createRecruitmentMessage: (args) =>
      created("createRecruitmentMessage", args),
    addRecruitmentReactions: async (args) => {
      await call("addRecruitmentReactions", args);
    },
    findScheduledEvent: async (args) =>
      (await call("findScheduledEvent", args)) ?? null,
    findRecruitmentMessage: async (args) =>
      (await call("findRecruitmentMessage", args)) ?? null,
    deleteScheduledEvent: async (args) => {
      await call("deleteScheduledEvent", args);
    },
    deleteRecruitmentMessage: async (args) => {
      await call("deleteRecruitmentMessage", args);
    },
  };
  return {
    effects,
    calls,
    [Symbol.dispose]() {
      assertEquals(unexpected, []);
      assertEquals(pending, [], "未消費のDiscord操作");
    },
  };
}
const creation: Step[] = [
  { method: "createScheduledEvent", value: { id: "discord-event-1" } },
  { method: "createRecruitmentMessage", value: { id: "message-1" } },
  { method: "addRecruitmentReactions", args: "message-1" },
];

test("実Bot sagaで作成・scope違反・中止を実行すると、所有境界とDiscord削除進捗がDBへ保存される", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  const saga = createCustomGameEventSaga(api);
  using discord = strictDiscordEffects([...creation, {
    method: "deleteScheduledEvent",
    args: "discord-event-1",
  }, { method: "deleteRecruitmentMessage", args: "message-1" }]);
  // Act / Assert
  const created = await saga.create(input, discord.effects);
  assert(created.success);
  const [saved] = await database.db.select().from(customGameEvents);
  assertEquals([
    saved.guildId,
    saved.recruitmentChannelId,
    saved.discordScheduledEventId,
    saved.recruitmentMessageId,
    saved.phase,
    saved.syncState,
  ], [
    "guild-1",
    "channel-1",
    "discord-event-1",
    "message-1",
    "RECRUITING",
    "CONSISTENT",
  ]);
  assertEquals(discord.calls[0].args, {
    operationKey: input.operationKey,
    name: input.name,
    voiceChannelId: input.voiceChannelId,
    scheduledStartAt: input.scheduledStartAt,
  });
  assertEquals(discord.calls[1].args, {
    content: input.recruitmentMessageContent,
    nonce: input.operationKey,
    createdAfter: saved.createdAt,
  });
  const denied = await saga.cancel({
    eventId: saved.id,
    guildId: "other-guild",
    recruitmentChannelId: input.recruitmentChannelId,
  }, discord.effects);
  assertEquals(denied.success, false);
  assertEquals(discord.calls.length, 3);
  const cancelled = await saga.cancel({
    eventId: saved.id,
    guildId: input.guildId,
    recruitmentChannelId: input.recruitmentChannelId,
  }, discord.effects);
  assert(cancelled.success);
  const [final] = await database.db.select().from(customGameEvents);
  assertEquals([
    final.phase,
    final.syncState,
    final.discordEventDeleted,
    final.recruitmentMessageDeleted,
  ], ["CANCELLED", "CONSISTENT", true, true]);
});

test("Discord途中失敗後に補償削除も失敗すると、DBに再試行状態を残して次の中止で収束する", async () => {
  await using database = await createMigratedTestDatabase();
  const saga = createCustomGameEventSaga(
    createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: database.actions })),
    ),
  );
  using discord = strictDiscordEffects([
    ...creation.slice(0, 2),
    {
      method: "addRecruitmentReactions",
      error: new Error("Discord unavailable"),
    },
    { method: "deleteRecruitmentMessage", args: "message-1" },
    {
      method: "deleteScheduledEvent",
      args: "discord-event-1",
      error: new Error("Retry deletion"),
    },
    { method: "deleteScheduledEvent", args: "discord-event-1" },
  ]);
  const created = await saga.create(input, discord.effects);
  assertEquals(created.success, false);
  const [pending] = await database.db.select().from(customGameEvents);
  assertEquals([
    pending.syncState,
    pending.discordEventDeleted,
    pending.recruitmentMessageDeleted,
  ], ["CREATE_COMPENSATION_PENDING", false, true]);
  const retried = await saga.cancel({
    eventId: pending.id,
    guildId: input.guildId,
    recruitmentChannelId: input.recruitmentChannelId,
  }, discord.effects);
  assert(retried.success);
  const [final] = await database.db.select().from(customGameEvents);
  assertEquals([
    final.phase,
    final.syncState,
    final.discordEventDeleted,
    final.recruitmentMessageDeleted,
  ], ["CANCELLED", "CONSISTENT", true, true]);
});

test("実providerの成功応答が転送中に壊れると、Botは契約エラーで止まりDiscord成功副作用を出さない", async () => {
  await using database = await createMigratedTestDatabase();
  const statuses: number[] = [];
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
    (response, request) => {
      assertEquals(new URL(request.url).pathname, "/events");
      statuses.push(response.status);
      return Response.json({}, { status: response.status });
    },
  );
  using discord = strictDiscordEffects([]);
  const result = await createCustomGameEventSaga(api).create(
    input,
    discord.effects,
  );
  assert(!result.success);
  const cause = result.error.primaryFailure.cause;
  assert(
    typeof cause === "object" && cause !== null && "success" in cause &&
      cause.success === false && "error" in cause &&
      typeof cause.error === "string",
  );
  assert(
    "contractError" in cause && cause.contractError instanceof ApiContractError,
  );
  assertEquals(cause.contractError.kind, "contract_error");
  assertEquals(statuses, [201, 200, 200, 200]);
  const rows = await database.db.select().from(customGameEvents);
  assertEquals(rows.length, 1);
  assertEquals([
    rows[0].syncState,
    rows[0].discordScheduledEventId,
    rows[0].recruitmentMessageId,
  ], ["CREATE_PENDING", null, null]);
});
