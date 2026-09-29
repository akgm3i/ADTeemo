import { assert, assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { strictFake } from "../../bot/src/features/testing/strict_fake.ts";
import {
  BOT_API_REQUEST_TIMEOUT_MS,
  createApiClient,
  createApiRpcClients,
} from "../../bot/src/api_client.ts";
import { createApp } from "../../api/src/app.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { customGameEvents } from "../../api/src/db/schema.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_TOKEN,
} from "../../api/src/test_utils.ts";
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
  run?: () => Promise<{ id: string } | null | void>;
};
function strictDiscordEffects(steps: Step[]) {
  const script = strictFake<
    [keyof CreateCustomGameDiscordEffects, unknown],
    Step
  >(
    "Discord effects",
    steps.map((step) => ({
      check: (method, args) => {
        assertEquals(method, step.method);
        if (step.args !== undefined) assertEquals(args, step.args);
      },
      value: step,
    })),
  );
  const boundaryFailures: unknown[] = [];
  async function call(
    method: keyof CreateCustomGameDiscordEffects,
    args: unknown,
  ) {
    const step = script.invoke(method, args);
    let value = step.value;
    if (step.run) {
      try {
        value = (await step.run()) ?? undefined;
      } catch (error) {
        boundaryFailures.push(error);
        throw error;
      }
    }
    if (step.error) throw step.error;
    return value;
  }
  async function created(
    method: keyof CreateCustomGameDiscordEffects,
    args: unknown,
  ) {
    const value = await call(method, args);
    try {
      assert(value);
      return value;
    } catch (error) {
      boundaryFailures.push(error);
      throw error;
    }
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
    get calls() {
      return script.calls.map(([method, args]) => ({ method, args }));
    },
    [Symbol.dispose]() {
      script[Symbol.dispose]();
      assertEquals(boundaryFailures, [], "Discord boundary assertions");
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
  const replayed = await saga.create(input, discord.effects);
  assertEquals(replayed, created);
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

const scope = {
  guildId: input.guildId,
  recruitmentChannelId: input.recruitmentChannelId,
};
const preparation = {
  operationKey: input.operationKey,
  name: input.name,
  guildId: input.guildId,
  creatorId: input.creatorId,
  recruitmentChannelId: input.recruitmentChannelId,
  voiceChannelId: input.voiceChannelId,
  scheduledStartAt: input.scheduledStartAt,
};

for (
  const checkpoint of [
    "discordScheduledEventId",
    "recruitmentMessageId",
  ] as const
) {
  test(`実DBへ${checkpoint}をcommit後に応答を2回失っても、同じIDの再送で収束する`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    let dropped = 0;
    const checkpointIds: string[] = [];
    const operationKeys: string[] = [];
    const api = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: database.actions })),
      async (response, request) => {
        const body = await request.json();
        if (new URL(request.url).pathname === "/events") {
          operationKeys.push(body.operationKey);
        }
        if (body[checkpoint]) {
          checkpointIds.push(body[checkpoint]);
          if (dropped++ < 2) {
            await response.body?.cancel();
            throw new TypeError("response lost after commit");
          }
        }
        return response;
      },
    );
    using discord = strictDiscordEffects(creation);

    // Act
    const result = await createCustomGameEventSaga(api).create(
      input,
      discord.effects,
    );

    // Assert
    assert(result.success);
    assertEquals(new Set(operationKeys), new Set([input.operationKey]));
    assertEquals(
      new Set(checkpointIds),
      new Set([
        checkpoint === "discordScheduledEventId"
          ? "discord-event-1"
          : "message-1",
      ]),
    );
    assert(checkpointIds.length >= 2);
    const rows = await database.db.select().from(customGameEvents);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].phase, rows[0].syncState], [
      "RECRUITING",
      "CONSISTENT",
    ]);
  });
}

