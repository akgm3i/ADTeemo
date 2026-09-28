import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import type { RiotMatch } from "@adteemo/api/contract";
import { messageHandler, messageKeys } from "../messages.ts";
import {
  createMatchTrackingRenderer,
  type MatchTrackingStaticData,
} from "./match_tracking_renderer.ts";
import {
  account,
  activeGame,
  match,
  rankSnapshot,
  resolvedRiotStaticData,
  trackingNow,
  watcher,
} from "./testing/match_tracking_fixtures.ts";

function renderer(
  data: MatchTrackingStaticData | null = resolvedRiotStaticData().data,
) {
  return createMatchTrackingRenderer({
    messages: {
      formatMessage: messageHandler.formatMessage.bind(messageHandler),
      keys: messageKeys,
    },
    clock: { now: () => trackingNow },
    resolveStaticData: () => Promise.resolve(data),
  });
}
async function resultEmbedFields(resultMatch: RiotMatch) {
  resultMatch.info.queueId = 0;
  return (await renderer().matchResult(watcher(), account(), resultMatch))
    .toJSON().fields ?? [];
}

describe("試合結果rendererの表示回帰", () => {
  for (
    const [position, role] of [
      ["TOP", "Top"],
      ["JUNGLE", "Jungle"],
      ["MIDDLE", "Mid"],
      ["BOTTOM", "Bot"],
      ["UTILITY", "Support"],
      ["", "不明"],
    ]
  ) {
    test(`${role}の試合結果では、試合時間とロールを共通の位置に表示する`, async () => {
      const value = match();
      value.info.gameDuration = 1845;
      value.info.participants[0].teamPosition = position;
      value.info.participants[0].individualPosition = position;
      const fields = await resultEmbedFields(value);
      assertEquals(fields.slice(0, 7).map(({ name }) => name), [
        "試合情報",
        "チャンピオン",
        "ロール",
        "試合時間",
        "KDA",
        "キル関与率",
        "Gold",
      ]);
      assertEquals(
        fields.find(({ name }) => name === "試合時間")?.value,
        "30:45",
      );
      assertEquals(fields.find(({ name }) => name === "ロール")?.value, role);
    });
  }

  test("Topの試合結果では、CSと毎分値を1つのfieldにまとめる", async () => {
    const fields = await resultEmbedFields(match());
    assertEquals(
      fields.find(({ name }) => name === "ダメージ")?.value,
      "23456",
    );
    assertEquals(
      fields.find(({ name }) => name === "CS")?.value,
      "192 (6.4/min)",
    );
    assertEquals(fields.some(({ name }) => name === "CS/min"), false);
  });

  test("Supportの試合結果では、視界スコアと毎分値を1つのfieldにまとめる", async () => {
    const value = match();
    value.info.participants[0].teamPosition = "UTILITY";
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.find(({ name }) => name === "視界スコア")?.value,
      "20 (0.7/min)",
    );
    assertEquals(
      fields.some(({ name }) => name === "視界スコア/min" || name === "CS"),
      false,
    );
  });

  test("Jungleの試合結果では、CSとRiotから取得できた内訳をまとめ、中立のみの値を差分で捏造しない", async () => {
    const value = match();
    value.info.participants[0].teamPosition = "JUNGLE";
    value.info.participants[0].totalAllyJungleMinionsKilled = 3;
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.find(({ name }) => name === "CS")?.value,
      "192 (6.4/min)\nミニオン: 180\nJG等 合計: 12\n自陣JG: 3\n敵陣JG: 7",
    );
  });

  test("自陣・敵陣JGの取得値がない試合結果では、内訳を推定しない", async () => {
    const value = match();
    value.info.participants[0].teamPosition = "JUNGLE";
    value.info.participants[0].totalEnemyJungleMinionsKilled = undefined;
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.find(({ name }) => name === "CS")?.value,
      "192 (6.4/min)\nミニオン: 180\nJG等 合計: 12",
    );
  });

  test("ロール不明では、不明と表示してCSへfallbackする", async () => {
    const value = match();
    value.info.participants[0].teamPosition = undefined;
    value.info.participants[0].individualPosition = undefined;
    const fields = await resultEmbedFields(value);
    assertEquals(fields.find(({ name }) => name === "ロール")?.value, "不明");
    assertEquals(
      fields.find(({ name }) => name === "CS")?.value,
      "192 (6.4/min)",
    );
  });

  test("Supportのmetricが欠損した試合結果では、取得できないfieldを省略する", async () => {
    const value = match();
    value.info.participants[0].teamPosition = "UTILITY";
    value.info.participants[0].visionScore = undefined;
    value.info.participants[0].totalDamageDealtToChampions = undefined;
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.some(({ name }) =>
        ["ダメージ", "視界スコア", "CS"].includes(name)
      ),
      false,
    );
  });

  test("日本語の静的データを解決すると、チャンピオン・画像・キュー・マップ・モードを表示する", async () => {
    const json = (await renderer().matchResult(watcher(), account(), match()))
      .toJSON();
    const fields = Object.fromEntries(
      json.fields!.map((field) => [field.name, field.value]),
    );
    assertEquals(fields["チャンピオン"], "ティーモ");
    assertEquals(
      fields["試合情報"],
      "サモナーズリフト / クラシック / ランクソロ/デュオ",
    );
    assertEquals(
      json.thumbnail?.url,
      resolvedRiotStaticData().data.champions["17"].iconUrl,
    );
  });

  test("チャンピオン画像だけ欠損すると、名前を維持してthumbnailを省略する", async () => {
    const data = {
      ...resolvedRiotStaticData().data,
      champions: { "17": { name: "ティーモ", iconUrl: null } },
    };
    const json =
      (await renderer(data).matchResult(watcher(), account(), match()))
        .toJSON();
    assertEquals(json.thumbnail, undefined);
    assertEquals(
      json.fields?.find((field) => field.name === "チャンピオン")?.value,
      "ティーモ",
    );
  });

  test("静的データが欠損すると、Match-v5のチャンピオン名とモードへfallbackする", async () => {
    const json =
      (await renderer(null).matchResult(watcher(), account(), match()))
        .toJSON();
    assertEquals(
      json.fields?.find((field) => field.name === "チャンピオン")?.value,
      "Teemo",
    );
    assertEquals(
      json.fields?.find((field) => field.name === "試合情報")?.value,
      "マップ 11 / CLASSIC / キュー 420",
    );
  });

  test("試合時間とチームkillsがある場合、CS毎分とキル関与率を表示する", async () => {
    const value = match();
    value.info.participants.push({
      ...value.info.participants[0],
      puuid: "puuid-2",
      kills: 20,
    });
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.find((field) => field.name === "CS")?.value,
      "192 (6.4/min)",
    );
    assertEquals(
      fields.find((field) => field.name === "キル関与率")?.value,
      "60.0%",
    );
  });

  test("試合時間とチームkillsが0の場合、除算せずfallback記号を表示する", async () => {
    const value = match();
    value.info.gameDuration = 0;
    value.info.participants[0].kills = 0;
    value.info.participants[0].assists = 0;
    const fields = await resultEmbedFields(value);
    assertEquals(
      fields.find((field) => field.name === "CS")?.value,
      "192 (-/min)",
    );
    assertEquals(
      fields.find((field) => field.name === "キル関与率")?.value,
      "-",
    );
  });

  for (const apex of [false, true]) {
    test(`${apex ? "Apex Tier間" : "同division"}でLPが変化すると、保存済みsnapshotの差分を表示する`, async () => {
      const before = rankSnapshot(
        apex ? { tier: "MASTER", rank: "I", leaguePoints: 150 } : {},
      );
      const after = rankSnapshot({
        phase: "after",
        ...(apex
          ? { tier: "GRANDMASTER", rank: "I", leaguePoints: 172 }
          : { leaguePoints: 19 }),
      });
      const embed = await renderer().matchResult(
        watcher(),
        account(),
        match(),
        { queueType: "RANKED_SOLO_5x5", before, after },
      );
      assertEquals(
        embed.toJSON().fields?.find((field) => field.name === "ランク")?.value,
        apex
          ? "LP: +22\nMaster 150LP -> Grandmaster 172LP"
          : "LP: +17\nEmerald IV 2LP -> Emerald IV 19LP",
      );
    });
  }

  test("OP.GG詳細があるときだけ、詳細リンクとlane scoreと平均Tierを表示する", async () => {
    const without =
      (await renderer().matchResult(watcher(), account(), match())).toJSON();
    assertEquals(
      without.fields?.some((field) => field.name === "OP.GG"),
      false,
    );
    const embed = await renderer().matchResult(
      watcher(),
      account(),
      match(),
      null,
      {
        provider: "opgg",
        providerRegion: "jp",
        providerMatchId: "opgg-match-1",
        detailUrl:
          "https://op.gg/ja/lol/summoners/jp/Teemo-JP1/matches/opgg-match-1/1780000000000",
        providerCreatedAt: trackingNow,
        averageTier: "Emerald",
        participant: { puuid: "puuid-1", participantId: 3, laneScore: 7.2 },
      },
    );
    const field =
      embed.toJSON().fields?.find((field) => field.name === "OP.GG")?.value ??
        "";
    assertStringIncludes(field, "[試合詳細](https://op.gg/");
    assertStringIncludes(field, "レーン戦: 7.2");
    assertStringIncludes(field, "平均Tier: Emerald");
  });

  test("同じ進行中試合に複数監視対象がいると、対象ごとのチャンピオンを表示して単一accountのfooterを出さない", async () => {
    const json = (await renderer().activeGame(
      watcher(),
      account(),
      activeGame(),
      "started",
      [
        { targetDiscordId: "target-1", championId: 17 },
        { targetDiscordId: "target-2", championId: 18 },
      ],
    )).toJSON();
    assertStringIncludes(JSON.stringify(json), "ティーモ");
    assertStringIncludes(JSON.stringify(json), "トリスターナ");
    assertStringIncludes(json.description ?? "", "<@target-1>");
    assertStringIncludes(json.description ?? "", "<@target-2>");
    assertEquals(json.footer?.text.includes("Teemo#JP1"), false);
  });
});

