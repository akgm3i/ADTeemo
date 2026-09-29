import type { Event } from "@adteemo/api/contract";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { test } from "@std/testing/bdd";
import {
  type CreateCustomGameDiscordEffects,
  createCustomGameEventSaga,
  type CustomGameEventSagaApi,
  isDiscordResourceAlreadyDeleted,
} from "./custom_game_event_saga.ts";
import { strictFake } from "./testing/strict_fake.ts";

type Boundary = CustomGameEventSagaApi & CreateCustomGameDiscordEffects;
type Step = {
  [K in keyof Boundary]:
    & {
      method: K;
      args: Parameters<Boundary[K]>;
    }
    & ({ result: Awaited<ReturnType<Boundary[K]>>; error?: never } | {
      result?: never;
      error: Error;
    });
}[keyof Boundary];

/** Declare direct boundary outputs; do not derive Backend state from requests. */
function scripted(steps: Step[]) {
  const script = strictFake<[string, unknown[]], Step>(
    "Saga boundary",
    steps.map((step) => ({
      args: [step.method, step.args],
      value: step,
    })),
  );
  const boundary = new Proxy({}, {
    get(_target, name) {
      return (...args: unknown[]) => {
        const step = script.invoke(String(name), args);
        return step.error
          ? Promise.reject(step.error)
          : Promise.resolve(step.result);
      };
    },
  }) as Boundary;
  return {
    api: boundary,
    effects: boundary,
    [Symbol.dispose]: () => script[Symbol.dispose](),
  };
}

const scheduledStartAt = new Date("2026-08-08T12:00:00Z");
const input = {
  operationKey: "interaction-113",
  name: "週末カスタム",
  guildId: "guild-1",
  creatorId: "creator-1",
  recruitmentChannelId: "channel-1",
  voiceChannelId: "voice-1",
  scheduledStartAt,
  recruitmentMessageContent: "募集します",
};
const { recruitmentMessageContent: _content, ...prepareInput } = input;
const scope = {
  guildId: input.guildId,
  recruitmentChannelId: input.recruitmentChannelId,
};
const cancelInput = { eventId: 113, ...scope };
const event: Event = {
  id: 113,
  ...prepareInput,
  discordScheduledEventId: null,
  recruitmentMessageId: null,
  phase: "PREPARING",
  syncState: "CREATE_PENDING",
  revision: 0,
  discordEventDeleted: false,
  recruitmentMessageDeleted: false,
  lastFailureCode: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: null,
};
const eventWithDiscord: Event = {
  ...event,
  discordScheduledEventId: "discord-event-1",
  revision: 1,
};
const eventWithBoth: Event = {
  ...eventWithDiscord,
  recruitmentMessageId: "message-1",
  revision: 2,
};
const active: Event = {
  ...eventWithBoth,
  phase: "RECRUITING",
  syncState: "CONSISTENT",
  revision: 3,
};
const cancelling: Event = {
  ...active,
  syncState: "CANCEL_PENDING",
  revision: 4,
};
const eventDeleted: Event = {
  ...cancelling,
  discordEventDeleted: true,
  revision: 5,
};
const cancelled: Event = {
  ...eventDeleted,
  recruitmentMessageDeleted: true,
  phase: "CANCELLED",
  syncState: "CONSISTENT",
  revision: 6,
};
const conflict = {
  success: false as const,
  error: "conflict",
  code: "CONFLICT" as const,
  status: 409 as const,
};
const serverFailure = {
  success: false as const,
  error: "unavailable",
  code: "INTERNAL_ERROR" as const,
  status: 500 as const,
};
const ok = (value: Event) => ({ success: true as const, event: value });
const preparationStep: Step = {
  method: "prepareCustomGameEvent",
  args: [prepareInput],
  result: { ...ok(event), created: true },
};
const createEventStep: Step = {
  method: "createScheduledEvent",
  args: [{
    operationKey: input.operationKey,
    name: input.name,
    voiceChannelId: input.voiceChannelId,
    scheduledStartAt,
  }],
  result: { id: "discord-event-1" },
};
const saveEventStep: Step = {
  method: "updateCustomGameEventCreationProgress",
  args: [113, { ...scope, discordScheduledEventId: "discord-event-1" }],
  result: ok(eventWithDiscord),
};
const createMessageStep: Step = {
  method: "createRecruitmentMessage",
  args: [{
    content: input.recruitmentMessageContent,
    nonce: input.operationKey,
    createdAfter: event.createdAt,
  }],
  result: { id: "message-1" },
};
const saveMessageStep: Step = {
  method: "updateCustomGameEventCreationProgress",
  args: [113, { ...scope, recruitmentMessageId: "message-1" }],
  result: ok(eventWithBoth),
};
const reactions: Step = {
  method: "addRecruitmentReactions",
  args: ["message-1"],
  result: undefined,
};
const lookup = {
  operationKey: input.operationKey,
  createdAfter: event.createdAt,
};

