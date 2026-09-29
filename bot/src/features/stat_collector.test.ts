import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { test } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import type { ButtonInteraction, Message } from "discord.js";
import { messageHandler, messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import {
  createStatSession,
  parseStatDraft,
  statCollector,
} from "./stat_collector.ts";
import { recordMatchDiscord } from "./testing/record_match_discord.ts";
import { strictFake } from "./testing/strict_fake.ts";

const participants = ["p1", "p2"].map((id) => ({
  user: { id, username: id },
  lane: "Top",
}));
function createSession() {
  const interaction = new MockInteractionBuilder("record-match").build();
  return {
    interaction,
    session: createStatSession(interaction, {
      eventId: 42,
      gameSequence: 2,
      winner: "BLUE",
    }),
  };
}

test("KDA・CS・Goldをまとめて検証し、0を保持して不正形式や安全でない整数を拒否する", () => {
  assertEquals(parseStatDraft({ kda: "0/2/8", cs: "0", gold: "12000" }), {
    kills: 0,
    deaths: 2,
    assists: 8,
    cs: 0,
    gold: 12000,
  });
  for (
    const draft of [
      { kda: "1/2", cs: "1", gold: "1" },
      { kda: "-1/2/3", cs: "1", gold: "1" },
      { kda: "1/2/3", cs: "1.2", gold: "1" },
      { kda: "1/2/3", cs: "1", gold: "-1" },
      { kda: "1/2/3", cs: "9007199254740992", gold: "1" },
    ]
  ) assertEquals(parseStatDraft(draft), null);
});

test("不正な入力を修正すると、前の参加者の値と現在の入力欄を引き継ぐ", async () => {
  // Arrange
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const { interaction, session } = createSession();
  using discord = recordMatchDiscord(interaction, [
    { action: "input", userId: "p1" },
    {
      action: "input",
      userId: "p2",
      draft: { kda: "bad", cs: "0", gold: "123" },
    },
    {
      action: "input",
      userId: "p2",
      draft: { kda: "1/2/3", cs: "0", gold: "123" },
    },
  ], (ms) => time.tick(ms));

  // Act
  const result = await statCollector.collectStats(session, participants);

  // Assert
  assertEquals(result.status, "complete");
  if (result.status !== "complete") return;
  assertEquals(result.stats.map((stat) => [stat.userId, stat.cs]), [
    ["p1", 200],
    ["p2", 0],
  ]);
  assertNotEquals(discord.modals[1].custom_id, discord.modals[2].custom_id);
  assertStringIncludes(JSON.stringify(discord.modals[2]), '"value":"bad"');
  assertStringIncludes(JSON.stringify(discord.modals[2]), '"value":"0"');
  assertEquals(
    discord.edits.some((edit) =>
      edit.body.content ===
        messageHandler.formatMessage(
          messageKeys.matchManagement.recordMatch.invalidStats,
        )
    ),
    true,
  );
});

for (const modalTimeout of [false, true]) {
  test(`${modalTimeout ? "modal" : "入力ボタン"}の個別timeout後に再開すると、入力済みの参加者を再入力せず継続する`, async () => {
    // Arrange
    using time = new FakeTime("2026-09-29T00:00:00Z");
    const { interaction, session } = createSession();
    using discord = recordMatchDiscord(interaction, [
      { action: "input", userId: "p1" },
      modalTimeout
        ? { action: "input", userId: "p2", modalTimeout: true }
        : { action: "timeout" },
      { action: "input", userId: "p2" },
    ], (ms) => time.tick(ms));

    // Act
    const result = await statCollector.collectStats(session, participants);

    // Assert
    assertEquals(result.status, "complete");
    assertEquals(session.summary.data.fields?.length, 2);
    assertEquals(
      discord.edits.some((edit) =>
        edit.body.content ===
          messageHandler.formatMessage(
            messageKeys.matchManagement.recordMatch.paused,
          )
      ),
      true,
    );
  });
}

for (const ending of ["cancelled", "expired", "failure"] as const) {
  test(`途中で${ending}になると、理由を区別して入力済みsummaryを保持する`, async () => {
    // Arrange
    using time = new FakeTime("2026-09-29T00:00:00Z");
    const { interaction, session } = createSession();
    using _discord = recordMatchDiscord(interaction, [
      { action: "input", userId: "p1" },
      ...(ending === "expired"
        ? [{ action: "timeout" as const }, { action: "timeout" as const }]
        : [{
          action: ending === "cancelled"
            ? "cancel" as const
            : "failure" as const,
        }]),
    ], (ms) => time.tick(ms));

    // Act
    const result = await statCollector.collectStats(session, participants);

    // Assert
    assertEquals(result.status, ending);
    assertEquals(session.summary.data.fields, [{
      name: "p1 (Top)",
      value: "10/2/8 - 200cs - 12000g",
    }]);
  });
}

test("セッション開始から60分経過した場合、新たな入力を待たず期限切れにする", async () => {
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const { interaction, session } = createSession();
  using _discord = recordMatchDiscord(interaction, [], (ms) => time.tick(ms));
  time.tick(60 * 60_000);
  assertEquals(await statCollector.collectStats(session, participants), {
    status: "expired",
  });
});

test("画面の更新中にセッション期限を越えた場合、新たなボタン入力を待たない", async () => {
  // Arrange
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const { session } = createSession();
  time.tick(59 * 60_000);
  using wait = strictFake<[], Promise<never>>("awaitMessageComponent", []);
  await session.accept({
    createdTimestamp: Date.now(),
    deferUpdate: () => Promise.resolve(),
    editReply: () => {
      time.tick(61_000);
      return Promise.resolve({
        awaitMessageComponent: wait.invoke,
      } as unknown as Message);
    },
  } as unknown as ButtonInteraction);

  // Act
  const result = await session.waitForButton(
    "入力",
    "input_record_match",
    "入力",
  );

  // Assert
  assertEquals(result, { status: "expired" });
});

test("同じユーザーが別eventの入力を並行しても、messageとmodal IDで値を分離する", async () => {
  // Arrange
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const first = new MockInteractionBuilder("record-match").withId("session-one")
    .build();
  const second = new MockInteractionBuilder("record-match").withId(
    "session-two",
  ).build();
  const firstSession = createStatSession(first, {
    eventId: 42,
    gameSequence: 1,
    winner: "BLUE",
  });
  const secondSession = createStatSession(second, {
    eventId: 43,
    gameSequence: 2,
    winner: "RED",
  });
  using _firstDiscord = recordMatchDiscord(first, [{
    action: "input",
    userId: "p1",
    draft: { kda: "1/2/3", cs: "100", gold: "10000" },
  }], (ms) => time.tick(ms));
  using _secondDiscord = recordMatchDiscord(second, [{
    action: "input",
    userId: "p1",
    draft: { kda: "5/6/7", cs: "200", gold: "20000" },
  }], (ms) => time.tick(ms));

  // Act
  const results = await Promise.all([
    statCollector.collectStats(firstSession, participants.slice(0, 1)),
    statCollector.collectStats(secondSession, participants.slice(0, 1)),
  ]);

  // Assert
  assertEquals(results, [
    {
      status: "complete",
      stats: [{
        userId: "p1",
        kills: 1,
        deaths: 2,
        assists: 3,
        cs: 100,
        gold: 10000,
      }],
    },
    {
      status: "complete",
      stats: [{
        userId: "p1",
        kills: 5,
        deaths: 6,
        assists: 7,
        cs: 200,
        gold: 20000,
      }],
    },
  ]);
});

test("不正入力を続けてfresh tokenを得ても、開始から60分で終了して最新のdraftを残す", async () => {
  // Arrange
  using time = new FakeTime("2026-09-29T00:00:00Z");
  const { interaction, session } = createSession();
  using _discord = recordMatchDiscord(
    interaction,
    Array.from({ length: 30 }, (_, index) => ({
      action: "input" as const,
      userId: "p1",
      waitMs: 60_000,
      inputMs: 60_000,
      modalTimeout: index === 29,
      draft: { kda: "invalid", cs: "42", gold: "12345" },
    })),
    (ms) => time.tick(ms),
  );

  // Act
  const result = await statCollector.collectStats(session, participants);

  // Assert
  assertEquals(result, { status: "expired" });
  assertEquals(Date.now() - interaction.createdTimestamp, 60 * 60_000);
  assertEquals(session.summary.data.fields, [{
    name: "p1 (Top)",
    value: "invalid - 42cs - 12345g",
  }]);
});