test("Mayhemの情報がなければ取得不可だけを表示し、試合時間を取得できていれば表示する", async () => {
  const expected = {
    title: "ARAM: Mayhem",
    description: "試合結果を取得できません。",
  };
  assertEquals(
    (await renderer().resultUnavailable(watcher(), "JP1_12345", "mayhem"))
      .toJSON(),
    expected,
  );
  const value = match();
  value.info.gameMode = "KIWI";
  value.info.participants = [];
  assertEquals(
    (await renderer().matchResult(watcher(), account(), value)).toJSON(),
    {
      ...expected,
      fields: [{ name: "試合時間", value: "30:00", inline: true }],
    },
  );
});

for (const win of [true, false]) {
  test(`Mayhemの${win ? "勝利" : "敗北"}とKDAが取得できた場合、欠損した任意の戦績を補わず取得値を表示する`, async () => {
    const value = match();
    value.info.gameMode = "KIWI";
    value.info.queueId = 2400;
    value.info.mapId = 12;
    const participant = value.info.participants[0];
    participant.win = win;
    delete participant.totalDamageDealtToChampions;
    delete participant.visionScore;
    delete participant.totalEnemyJungleMinionsKilled;
    const embed = (await renderer().matchResult(watcher(), account(), value))
      .toJSON();
    assertEquals(
      embed.title,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.title,
        {
          result: messageHandler.formatMessage(
            win
              ? messageKeys.matchTracking.embed.result.win
              : messageKeys.matchTracking.embed.result.loss,
          ),
        },
      ),
    );
    assertEquals(
      embed.fields?.find(({ name }) => name === "KDA")?.value,
      "10/2/8",
    );
    assertEquals(embed.fields?.some(({ name }) => name === "ダメージ"), false);
  });
}

