import { customGameEvents, matches, users } from "./schema.ts";
import { lanes } from "../contract/domain.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";

describe("カスタムゲームのギルド設定", () => {
  test("別guildの募集・VC・ロール設定を保存すると、互いの設定を上書きしない", async () => {
    await using database = await createMigratedTestDatabase();
    const settings = {
      recruitmentChannelId: "recruitment",
      lobbyChannelId: "lobby",
      redChannelId: "red",
      blueChannelId: "blue",
      roleIds: {
        Top: "top",
        Jungle: "jg",
        Middle: "mid",
        Bottom: "adc",
        Support: "sup",
      },
    };
    await database.actions.setCustomGameSettings("guild-a", settings);
    await database.actions.setCustomGameSettings("guild-b", {
      ...settings,
      redChannelId: "other-red",
    });
    assertEquals(
      (await database.actions.getCustomGameSettings("guild-a"))?.redChannelId,
      "red",
    );
    assertEquals(
      (await database.actions.getCustomGameSettings("guild-b"))?.redChannelId,
      "other-red",
    );
    assertEquals(
      await database.actions.getCustomGameSettings("guild-missing"),
      undefined,
    );
  });
});

test("参加者確定後に次ゲーム番号を取得すると、保存済み戦績の次番号を返し別guildを拒否する", async () => {
  await using database = await createMigratedTestDatabase();
  await database.actions.ensureGuild("guild");
  await database.db.insert(users).values({ discordId: "owner" });
  const [event] = await database.db.insert(customGameEvents).values({
    name: "custom",
    guildId: "guild",
    creatorId: "owner",
    recruitmentChannelId: "channel",
    scheduledStartAt: new Date(),
    phase: "RECRUITING",
    syncState: "CONSISTENT",
  }).returning();
  const scope = {
    eventId: event.id,
    guildId: "guild",
    recruitmentChannelId: "channel",
  };
  await database.actions.saveCustomGameEventParticipants({
    ...scope,
    participants: lanes.flatMap((
      lane,
      index,
    ) => [{ userId: `red-${index}`, team: "RED" as const, lane }, {
      userId: `blue-${index}`,
      team: "BLUE" as const,
      lane,
    }]),
  });
  assertEquals(await database.actions.getNextCustomGameSequence(scope), 1);
  await database.db.insert(matches).values({
    id: "custom-1",
    customGameEventId: event.id,
    gameSequence: 1,
  });
  assertEquals(await database.actions.getNextCustomGameSequence(scope), 2);
  assertEquals(await database.actions.getNextCustomGameSequence(scope), 2);
  await assertRejects(() =>
    database.actions.getNextCustomGameSequence({ ...scope, guildId: "other" })
  );
});