test("activateを実DBへcommit後に応答を喪失しても、再送は同じ確定行を返し補償削除しない", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  let lost = false;
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
    (response, request) => {
      if (request.url.endsWith("/activate") && !lost) {
        lost = true;
        void response.body?.cancel();
        throw new TypeError("response lost after commit");
      }
      return response;
    },
  );
  using discord = strictDiscordEffects(creation);

  // Act
  const result = await createCustomGameEventSaga(api).create(
    input,
    discord.effects,
  );

  // Assert
  assert(result.success);
  assertEquals(lost, true);
  const rows = await database.db.select().from(customGameEvents);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].phase, "RECRUITING");
});

for (const stalledAt of ["headers", "body"] as const) {
  test(`実DB確定後にactivateの${stalledAt}が繰り返しtimeoutしても、補償せず同じoperationKeyで再照合できる`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    using time = new FakeTime("2026-09-29T00:00:00Z");
    const app = createApp(
      createTestDependencies({ dbActions: database.actions }),
    );
    const waiting = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    let stalls = 0;
    let stall = true;
    const signals: AbortSignal[] = [];
    const rpc = createApiRpcClients({
      apiUrl: "http://adteemo.integration.test",
      credential: TEST_BOT_SERVICE_TOKEN,
      fetch: async (url, init) => {
        const request = new Request(url, init);
        const response = await app.fetch(request);
        if (
          stall && stalls > 0 && new URL(request.url).pathname === "/events"
        ) {
          await response.body?.cancel();
          throw new TypeError("reconciliation response lost");
        }
        if (!request.url.endsWith("/activate") || !stall) return response;
        await response.body?.cancel();
        const signal = init!.signal!;
        signals.push(signal);
        waiting[stalls++].resolve();
        if (stalledAt === "headers") {
          return await new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener(
                "abort",
                () => controller.error(signal.reason),
                { once: true },
              );
            },
          }),
        );
      },
    });
    const saga = createCustomGameEventSaga(
      createApiClient({ rpcClient: rpc.botServiceRpcClient }),
    );
    using discord = strictDiscordEffects(creation);

    // Act
    const creating = saga.create(input, discord.effects);
    await waiting[0].promise;
    await time.tickAsync(BOT_API_REQUEST_TIMEOUT_MS);
    await waiting[1].promise;
    await time.tickAsync(BOT_API_REQUEST_TIMEOUT_MS);
    const unknown = await creating;
    stall = false;
    const retried = await saga.create(input, discord.effects);

    // Assert
    assert(!unknown.success);
    assertEquals(unknown.error.primaryFailure.step, "PREPARE_EVENT");
    assertEquals(signals.every((signal) => signal.aborted), true);
    assert(retried.success);
    assertEquals(discord.calls.length, 3);
    const rows = await database.db.select().from(customGameEvents);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].operationKey, rows[0].phase, rows[0].syncState], [
      input.operationKey,
      "RECRUITING",
      "CONSISTENT",
    ]);
  });
}

test("同じoperationKeyの同時作成と作成中の取消は実APIに接続しても直列化される", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  const saga = createCustomGameEventSaga(api);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<{ id: string }>();
  using discord = strictDiscordEffects([
    {
      method: "createScheduledEvent",
      run: () => {
        entered.resolve();
        return release.promise;
      },
    },
    ...creation.slice(1),
    { method: "deleteScheduledEvent", args: "discord-event-1" },
    { method: "deleteRecruitmentMessage", args: "message-1" },
  ]);

  // Act
  const first = saga.create(input, discord.effects);
  const duplicate = saga.create(input, discord.effects);
  await entered.promise;
  const [prepared] = await database.db.select().from(customGameEvents);
  const cancelling = saga.cancel(
    { eventId: prepared.id, ...scope },
    discord.effects,
  );
  release.resolve({ id: "discord-event-1" });
  const results = await Promise.all([first, duplicate, cancelling]);

  // Assert
  assertEquals(results.map((result) => result.success), [true, true, true]);
  const [saved] = await database.db.select().from(customGameEvents);
  assertEquals([saved.phase, saved.syncState], ["CANCELLED", "CONSISTENT"]);
  assertEquals(discord.calls.map((call) => call.method), [
    "createScheduledEvent",
    "createRecruitmentMessage",
    "addRecruitmentReactions",
    "deleteScheduledEvent",
    "deleteRecruitmentMessage",
  ]);
});