for (const win of [true, false, undefined]) {
  test(`Mayhemで勝敗が${String(win)}かつkillsだけ取得できた場合、未取得の戦績や敗北を捏造しない`, async () => {
    const value: RiotMatch = {
      ...match(),
      info: {
        ...match().info,
        gameMode: "KIWI",
        queueId: 2400,
        mapId: 12,
        participants: [{ puuid: "puuid-1", win, kills: 5 }],
      },
    };
    const embed = (await renderer().matchResult(watcher(), account(), value))
      .toJSON();
    if (win === undefined) {
      assertEquals(embed, {
        title: "ARAM: Mayhem",
        description: "試合結果を取得できません。",
        fields: [{ name: "試合時間", value: "30:00", inline: true }],
      });
      return;
    }
    assertEquals(
      embed.title,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.title,
        {
          result: messageHandler.formatMessage(
            win
              ? messageKeys.matchTracking.embed.result.win
              : messageKeys.matchTracking.embed.result.loss,
          ),
        },
      ),
    );
    assertEquals(embed.fields?.map(({ name }) => name), [
      "試合情報",
      "試合時間",
      "KDA",
    ]);
    assertEquals(
      embed.fields?.find(({ name }) => name === "KDA")?.value,
      "5/-/-",
    );
  });
}

