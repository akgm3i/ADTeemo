import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Event, Lane } from "@adteemo/api/contract";
import type { ChatInputCommandInteraction, Message } from "discord.js";
import { apiClient } from "../api_client.ts";
import {
  type FailureResult,
  markFailureKind,
} from "../api_clients/transport.ts";
import {
  recordMatchParticipantProvider,
  RecordMatchParticipantProviderError,
} from "../features/record_match_participants.ts";
import {
  type StatCollectionResult,
  statCollector,
} from "../features/stat_collector.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { data, execute, recordMatchFailureReason } from "./record-match.ts";

const laneOrder: Lane[] = ["Top", "Jungle", "Middle", "Bottom", "Support"];

function activeEvent(): Event {
  return {
    id: 42,
    operationKey: "create-interaction-1",
    name: "custom",
    guildId: "mock-guild-id",
    creatorId: "mock-user-id",
    recruitmentChannelId: "mock-channel-id",
    voiceChannelId: "voice-1",
    discordScheduledEventId: "discord-event-1",
    recruitmentMessageId: "message-1",
    phase: "RECRUITING",
    syncState: "CONSISTENT",
    revision: 3,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    scheduledStartAt: new Date("2026-08-01T12:00:00+09:00"),
    createdAt: new Date("2026-08-01T09:00:00+09:00"),
    updatedAt: null,
  };
}

const participants = ["BLUE", "RED"].flatMap((team) =>
  laneOrder.map((lane, index) => ({
    user: {
      id: `${team.toLowerCase()}-${index + 1}`,
      username: `${team}-${lane}`,
    },
    lane,
    team: team as "BLUE" | "RED",
  }))
);

function successfulStatStub() {
  let call = 0;
  return stub(
    statCollector,
    "askForStat",
    <T extends string | number>(): Promise<StatCollectionResult<T>> => {
      const position = call++ % 3;
      const value = position === 0 ? "10/2/8" : position === 1 ? 200 : 12000;
      return Promise.resolve({ status: "value", value: value as T });
    },
  );
}

function confirmationMessage(customId = "confirm_record_match") {
  return {
    awaitMessageComponent: () => Promise.resolve({ customId, update: spy() }),
  } as unknown as Message;
}

