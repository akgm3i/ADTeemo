import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createApiClient } from "../api_client.ts";

import { createRpcClientStub, response } from "./test_utils.ts";

describe("events", () => {
  const serializedEvent = {
    id: 1,
    operationKey: "operation-1",
    name: "週末カスタム",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    discordScheduledEventId: "discord-event-1",
    recruitmentMessageId: "message-1",
    phase: "RECRUITING",
    syncState: "CONSISTENT",
    revision: 3,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    scheduledStartAt: "2026-07-04T12:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
  };

  test("初回確定が競合すると、更新PUTへfallbackせず専用POSTの409を返す", async () => {
    const input = {
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
      participants: [],
    };
    using rpc = createRpcClientStub([{
      contract: responseContracts.confirmParticipants,
      args: [{ param: { eventId: "42" }, json: input }],
      result: response({ code: "CONFLICT", message: "Conflict" }, 409),
    }]);
    const result = await createApiClient({ rpcClient: rpc.rpcClient })
      .confirmCustomGameEventParticipants(42, input);
    assertEquals(result.success, false);
    if (!result.success) assertEquals(result.code, "CONFLICT");
  });

  test("APIがイベント一覧の日付フィールドを文字列で返すとき、イベント一覧を取得するとDateへ変換して返す", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.eventsByCreator,
        result: response({ events: [serializedEvent] }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.getCustomGameEventsByCreator(
      "guild-1",
      "channel-1",
      "creator-1",
    );

    // Assert
    assertEquals(result.success, true);
    if (!result.success) return;
    assertEquals(
      result.events[0].scheduledStartAt,
      new Date("2026-07-04T12:00:00.000Z"),
    );
    assertEquals(
      result.events[0].createdAt,
      new Date("2026-07-01T00:00:00.000Z"),
    );
    assertEquals(
      result.events[0].updatedAt,
      new Date("2026-07-01T01:00:00.000Z"),
    );
    assertEquals(rpc.calls[0], {
      method: "$get",
      path: "/events/by-creator/:guildId/:channelId/:creatorId",
      args: [{
        param: {
          guildId: "guild-1",
          channelId: "channel-1",
          creatorId: "creator-1",
        },
      }],
    });
  });

  test("APIが今日開始イベントの日付フィールドを文字列で返すとき、イベントを取得するとDateへ変換して返す", async () => {
    // Arrange
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.eventToday,
        result: response({ event: serializedEvent }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });

    // Act
    const result = await client.getEventStartingTodayByCreator(
      "guild-1",
      "channel-1",
      "creator-1",
    );

    // Assert
    assertEquals(result.success, true);
    if (!result.success) return;
    assertEquals(
      result.event.scheduledStartAt,
      new Date("2026-07-04T12:00:00.000Z"),
    );
    assertEquals(
      result.event.createdAt,
      new Date("2026-07-01T00:00:00.000Z"),
    );
    assertEquals(
      rpc.calls[0].path,
      "/events/today/:guildId/:channelId/by-creator/:creatorId",
    );
    assertEquals(rpc.calls[0].args, [{
      param: {
        guildId: "guild-1",
        channelId: "channel-1",
        creatorId: "creator-1",
      },
    }]);
  });

  test("イベント作成・中止sagaを進めると、scopeと進捗を対応するRPCへ渡す", async () => {
    // Arrange
    const participantInputs = Array.from({ length: 10 }, (_, index) => ({
      userId: `user-${index + 1}`,
      team: index < 5 ? "BLUE" as const : "RED" as const,
      lane: (["Top", "Jungle", "Middle", "Bottom", "Support"] as const)[
        index % 5
      ],
    }));
    const participantResponses = participantInputs.map((participant) => ({
      eventId: 1,
      ...participant,
      createdAt: "2026-07-01T02:00:00.000Z",
    }));
    using rpc = createRpcClientStub([
      {
        contract: responseContracts.prepareEvent,
        result: response({ created: true, event: serializedEvent }, 201),
      },
      {
        contract: responseContracts.eventCreation,
        result: response({ event: serializedEvent }),
      },
      {
        contract: responseContracts.activateEvent,
        result: response({ event: serializedEvent }),
      },
      {
        contract: responseContracts.eventCreationFailure,
        result: response({ event: serializedEvent }),
      },
      {
        contract: responseContracts.cancelEvent,
        result: response({ event: serializedEvent }),
      },
      {
        contract: responseContracts.eventCancellation,
        result: response({ event: serializedEvent }),
      },
      {
        contract: responseContracts.saveParticipants,
        result: response({ participants: participantResponses }),
      },
      {
        contract: responseContracts.getParticipants,
        result: response({ participants: participantResponses }),
      },
    ]);
    const client = createApiClient({ rpcClient: rpc.rpcClient });
    const scope = {
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };
    const prepareInput = {
      ...scope,
      operationKey: "operation-1",
      name: "週末カスタム",
      creatorId: "creator-1",
      voiceChannelId: "voice-1",
      scheduledStartAt: new Date("2026-07-04T12:00:00.000Z"),
    };

    // Act
    const results = [
      await client.prepareCustomGameEvent(prepareInput),
      await client.updateCustomGameEventCreationProgress(1, {
        ...scope,
        discordScheduledEventId: "discord-event-1",
      }),
      await client.activateCustomGameEvent(1, scope),
      await client.markCustomGameEventCreationFailed(1, {
        ...scope,
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        discordEventDeleted: true,
        recruitmentMessageDeleted: true,
        failureCode: "DISCORD_CREATE_FAILED",
      }),
      await client.beginCustomGameEventCancellation(1, scope),
      await client.updateCustomGameEventCancellationProgress(1, {
        ...scope,
        discordEventDeleted: true,
      }),
      await client.saveCustomGameEventParticipants(1, {
        ...scope,
        participants: participantInputs,
      }),
      await client.getCustomGameEventParticipants(1, scope),
    ];

    // Assert
    assertEquals(results.every((result) => result.success), true);
    assertEquals(rpc.calls.map(({ method, path }) => ({ method, path })), [
      { method: "$post", path: "/events" },
      { method: "$patch", path: "/events/:eventId/creation" },
      { method: "$post", path: "/events/:eventId/activate" },
      { method: "$post", path: "/events/:eventId/creation-failure" },
      { method: "$post", path: "/events/:eventId/cancel" },
      { method: "$patch", path: "/events/:eventId/cancel" },
      { method: "$put", path: "/events/:eventId/participants" },
      { method: "$get", path: "/events/:eventId/participants" },
    ]);
    assertEquals(rpc.calls[0].args, [{ json: prepareInput }]);
    assertEquals(rpc.calls[7].args, [{
      param: { eventId: "1" },
      query: scope,
    }]);
    const lastResult = results.at(-1);
    assertEquals(lastResult?.success, true);
    if (lastResult?.success && "participants" in lastResult) {
      assertEquals(
        lastResult.participants[0].createdAt,
        new Date("2026-07-01T02:00:00.000Z"),
      );
    }
  });
});