for (
  const observation of [
    { championId: 17, elapsedSeconds: 1259 },
    { championId: 17, elapsedSeconds: null },
    { championId: null, elapsedSeconds: 1259 },
  ]
) {
  test(`Mayhem結果が取得不可でも、観測済みの${observation.championId === null ? "時間" : observation.elapsedSeconds === null ? "チャンピオン" : "チャンピオンと時間"}だけを表示する`, async () => {
    const embed = (await renderer().resultUnavailable(
      watcher(),
      "JP1_12345",
      "mayhem",
      observation,
    )).toJSON();
    const fields = [
      ...(observation.championId === null
        ? []
        : [{ name: "チャンピオン", value: "ティーモ", inline: true }]),
      ...(observation.elapsedSeconds === null ? [] : [{
        name: "試合時間（概算）",
        value: "約20分（最終確認時点）",
        inline: true,
      }]),
    ];
    assertEquals(embed, {
      title: "ARAM: Mayhem",
      description: "試合結果を取得できません。",
      fields,
    });
  });
}

test("Mayhemで正式なチャンピオンと時間を取得できた場合、観測時の値より優先し勝敗は不明のまま表示する", async () => {
  const value: RiotMatch = {
    ...match(),
    info: {
      ...match().info,
      gameMode: "KIWI",
      participants: [{ puuid: "puuid-1", championId: 18 }],
    },
  };
  const embed =
    (await renderer().matchResult(watcher(), account(), value, null, null, {
      championId: 17,
      elapsedSeconds: 1259,
    })).toJSON();
  assertEquals(embed.fields, [{
    name: "チャンピオン",
    value: "トリスターナ",
    inline: true,
  }, { name: "試合時間", value: "30:00", inline: true }]);
  assertEquals(embed.description, "試合結果を取得できません。");
});

test("Mayhemのチャンピオン表示名を解決できない場合、取得済みIDと概算時間を保持する", async () => {
  const embed =
    (await renderer(null).resultUnavailable(watcher(), "JP1_12345", "mayhem", {
      championId: 17,
      elapsedSeconds: 1259,
    })).toJSON();
  assertEquals(
    embed.fields?.[0].value,
    messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.championId,
      { id: 17 },
    ),
  );
  assertEquals(embed.fields?.[1].value, "約20分（最終確認時点）");
});

test("Mayhemで正式なチャンピオン名だけ取得できた場合、古い観測IDの表示名で上書きしない", async () => {
  const value: RiotMatch = {
    ...match(),
    info: {
      ...match().info,
      gameMode: "KIWI",
      participants: [{ puuid: "puuid-1", championName: "Tristana" }],
    },
  };
  const embed =
    (await renderer().matchResult(watcher(), account(), value, null, null, {
      championId: 17,
      elapsedSeconds: 1259,
    })).toJSON();
  assertEquals(embed.fields?.[0].value, "Tristana");
});
