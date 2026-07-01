import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import { messageHandler, messageKeys } from "../messages.ts";
import { createMatchTrackingRenderer } from "./match_tracking_renderer.ts";

type StaticDataInput = Parameters<
  Parameters<typeof createMatchTrackingRenderer>[0]["resolveStaticData"]
>[0];

function watcher(overrides: Partial<MatchWatcher> = {}): MatchWatcher {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    requesterId: "requester-1",
    channelId: "channel-1",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function account(overrides: Partial<RiotAccount> = {}): RiotAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    discordId: "target-1",
    puuid: "puuid-1",
    gameName: "Teemo",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function activeGame() {
  return {
    gameId: 12345,
    gameType: "MATCHED_GAME",
    gameStartTime: new Date("2026-01-01T00:00:00.000Z").getTime(),
    gameLength: 120,
    mapId: 11,
    gameMode: "CLASSIC",
    gameQueueConfigId: 420,
    participants: [{
      puuid: "puuid-1",
      championId: 17,
      teamId: 100,
    }],
  };
}

function staticData() {
  return {
    champions: {
      "17": {
        name: "ティーモ",
        iconUrl:
          "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
      },
    },
    queues: { "420": "ランクソロ/デュオ" },
    maps: { "11": "サモナーズリフト" },
    gameModes: { CLASSIC: "クラシック" },
  };
}

function rendererWith(
  resolveStaticData: (input: StaticDataInput) => Promise<
    ReturnType<
      typeof staticData
    > | null
  > = () => Promise.resolve(staticData()),
) {
  return createMatchTrackingRenderer({
    messages: {
      formatMessage: messageHandler.formatMessage.bind(messageHandler),
      keys: messageKeys,
    },
    resolveStaticData,
    clock: {
      now: () => new Date("2026-01-01T00:02:00.000Z"),
    },
  });
}

describe("match_tracking_renderer.ts", () => {
  test("active Embedを生成するとき、注入されたstatic dataとclockだけで表示内容とtimestampを決める", async () => {
    const dependencies = {
      resolveStaticData: (_input: StaticDataInput) =>
        Promise.resolve(staticData()),
    };
    const resolveSpy = spy(dependencies, "resolveStaticData");
    const renderer = rendererWith(dependencies.resolveStaticData);

    const embed = await renderer.activeGame(
      watcher(),
      account(),
      activeGame(),
      "started",
    );

    const json = embed.toJSON();
    assertEquals(json.timestamp, "2026-01-01T00:02:00.000Z");
    assertEquals(json.thumbnail, {
      url:
        "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
    });
    assertEquals(json.fields?.map((field) => field.value), [
      "ティーモ",
      "ランクソロ/デュオ",
      "サモナーズリフト",
      "クラシック",
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.fallback.elapsedMinutes,
        { minutes: 2 },
      ),
    ]);
    assertSpyCall(resolveSpy, 0, {
      args: [{
        championIds: [17],
        queueIds: [420],
        mapIds: [11],
        gameModes: ["CLASSIC"],
      }],
    });
  });

  test("pendingとtimeout Embedを生成するとき、Discord送信やstatic data解決を行わない", () => {
    const dependencies = {
      resolveStaticData: (_input: StaticDataInput) =>
        Promise.resolve(staticData()),
    };
    const resolveSpy = spy(dependencies, "resolveStaticData");
    const renderer = rendererWith(dependencies.resolveStaticData);

    const pending = renderer.resultPending(watcher(), "JP1_12345").toJSON();
    const timeout = renderer.resultFetchTimeout(watcher(), "JP1_12345")
      .toJSON();

    assertEquals(pending.timestamp, "2026-01-01T00:02:00.000Z");
    assertEquals(timeout.timestamp, "2026-01-01T00:02:00.000Z");
    assertEquals(
      pending.footer?.text,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId: "JP1_12345" },
      ),
    );
    assertEquals(
      timeout.footer?.text,
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId: "JP1_12345" },
      ),
    );
    assertSpyCalls(resolveSpy, 0);
  });
});
