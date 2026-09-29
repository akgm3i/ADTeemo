import { assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import type { Event, Lane } from "@adteemo/api/contract";
import { apiClient } from "../api_client.ts";
import {
  type FailureResult,
  markFailureKind,
} from "../api_clients/transport.ts";
import {
  recordMatchParticipantProvider,
  RecordMatchParticipantProviderError,
} from "../features/record_match_participants.ts";
import { statCollector } from "../features/stat_collector.ts";
import {
  recordMatchDiscord,
  type RecordMatchDiscordStep,
} from "../features/testing/record_match_discord.ts";
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

const keys = messageKeys.matchManagement.recordMatch;
const completeStats = participants.map((participant) => ({
  userId: participant.user.id,
  kills: 10,
  deaths: 2,
  assists: 8,
  cs: 200,
  gold: 12000,
}));
const inputSteps = (inputMs = 0): RecordMatchDiscordStep[] =>
  participants.map((participant) => ({
    action: "input",
    userId: participant.user.id,
    inputMs,
  }));
function interaction() {
  return new MockInteractionBuilder("record-match").withStringOption(
    "winner",
    "BLUE",
  ).withIntegerOption("game", 2).withIntegerOption("event", 42).build();
}
function provider() {
  return stub(
    recordMatchParticipantProvider,
    "getActiveParticipants",
    () => Promise.resolve({ event: activeEvent(), participants }),
  );
}
function stats() {
  return stub(
    statCollector,
    "collectStats",
    () => Promise.resolve({ status: "complete", stats: completeStats }),
  );
}
const success = {
  success: true as const,
  created: true,
  matchId: "custom:42:2",
  participantCount: 10 as const,
};

test("勝利チームと正整数の試合番号を受け付ける", () => {
  const json = data.toJSON();
  assertEquals(json.name, "record-match");
  assertEquals(json.options?.map((option) => option.name), [
    "winner",
    "game",
    "event",
  ]);
  assertEquals((json.options?.[1] as { min_value?: number }).min_value, 1);
});

test("確定ロスター10人を確認すると、所有scopeと同じevent/gameの1リクエストで保存する", async () => {
  // Arrange
  const input = interaction();
  using active = provider();
  using _stats = stats();
  using discord = recordMatchDiscord(input, [{ action: "confirm" }]);
  using save = stub(apiClient, "recordCustomMatch", () => {
    assertEquals(discord.acknowledgements, ["button-1"]);
    return Promise.resolve(success);
  });

  // Act
  await execute(input);

  // Assert
  assertSpyCall(active, 0, {
    args: [{
      guild: input.guild!,
      guildId: "mock-guild-id",
      recruitmentChannelId: "mock-channel-id",
      creatorId: "mock-user-id",
      eventId: 42,
    }],
  });
  assertSpyCall(save, 0, {
    args: [{
      eventId: 42,
      guildId: "mock-guild-id",
      recruitmentChannelId: "mock-channel-id",
      gameSequence: 2,
      winner: "BLUE",
      stats: completeStats,
    }],
  });
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(keys.success),
  );
  assertEquals(discord.edits.at(-1)?.token, "button-1");
});

test("各modal93秒で累積15分30秒でも、入力値と最新tokenを引き継いで確認・保存・成功通知まで完了する", async () => {
  // Arrange
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const input = interaction();
  using _active = provider();
  using discord = recordMatchDiscord(input, [...inputSteps(93_000), {
    action: "confirm",
  }], (ms) => time.tick(ms));
  using save = stub(
    apiClient,
    "recordCustomMatch",
    () => Promise.resolve(success),
  );

  // Act
  await execute(input);

  // Assert
  assertEquals(Date.now() - input.createdTimestamp, 930_000);
  assertSpyCalls(save, 1);
  assertEquals(save.calls[0].args[0].stats, completeStats);
  assertEquals(discord.edits.at(-1)?.token, "button-11");
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(keys.success),
  );
  assertEquals(
    discord.edits.filter((edit) => edit.token === "command").length,
    1,
  );
  assertEquals(discord.acknowledgements.length, 21);
});

for (const end of ["cancel", "expired", "failure"] as const) {
  test(`途中の${end}を区別し、確定保存せず入力済みsummaryを残す`, async () => {
    // Arrange
    using time = new FakeTime("2026-09-29T00:00:00Z");
    const input = interaction();
    using _active = provider();
    const ending: RecordMatchDiscordStep[] = end === "expired"
      ? [{ action: "timeout" }, { action: "timeout" }]
      : [{ action: end }];
    using discord = recordMatchDiscord(
      input,
      [inputSteps()[0], ...ending],
      (ms) => time.tick(ms),
    );
    using save = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.resolve(success),
    );

    // Act
    await execute(input);

    // Assert
    assertSpyCalls(save, 0);
    const last = discord.edits.at(-1)!;
    assertStringIncludes(
      JSON.stringify(last.body.embeds),
      "10/2/8 - 200cs - 12000g",
    );
    assertStringIncludes(
      last.body.content ?? "",
      messageHandler.formatMessage(
        end === "failure"
          ? keys.failureReason.input
          : end === "expired"
          ? keys.expired
          : keys.cancelled,
      ),
    );
    assertEquals(last.body.components, []);
  });
}