for (const operation of ["create", "cancel"] as const) {
  test(`${operation}の最初のAPI保存が拒否されたとき、Discord副作用を開始しない`, async () => {
    // Arrange
    using h = scripted([
      operation === "create"
        ? {
          method: "prepareCustomGameEvent",
          args: [prepareInput],
          result: conflict,
        }
        : {
          method: "beginCustomGameEventCancellation",
          args: [113, scope],
          result: conflict,
        },
    ]);
    const saga = createCustomGameEventSaga(h.api);
    // Act
    const result = operation === "create"
      ? await saga.create(input, h.effects)
      : await saga.cancel(cancelInput, h.effects);
    // Assert
    assert(!result.success);
    assertEquals(
      result.error.primaryFailure.step,
      operation === "create" ? "PREPARE_EVENT" : "BEGIN_CANCELLATION",
    );
  });
}

test("作成成功時はAPI応答を尊重し、各Discord作成直後に同じeventとscopeへIDを保存する", async () => {
  // Arrange
  using h = scripted([
    preparationStep,
    createEventStep,
    saveEventStep,
    createMessageStep,
    saveMessageStep,
    reactions,
    {
      method: "activateCustomGameEvent",
      args: [113, scope],
      result: ok(active),
    },
  ]);
  // Act
  const result = await createCustomGameEventSaga(h.api).create(
    input,
    h.effects,
  );
  // Assert
  assertEquals(result, { success: true, event: active });
});

for (const failedResource of ["event", "message"] as const) {
  test(`${failedResource}のID保存が確定拒否されたとき、補償をclaimして所有済みresourceを逆順に削除する`, async () => {
    // Arrange
    const beforeFailure = failedResource === "event" ? event : eventWithDiscord;
    const known = failedResource === "event" ? eventWithDiscord : eventWithBoth;
    const failureCode = failedResource === "event"
      ? "CHECKPOINT_DISCORD_EVENT_FAILED"
      : "CHECKPOINT_RECRUITMENT_MESSAGE_FAILED";
    const ids = {
      discordScheduledEventId: "discord-event-1",
      ...(failedResource === "message"
        ? { recruitmentMessageId: "message-1" }
        : {}),
    };
    const claim = {
      ...scope,
      ...ids,
      discordEventDeleted: false,
      recruitmentMessageDeleted: false,
      failureCode,
    };
    const compensating: Event = {
      ...known,
      syncState: "CREATE_COMPENSATION_PENDING",
      lastFailureCode: failureCode,
    };
    using h = scripted([
      preparationStep,
      createEventStep,
      ...(failedResource === "message"
        ? [saveEventStep, createMessageStep]
        : []),
      {
        method: "updateCustomGameEventCreationProgress",
        args: [
          113,
          failedResource === "event"
            ? { ...scope, discordScheduledEventId: "discord-event-1" }
            : { ...scope, recruitmentMessageId: "message-1" },
        ],
        result: conflict,
      },
      {
        method: "markCustomGameEventCreationFailed",
        args: [113, claim],
        result: ok(compensating),
      },
      ...(failedResource === "event"
        ? [
          {
            method: "findRecruitmentMessage",
            args: [lookup],
            result: null,
          } satisfies Step,
        ]
        : [
          {
            method: "deleteRecruitmentMessage",
            args: ["message-1"],
            result: undefined,
          } satisfies Step,
        ]),
      {
        method: "deleteScheduledEvent",
        args: ["discord-event-1"],
        result: undefined,
      },
      {
        method: "markCustomGameEventCreationFailed",
        args: [113, {
          ...claim,
          discordEventDeleted: true,
          recruitmentMessageDeleted: true,
        }],
        result: ok({
          ...beforeFailure,
          phase: "CANCELLED",
          syncState: "CONSISTENT",
          discordEventDeleted: true,
          recruitmentMessageDeleted: true,
        }),
      },
    ]);
    // Act
    const result = await createCustomGameEventSaga(h.api).create(
      input,
      h.effects,
    );
    // Assert
    assert(!result.success);
    assertEquals(
      result.error.primaryFailure.step,
      failedResource === "event"
        ? "CHECKPOINT_DISCORD_EVENT"
        : "CHECKPOINT_RECRUITMENT_MESSAGE",
    );
  });
}