describe("/record-match command", () => {
  test("勝利チームと正整数の試合番号を受け付ける", () => {
    const json = data.toJSON();

    assertEquals(json.name, "record-match");
    assertEquals(
      json.options?.map((option) => option.name),
      ["winner", "game", "event"],
    );
    assertEquals(json.options?.[1]?.required, false);
    assertEquals(
      (json.options?.[1] as { min_value?: number })?.min_value,
      1,
    );
  });

  test("確定ロスター10人の戦績をイベントと試合番号の1リクエストで登録する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .withIntegerOption("game", 2)
      .build();
    const reply = confirmationMessage();
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = successfulStatStub();
    using recordStub = stub(
      apiClient,
      "recordCustomMatch",
      () =>
        Promise.resolve({
          success: true as const,
          created: true,
          matchId: "custom:42:2",
          participantCount: 10,
        }),
    );
    using _deferStub = stub(
      interaction,
      "deferReply",
      () => Promise.resolve({} as never),
    );
    using _editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve(reply),
    );
    using followUpSpy = spy(interaction, "followUp");

    await execute(interaction as ChatInputCommandInteraction);

    assertSpyCalls(recordStub, 1);
    const payload = recordStub.calls[0].args[0];
    assertEquals(payload.eventId, 42);
    assertEquals(payload.guildId, "mock-guild-id");
    assertEquals(payload.recruitmentChannelId, "mock-channel-id");
    assertEquals(payload.gameSequence, 2);
    assertEquals(payload.winner, "BLUE");
    assertEquals(payload.stats.length, 10);
    assertEquals(payload.stats[0], {
      userId: "blue-1",
      kills: 10,
      deaths: 2,
      assists: 8,
      cs: 200,
      gold: 12000,
    });
    assertSpyCall(followUpSpy, 0);
    assertStringIncludes(
      String((followUpSpy.calls[0].args[0] as { content: string }).content),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.success,
      ),
    );
  });

  test("戦績入力が時間切れになった場合はAPIを呼ばず時間切れを表示する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .build();
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = stub(
      statCollector,
      "askForStat",
      <T extends string | number>(): Promise<
        StatCollectionResult<T>
      > => Promise.resolve({ status: "timeout" }),
    );
    using recordSpy = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.reject(new Error("must not be called")),
    );
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCalls(recordSpy, 0);
    assertEquals(
      editSpy.calls.at(-1)?.args[0],
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.timeout,
      ),
    );
  });

  test("戦績入力をキャンセルした場合はAPIを呼ばずキャンセルを表示する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "RED")
      .build();
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = stub(
      statCollector,
      "askForStat",
      <T extends string | number>(): Promise<
        StatCollectionResult<T>
      > => Promise.resolve({ status: "cancelled" }),
    );
    using recordSpy = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.reject(new Error("must not be called")),
    );
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCalls(recordSpy, 0);
    assertEquals(
      editSpy.calls.at(-1)?.args[0],
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.cancelled,
      ),
    );
  });

  test("Discord collectorが失敗した場合は時間切れ扱いにせず入力失敗理由を表示する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "RED")
      .build();
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = stub(
      statCollector,
      "askForStat",
      <T extends string | number>(): Promise<
        StatCollectionResult<T>
      > =>
        Promise.resolve({
          status: "failure",
          error: new Error("collector failed"),
        }),
    );
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    const lastReply = String(editSpy.calls.at(-1)?.args[0]);
    assertStringIncludes(
      lastReply,
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.input,
      ),
    );
  });

  test("イベントまたはロスターAPIが失敗した場合はHTTP失敗理由を表示して入力を始めない", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .build();
    Object.defineProperty(interaction, "deferred", { value: true });
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () =>
        Promise.reject(
          new RecordMatchParticipantProviderError({
            success: false,
            error: "event not found",
            code: "EVENT_NOT_FOUND",
            status: 404,
          }),
        ),
    );
    using statsSpy = stub(
      statCollector,
      "askForStat",
      () => Promise.reject(new Error("must not be called")),
    );
    using editSpy = spy(interaction, "editReply");

    await execute(interaction);

    assertSpyCalls(statsSpy, 0);
    const content = String(
      (editSpy.calls.at(-1)?.args[0] as { content?: string })?.content,
    );
    assertStringIncludes(
      content,
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.api,
      ),
    );
  });

  test("確認操作が時間切れになった場合はAPIを呼ばない", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .build();
    const reply = {
      awaitMessageComponent: () =>
        Promise.reject({
          code: "InteractionCollectorError",
          message:
            "Collector received no interactions before ending with reason: time",
        }),
    } as unknown as Message;
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = successfulStatStub();
    using recordSpy = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.reject(new Error("must not be called")),
    );
    using editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve(reply),
    );

    await execute(interaction);

    assertSpyCalls(recordSpy, 0);
    assertStringIncludes(
      String(
        (editStub.calls.at(-1)?.args[0] as { content?: string })?.content,
      ),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.timeout,
      ),
    );
  });

  test("確認待ちのDiscord APIが失敗した場合は時間切れではなく入力失敗を表示する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .build();
    const reply = {
      awaitMessageComponent: () =>
        Promise.reject(new Error("Discord connection failed")),
    } as unknown as Message;
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = successfulStatStub();
    using recordSpy = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.reject(new Error("must not be called")),
    );
    using editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve(reply),
    );

    await execute(interaction);

    assertSpyCalls(recordSpy, 0);
    const lastReply = editStub.calls.at(-1)?.args[0] as {
      content?: string;
    };
    assertStringIncludes(
      String(lastReply.content),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.input,
      ),
    );
    assertEquals(
      String(lastReply.content).includes(
        messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.timeout,
        ),
      ),
      false,
    );
  });

  test("APIが保存を拒否した場合は成功表示を出さず失敗理由を表示する", async () => {
    const interaction = new MockInteractionBuilder("record-match")
      .withStringOption("winner", "BLUE")
      .build();
    const reply = confirmationMessage();
    using _providerStub = stub(
      recordMatchParticipantProvider,
      "getActiveParticipants",
      () => Promise.resolve({ event: activeEvent(), participants }),
    );
    using _statsStub = successfulStatStub();
    using _recordStub = stub(
      apiClient,
      "recordCustomMatch",
      () =>
        Promise.resolve({
          success: false as const,
          error: "conflict",
          code: "CONFLICT" as const,
          status: 409 as const,
        }),
    );
    using _editStub = stub(
      interaction,
      "editReply",
      () => Promise.resolve(reply),
    );
    using followUpSpy = spy(interaction, "followUp");

    await execute(interaction);

    const content = String(
      (followUpSpy.calls[0].args[0] as { content: string }).content,
    );
    assertStringIncludes(
      content,
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.api,
      ),
    );
    assertEquals(
      content.includes(
        messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.success,
        ),
      ),
      false,
    );
  });

  test("HTTP・通信・契約違反を別々の利用者向け理由へ変換する", () => {
    const httpFailure = {
      success: false,
      error: "conflict",
      code: "CONFLICT",
      status: 409,
    } as FailureResult;
    const communicationFailure = markFailureKind(
      { success: false, error: "network" },
      "communication",
    );
    const contractFailure = markFailureKind(
      { success: false, error: "contract" },
      "contract",
    );
    const databaseFailure = {
      success: false,
      error: "internal error",
      code: "INTERNAL_ERROR",
      status: 500,
    } as FailureResult;

    assertEquals(
      recordMatchFailureReason(httpFailure),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.api,
      ),
    );
    assertEquals(
      recordMatchFailureReason(databaseFailure),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.database,
      ),
    );
    assertEquals(
      recordMatchFailureReason(communicationFailure),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.communication,
      ),
    );
    assertEquals(
      recordMatchFailureReason(contractFailure),
      messageHandler.formatMessage(
        messageKeys.matchManagement.recordMatch.failureReason.contract,
      ),
    );
  });
});