for (const completed of [false, true]) {
  test(`別処理の取消${completed ? "完了" : "開始"}と作成checkpointが競合したとき、今回IDだけを実DBの所有状態に従って削除する`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const api = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: database.actions })),
    );
    using discord = strictDiscordEffects([
      {
        method: "createScheduledEvent",
        run: async () => {
          const [prepared] = await database.db.select().from(customGameEvents);
          assert(
            (await api.beginCustomGameEventCancellation(prepared.id, scope))
              .success,
          );
          if (completed) {
            assert(
              (await api.updateCustomGameEventCancellationProgress(
                prepared.id,
                {
                  ...scope,
                  discordEventDeleted: true,
                  recruitmentMessageDeleted: true,
                },
              )).success,
            );
          }
          return { id: "late-discord-event" };
        },
      },
      { method: "deleteScheduledEvent", args: "late-discord-event" },
    ]);

    // Act
    const result = await createCustomGameEventSaga(api).create(
      input,
      discord.effects,
    );

    // Assert
    assert(!result.success);
    const [saved] = await database.db.select().from(customGameEvents);
    assertEquals(saved.discordEventDeleted, true);
    assertEquals(saved.syncState, completed ? "CONSISTENT" : "CANCEL_PENDING");
    assertEquals(saved.recruitmentMessageDeleted, completed);
    if (!completed) {
      assertEquals(saved.discordScheduledEventId, "late-discord-event");
    }
  });
}

test("別処理が募集確定した直後に補償claimが競合したとき、実DBを再照合して確定済みresourceを削除しない", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  using discord = strictDiscordEffects([...creation.slice(0, 2), {
    method: "addRecruitmentReactions",
    run: async () => {
      const [row] = await database.db.select().from(customGameEvents);
      assert((await api.activateCustomGameEvent(row.id, scope)).success);
    },
    error: new Error("reaction response lost"),
  }]);

  // Act
  const result = await createCustomGameEventSaga(api).create(
    input,
    discord.effects,
  );

  // Assert
  assert(result.success);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([
    row.phase,
    row.syncState,
    row.discordEventDeleted,
    row.recruitmentMessageDeleted,
  ], ["RECRUITING", "CONSISTENT", false, false]);
});

for (
  const state of ["CREATE_PENDING", "CREATE_COMPENSATION_PENDING"] as const
) {
  test(`実DBの${state}を再起動後に再開して検索0件でも、不存在確認済みへ進めない`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const api = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: database.actions })),
    );
    const prepared = await api.prepareCustomGameEvent(preparation);
    assert(prepared.success);
    if (state === "CREATE_COMPENSATION_PENDING") {
      assert(
        (await api.markCustomGameEventCreationFailed(prepared.event.id, {
          ...scope,
          discordEventDeleted: false,
          recruitmentMessageDeleted: false,
          failureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
        })).success,
      );
    }
    using discord = strictDiscordEffects(
      state === "CREATE_PENDING"
        ? [{ method: "findScheduledEvent", value: null }]
        : [{ method: "findRecruitmentMessage", value: null }, {
          method: "findScheduledEvent",
          value: null,
        }],
    );

    // Act
    const result = await createCustomGameEventSaga(api).create(
      input,
      discord.effects,
    );

    // Assert
    assert(!result.success);
    const [row] = await database.db.select().from(customGameEvents);
    assertEquals([
      row.syncState,
      row.discordEventDeleted,
      row.recruitmentMessageDeleted,
    ], [state, false, false]);
  });
}

test("作成途中を実DBから取り消してDiscord検索が0件でも、CANCEL_PENDINGを保持する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  const prepared = await api.prepareCustomGameEvent(preparation);
  assert(prepared.success);
  using discord = strictDiscordEffects([{
    method: "findScheduledEvent",
    value: null,
  }]);

  // Act
  const result = await createCustomGameEventSaga(api).cancel({
    eventId: prepared.event.id,
    ...scope,
  }, discord.effects);

  // Assert
  assert(!result.success);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([
    row.syncState,
    row.discordEventDeleted,
    row.recruitmentMessageDeleted,
  ], ["CANCEL_PENDING", false, false]);
});