test("activateが5xxのまま再照合後も確定できないとき、補償削除を開始しない", async () => {
  // Arrange
  const pending: Step = {
    method: "prepareCustomGameEvent",
    args: [prepareInput],
    result: { ...ok(eventWithBoth), created: false },
  };
  const unavailable: Step = {
    method: "activateCustomGameEvent",
    args: [113, scope],
    result: serverFailure,
  };
  using h = scripted([
    pending,
    reactions,
    unavailable,
    unavailable,
    pending,
    reactions,
    unavailable,
    unavailable,
  ]);
  // Act
  const result = await createCustomGameEventSaga(h.api).create(
    input,
    h.effects,
  );
  // Assert
  assert(!result.success);
  assertEquals(result.error.primaryFailure.step, "ACTIVATE_EVENT");
});

for (const targetSaved of [false, true]) {
  test(`取消競合後のtarget保存${targetSaved ? "後に削除" : "自体"}が失敗したとき、未確認の削除進捗を保存しない`, async () => {
    // Arrange
    const pending: Event = { ...event, syncState: "CANCEL_PENDING" };
    const deleteFailure = new Error("Discord deletion failed");
    using h = scripted([
      preparationStep,
      createEventStep,
      {
        method: "updateCustomGameEventCreationProgress",
        args: [113, { ...scope, discordScheduledEventId: "discord-event-1" }],
        result: conflict,
      },
      {
        method: "markCustomGameEventCreationFailed",
        args: [113, {
          ...scope,
          discordScheduledEventId: "discord-event-1",
          discordEventDeleted: false,
          recruitmentMessageDeleted: false,
          failureCode: "CHECKPOINT_DISCORD_EVENT_FAILED",
        }],
        result: conflict,
      },
      {
        method: "prepareCustomGameEvent",
        args: [prepareInput],
        result: { ...ok(pending), created: false },
      },
      {
        method: "updateCustomGameEventCancellationProgress",
        args: [113, { ...scope, discordScheduledEventId: "discord-event-1" }],
        result: targetSaved
          ? ok({ ...pending, discordScheduledEventId: "discord-event-1" })
          : conflict,
      },
      ...(targetSaved
        ? [
          {
            method: "deleteScheduledEvent",
            args: ["discord-event-1"],
            error: deleteFailure,
          } satisfies Step,
        ]
        : []),
    ]);
    // Act
    const result = await createCustomGameEventSaga(h.api).create(
      input,
      h.effects,
    );
    // Assert
    assert(!result.success);
    assert(
      result.error.recoveryFailures.some((failure) =>
        failure.step ===
          (targetSaved
            ? "DELETE_DISCORD_EVENT_COMPENSATION"
            : "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET")
      ),
    );
  });
}

test("補償検索で回収したIDをAPIへ保存できないとき、そのresourceを削除しない", async () => {
  // Arrange
  const pending: Event = {
    ...event,
    syncState: "CREATE_COMPENSATION_PENDING",
    discordEventDeleted: true,
    lastFailureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
  };
  const claim = {
    ...scope,
    discordEventDeleted: true,
    recruitmentMessageDeleted: false,
    failureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
  };
  const recovered = { ...claim, recruitmentMessageId: "recovered-message" };
  using h = scripted([
    {
      method: "prepareCustomGameEvent",
      args: [prepareInput],
      result: { ...ok(pending), created: false },
    },
    {
      method: "markCustomGameEventCreationFailed",
      args: [113, claim],
      result: ok(pending),
    },
    {
      method: "findRecruitmentMessage",
      args: [lookup],
      result: { id: "recovered-message" },
    },
    {
      method: "markCustomGameEventCreationFailed",
      args: [113, recovered],
      result: conflict,
    },
    {
      method: "markCustomGameEventCreationFailed",
      args: [113, recovered],
      result: ok({ ...pending, recruitmentMessageId: "recovered-message" }),
    },
  ]);
  // Act
  const result = await createCustomGameEventSaga(h.api).create(
    input,
    h.effects,
  );
  // Assert
  assert(!result.success);
  assertEquals(result.error.recoveryFailures.map((failure) => failure.step), [
    "RECORD_CREATION_FAILURE",
  ]);
});

