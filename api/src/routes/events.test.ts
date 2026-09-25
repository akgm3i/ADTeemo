import { assertEquals, assertFalse } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import { DomainConflictError, EventNotFoundError } from "../errors.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";

const FIXED_DATE = new Date("2026-08-01T10:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    operationKey: "interaction-1",
    name: "Test Event",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    discordScheduledEventId: null,
    recruitmentMessageId: null,
    phase: "PREPARING" as const,
    syncState: "CREATE_PENDING" as const,
    revision: 0,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    scheduledStartAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    updatedAt: null,
    ...overrides,
  };
}

function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: {
      ...TEST_BOT_SERVICE_AUTH_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

const preparePayload = {
  operationKey: "interaction-1",
  name: "Test Event",
  guildId: "guild-1",
  creatorId: "creator-1",
  recruitmentChannelId: "channel-1",
  voiceChannelId: "voice-1",
  scheduledStartAt: FIXED_DATE.toISOString(),
};

const scope = {
  guildId: "guild-1",
  recruitmentChannelId: "channel-1",
};

describe("routes/events.ts", () => {
  test("DB準備が成功したとき、外部副作用前のイベントを作成して201を返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using prepareStub = stub(
      deps.dbActions,
      "prepareCustomGameEvent",
      () => Promise.resolve({ created: true as const, event: event() }),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events",
      jsonRequest("POST", preparePayload),
    );
    const body = await response.json();

    // Assert
    assertEquals(response.status, 201);
    assertEquals(body.created, true);
    assertFalse("success" in body);
    assertSpyCall(prepareStub, 0, {
      args: [{ ...preparePayload, scheduledStartAt: FIXED_DATE }],
    });
  });

  test("同じoperation keyの準備が適用済みのとき、同じイベントを200で返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using _prepareStub = stub(
      deps.dbActions,
      "prepareCustomGameEvent",
      () => Promise.resolve({ created: false as const, event: event() }),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events",
      jsonRequest("POST", preparePayload),
    );

    // Assert
    assertEquals(response.status, 200);
    assertEquals((await response.json()).created, false);
  });

  test("Discord nonce上限を超えるoperation keyで準備すると、repositoryを呼ばず422を返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using prepareStub = stub(
      deps.dbActions,
      "prepareCustomGameEvent",
      () => Promise.resolve({ created: true as const, event: event() }),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events",
      jsonRequest("POST", {
        ...preparePayload,
        operationKey: "x".repeat(26),
      }),
    );

    // Assert
    assertEquals(response.status, 422);
    assertSpyCalls(prepareStub, 0);
  });

  test("イベント準備repositoryが例外を投げたとき、repository failureとして500を返す", async () => {
    // Arrange
    const failure = new Error("DB unavailable");
    const deps = createTestDependencies();
    using _prepareStub = stub(
      deps.dbActions,
      "prepareCustomGameEvent",
      () => Promise.reject(failure),
    );
    using errorStub = stub(deps.logger, "error", () => {});
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events",
      jsonRequest("POST", preparePayload),
    );

    // Assert
    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    assertEquals(errorStub.calls[0].args[1]?.errorCategory, "repository");
  });

  test("別guildまたはchannelのイベントIDで作成進捗を更新したとき、404を返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using _progressStub = stub(
      deps.dbActions,
      "updateCustomGameEventCreationProgress",
      () => Promise.reject(new EventNotFoundError("not found")),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/1/creation",
      jsonRequest("PATCH", {
        guildId: "guild-other",
        recruitmentChannelId: "channel-other",
        discordScheduledEventId: "discord-event-1",
      }),
    );

    // Assert
    assertEquals(response.status, 404);
    assertEquals((await response.json()).code, "EVENT_NOT_FOUND");
  });

  test("異なる外部IDで作成進捗を再送したとき、409を返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using _progressStub = stub(
      deps.dbActions,
      "updateCustomGameEventCreationProgress",
      () => Promise.reject(new DomainConflictError("conflict")),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/1/creation",
      jsonRequest("PATCH", {
        ...scope,
        discordScheduledEventId: "discord-event-other",
      }),
    );

    // Assert
    assertEquals(response.status, 409);
    assertEquals((await response.json()).code, "CONFLICT");
  });

  test("creatorのイベント一覧を取得するとき、guildと募集channelをrepositoryへ渡す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using listStub = stub(
      deps.dbActions,
      "getCustomGameEventsByCreator",
      () => Promise.resolve([event()]),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/by-creator/guild-1/channel-1/creator-1",
      { headers: TEST_BOT_SERVICE_AUTH_HEADERS },
    );

    // Assert
    assertEquals(response.status, 200);
    assertSpyCall(listStub, 0, {
      args: [{
        guildId: "guild-1",
        recruitmentChannelId: "channel-1",
        creatorId: "creator-1",
      }],
    });
  });

  test("cancelを開始するとき、DBへ意図を記録してからevent stateを返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    const cancelPending = event({
      phase: "RECRUITING" as const,
      syncState: "CANCEL_PENDING" as const,
    });
    using beginStub = stub(
      deps.dbActions,
      "beginCustomGameEventCancellation",
      () => Promise.resolve(cancelPending),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/1/cancel",
      jsonRequest("POST", scope),
    );

    // Assert
    assertEquals(response.status, 200);
    assertEquals((await response.json()).event.syncState, "CANCEL_PENDING");
    assertSpyCall(beginStub, 0, { args: [{ eventId: 1, ...scope }] });
  });

  test("回収したDiscord IDと削除進捗を送信すると、再試行可能なevent stateへ保存する", async () => {
    // Arrange
    const deps = createTestDependencies();
    using progressStub = stub(
      deps.dbActions,
      "updateCustomGameEventCancellationProgress",
      () =>
        Promise.resolve(event({
          phase: "RECRUITING" as const,
          syncState: "CANCEL_PENDING" as const,
          discordEventDeleted: true,
        })),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/1/cancel",
      jsonRequest("PATCH", {
        ...scope,
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        discordEventDeleted: true,
      }),
    );

    // Assert
    assertEquals(response.status, 200);
    assertSpyCall(progressStub, 0, {
      args: [{
        eventId: 1,
        ...scope,
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        discordEventDeleted: true,
      }],
    });
  });

  test("確定参加者が10人未満のとき、repositoryを呼ばず422を返す", async () => {
    // Arrange
    const deps = createTestDependencies();
    using saveStub = stub(
      deps.dbActions,
      "saveCustomGameEventParticipants",
      () => Promise.resolve([]),
    );
    const app = createApp(deps);

    // Act
    const response = await app.request(
      "/events/1/participants",
      jsonRequest("PUT", {
        ...scope,
        participants: [{ userId: "user-1", team: "BLUE", lane: "Top" }],
      }),
    );

    // Assert
    assertEquals(response.status, 422);
    assertSpyCalls(saveStub, 0);
  });
});