for (const compensation of [false, true]) {
  test(`再起動後の実DBからID未保存resourceを再照合して${compensation ? "逆順補償" : "作成再開"}できる`, async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    const api = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: database.actions })),
    );
    const prepared = await api.prepareCustomGameEvent(preparation);
    assert(prepared.success);
    if (compensation) {
      assert(
        (await api.markCustomGameEventCreationFailed(prepared.event.id, {
          ...scope,
          discordEventDeleted: false,
          recruitmentMessageDeleted: false,
          failureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
        })).success,
      );
    }
    const findArgs = {
      operationKey: input.operationKey,
      createdAfter: prepared.event.createdAt,
    };
    using discord = strictDiscordEffects(
      compensation
        ? [
          {
            method: "findRecruitmentMessage",
            args: findArgs,
            value: { id: "recovered-message" },
          },
          { method: "deleteRecruitmentMessage", args: "recovered-message" },
          {
            method: "findScheduledEvent",
            args: findArgs,
            value: { id: "recovered-event" },
          },
          { method: "deleteScheduledEvent", args: "recovered-event" },
        ]
        : [
          {
            method: "findScheduledEvent",
            args: findArgs,
            value: { id: "recovered-event" },
          },
          {
            method: "findRecruitmentMessage",
            args: findArgs,
            value: { id: "recovered-message" },
          },
          { method: "addRecruitmentReactions", args: "recovered-message" },
        ],
    );

    // Act
    const result = await createCustomGameEventSaga(api).create(
      input,
      discord.effects,
    );

    // Assert
    assertEquals(result.success, !compensation);
    const [row] = await database.db.select().from(customGameEvents);
    assertEquals([row.discordScheduledEventId, row.recruitmentMessageId], [
      "recovered-event",
      "recovered-message",
    ]);
    assertEquals([row.phase, row.syncState], [
      compensation ? "CANCELLED" : "RECRUITING",
      "CONSISTENT",
    ]);
  });
}

test("別Botの再照合が先にIDを所有したとき、遅れた作成は実DBの所有IDを残してloser IDだけ削除する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const app = createApp(
    createTestDependencies({ dbActions: database.actions }),
  );
  const firstSaga = createCustomGameEventSaga(createInProcessBotApiClient(app));
  const secondSaga = createCustomGameEventSaga(
    createInProcessBotApiClient(app),
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<{ id: string }>();
  using firstDiscord = strictDiscordEffects([
    {
      method: "createScheduledEvent",
      run: () => {
        entered.resolve();
        return release.promise;
      },
    },
    { method: "deleteScheduledEvent", args: "loser-event" },
  ]);
  using secondDiscord = strictDiscordEffects([
    { method: "findScheduledEvent", value: { id: "owner-event" } },
    { method: "findRecruitmentMessage", value: { id: "owner-message" } },
    { method: "addRecruitmentReactions", args: "owner-message" },
  ]);

  // Act
  const first = firstSaga.create(input, firstDiscord.effects);
  await entered.promise;
  const second = await secondSaga.create(input, secondDiscord.effects);
  release.resolve({ id: "loser-event" });
  const loser = await first;

  // Assert
  assert(second.success);
  assert(loser.success);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([
    row.discordScheduledEventId,
    row.recruitmentMessageId,
    row.phase,
  ], ["owner-event", "owner-message", "RECRUITING"]);
});