for (const alreadyDeleted of [false, true]) {
  test(`取消時にDiscord削除${alreadyDeleted ? "がUnknown Resourceを返した" : "が成功した"}直後、APIへ個別進捗を保存する`, async () => {
    // Arrange
    const deleteEvent: Step = {
      method: "deleteScheduledEvent",
      args: ["discord-event-1"],
      ...(alreadyDeleted
        ? { error: Object.assign(new Error("Unknown Event"), { code: 10070 }) }
        : { result: undefined }),
    };
    const deleteMessage: Step = {
      method: "deleteRecruitmentMessage",
      args: ["message-1"],
      ...(alreadyDeleted
        ? {
          error: Object.assign(new Error("Unknown Message"), { code: "10008" }),
        }
        : { result: undefined }),
    };
    using h = scripted([
      {
        method: "beginCustomGameEventCancellation",
        args: [113, scope],
        result: ok(cancelling),
      },
      deleteEvent,
      {
        method: "updateCustomGameEventCancellationProgress",
        args: [113, { ...scope, discordEventDeleted: true, failureCode: null }],
        result: ok(eventDeleted),
      },
      deleteMessage,
      {
        method: "updateCustomGameEventCancellationProgress",
        args: [113, {
          ...scope,
          recruitmentMessageDeleted: true,
          failureCode: null,
        }],
        result: ok(cancelled),
      },
    ]);
    // Act
    const result = await createCustomGameEventSaga(h.api).cancel(
      cancelInput,
      h.effects,
    );
    // Assert
    assertEquals(result, { success: true, event: cancelled });
  });
}

test("取消でevent削除に失敗したとき、失敗分類を保存してmessage削除を開始しない", async () => {
  // Arrange
  using h = scripted([
    {
      method: "beginCustomGameEventCancellation",
      args: [113, scope],
      result: ok(cancelling),
    },
    {
      method: "deleteScheduledEvent",
      args: ["discord-event-1"],
      error: new Error("Discord unavailable"),
    },
    {
      method: "updateCustomGameEventCancellationProgress",
      args: [113, { ...scope, failureCode: "DELETE_DISCORD_EVENT_FAILED" }],
      result: ok(cancelling),
    },
  ]);
  // Act
  const result = await createCustomGameEventSaga(h.api).cancel(
    cancelInput,
    h.effects,
  );
  // Assert
  assert(!result.success);
  assertEquals(result.error.primaryFailure.step, "DELETE_DISCORD_EVENT");
  assertEquals(isDiscordResourceAlreadyDeleted({ code: 50013 }), false);
});

test("Sagaが境界引数のassertをcatchしても、宣言応答のdisposeで検出する", async () => {
  // Arrange
  const h = scripted([{
    method: "prepareCustomGameEvent",
    args: [{ ...prepareInput, guildId: "expected-other-guild" }],
    result: conflict,
  }]);
  // Act
  await createCustomGameEventSaga(h.api).create(input, h.effects);
  // Assert
  assertThrows(() => h[Symbol.dispose](), Error, "unexpected boundary calls");
});

test("未宣言のSaga API呼び出しをcatchしても、disposeで検出する", async () => {
  // Arrange
  const h = scripted([]);
  // Act
  await createCustomGameEventSaga(h.api).create(input, h.effects);
  // Assert
  assertThrows(() => h[Symbol.dispose](), Error, "unexpected boundary calls");
});

test("宣言済みSaga応答を消費しなかったとき、disposeで検出する", () => {
  // Arrange
  const h = scripted([preparationStep]);
  // Act / Assert
  assertThrows(() => h[Symbol.dispose](), Error, "unconsumed responses");
});