test("イベントAPIが失敗すると入力を始めずHTTP失敗理由を表示する", async () => {
  const input = interaction();
  using _active = stub(
    recordMatchParticipantProvider,
    "getActiveParticipants",
    () =>
      Promise.reject(
        new RecordMatchParticipantProviderError({
          success: false,
          error: "not found",
          code: "EVENT_NOT_FOUND",
          status: 404,
        }),
      ),
  );
  using collect = stats();
  using discord = recordMatchDiscord(input, []);
  await execute(input);
  assertSpyCalls(collect, 0);
  assertStringIncludes(
    discord.edits.at(-1)?.body.content ?? "",
    messageHandler.formatMessage(keys.failureReason.api),
  );
});

for (const failure of ["timeout", "failure"] as const) {
  test(`確認待ちが${failure}の場合は、保存せず理由を区別する`, async () => {
    using time = new FakeTime("2026-09-29T00:00:00Z");
    const input = interaction();
    using _active = provider();
    using _stats = stats();
    using discord = recordMatchDiscord(
      input,
      failure === "timeout"
        ? [{ action: "timeout" }, { action: "timeout" }]
        : [{ action: "failure" }],
      (ms) => time.tick(ms),
    );
    using save = stub(
      apiClient,
      "recordCustomMatch",
      () => Promise.resolve(success),
    );
    await execute(input);
    assertSpyCalls(save, 0);
    assertStringIncludes(
      discord.edits.at(-1)?.body.content ?? "",
      messageHandler.formatMessage(
        failure === "timeout" ? keys.expired : keys.failureReason.input,
      ),
    );
  });
}

test("保存拒否を表示して再送を待ち、取消しても保存成功とは表示しない", async () => {
  const input = interaction();
  using _active = provider();
  using _stats = stats();
  using discord = recordMatchDiscord(input, [{ action: "confirm" }, {
    action: "cancel",
  }]);
  using save = stub(
    apiClient,
    "recordCustomMatch",
    () =>
      Promise.resolve({
        success: false,
        error: "conflict",
        code: "CONFLICT",
        status: 409,
      }),
  );
  await execute(input);
  assertSpyCalls(save, 1);
  assertEquals(
    discord.edits.some((edit) =>
      edit.body.content?.includes(
        messageHandler.formatMessage(keys.failureReason.api),
      )
    ),
    true,
  );
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(keys.saveUnconfirmed),
  );
  assertEquals(
    discord.edits.some((edit) =>
      edit.body.content === messageHandler.formatMessage(keys.success)
    ),
    false,
  );
});

test("保存応答が120秒で通信失敗しても、明示再送では同じevent/gameと入力値を送り最新tokenで結果を表示する", async () => {
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const input = interaction();
  using _active = provider();
  using _stats = stats();
  using discord = recordMatchDiscord(input, [{ action: "confirm" }, {
    action: "confirm",
  }], (ms) => time.tick(ms));
  let attempts = 0;
  using save = stub(apiClient, "recordCustomMatch", () => {
    if (attempts++ === 0) {
      time.tick(120_000);
      return Promise.resolve(
        markFailureKind(
          { success: false as const, error: "timeout" },
          "communication",
        ),
      );
    }
    return Promise.resolve({ ...success, created: false });
  });
  await execute(input);
  assertSpyCalls(save, 2);
  assertEquals(save.calls[0].args, save.calls[1].args);
  assertEquals(discord.edits.at(-1)?.token, "button-2");
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(keys.success),
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

test("確認待ちの個別timeout後も、登録ボタンを明示確認するまで保存しない", async () => {
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const input = interaction();
  using _active = provider();
  using _stats = stats();
  using discord = recordMatchDiscord(input, [{ action: "timeout" }, {
    action: "confirm",
  }], (ms) => time.tick(ms));
  using save = stub(
    apiClient,
    "recordCustomMatch",
    () => Promise.resolve(success),
  );
  await execute(input);
  assertSpyCalls(save, 1);
  const paused = discord.edits.find((edit) =>
    edit.body.content === messageHandler.formatMessage(keys.confirmationPaused)
  );
  assertStringIncludes(
    JSON.stringify(paused?.body.components),
    messageHandler.formatMessage(keys.confirmButton),
  );
  assertEquals(
    discord.edits.at(-1)?.body.content,
    messageHandler.formatMessage(keys.success),
  );
});