test("Discordメッセージ作成応答を失ったとき、実DBへ回収IDを保存してから逆順補償する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const api = createInProcessBotApiClient(
    createApp(createTestDependencies({ dbActions: database.actions })),
  );
  using discord = strictDiscordEffects([
    creation[0],
    {
      method: "createRecruitmentMessage",
      error: new TypeError("Discord response lost"),
    },
    { method: "findRecruitmentMessage", value: { id: "recovered-message" } },
    {
      method: "deleteRecruitmentMessage",
      args: "recovered-message",
      run: async () => {
        const [row] = await database.db.select().from(customGameEvents);
        assertEquals(row.recruitmentMessageId, "recovered-message");
        assertEquals(row.syncState, "CREATE_COMPENSATION_PENDING");
      },
    },
    { method: "deleteScheduledEvent", args: "discord-event-1" },
  ]);

  // Act
  const result = await createCustomGameEventSaga(api).create(
    input,
    discord.effects,
  );

  // Assert
  assert(!result.success);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([
    row.phase,
    row.discordEventDeleted,
    row.recruitmentMessageDeleted,
  ], ["CANCELLED", true, true]);
});

test("補償中のmessage削除が失敗してもevent削除を保存し、再起動後は未完了messageだけを削除する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const app = createApp(
    createTestDependencies({ dbActions: database.actions }),
  );
  using discord = strictDiscordEffects([
    ...creation.slice(0, 2),
    { method: "addRecruitmentReactions", error: new Error("reaction failed") },
    {
      method: "deleteRecruitmentMessage",
      args: "message-1",
      error: new Error("delete failed"),
    },
    { method: "deleteScheduledEvent", args: "discord-event-1" },
    { method: "deleteRecruitmentMessage", args: "message-1" },
  ]);

  // Act
  const first = await createCustomGameEventSaga(
    createInProcessBotApiClient(app),
  ).create(input, discord.effects);
  const [pending] = await database.db.select().from(customGameEvents);
  const resumed = await createCustomGameEventSaga(
    createInProcessBotApiClient(app),
  ).create(input, discord.effects);

  // Assert
  assert(!first.success);
  assertEquals(first.error.recoveryFailures.map((failure) => failure.step), [
    "DELETE_RECRUITMENT_MESSAGE_COMPENSATION",
  ]);
  assertEquals([
    pending.syncState,
    pending.discordEventDeleted,
    pending.recruitmentMessageDeleted,
  ], ["CREATE_COMPENSATION_PENDING", true, false]);
  assert(!resumed.success);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([
    row.phase,
    row.discordEventDeleted,
    row.recruitmentMessageDeleted,
  ], ["CANCELLED", true, true]);
});

test("取消で回収message削除に失敗した後は、実DBの保存済みIDから検索せず再開する", async () => {
  // Arrange
  await using database = await createMigratedTestDatabase();
  const app = createApp(
    createTestDependencies({ dbActions: database.actions }),
  );
  const api = createInProcessBotApiClient(app);
  const prepared = await api.prepareCustomGameEvent(preparation);
  assert(prepared.success);
  assert(
    (await api.updateCustomGameEventCreationProgress(prepared.event.id, {
      ...scope,
      discordScheduledEventId: "discord-event-1",
    })).success,
  );
  using discord = strictDiscordEffects([
    { method: "deleteScheduledEvent", args: "discord-event-1" },
    { method: "findRecruitmentMessage", value: { id: "recovered-message" } },
    {
      method: "deleteRecruitmentMessage",
      args: "recovered-message",
      error: new Error("delete failed"),
    },
    { method: "deleteRecruitmentMessage", args: "recovered-message" },
  ]);

  // Act
  const first = await createCustomGameEventSaga(api).cancel({
    eventId: prepared.event.id,
    ...scope,
  }, discord.effects);
  const [pending] = await database.db.select().from(customGameEvents);
  const second = await createCustomGameEventSaga(
    createInProcessBotApiClient(app),
  ).cancel({ eventId: prepared.event.id, ...scope }, discord.effects);

  // Assert
  assert(!first.success);
  assert(second.success);
  assertEquals([
    pending.recruitmentMessageId,
    pending.discordEventDeleted,
    pending.recruitmentMessageDeleted,
  ], ["recovered-message", true, false]);
  const [row] = await database.db.select().from(customGameEvents);
  assertEquals([row.phase, row.syncState], ["CANCELLED", "CONSISTENT"]);
});
