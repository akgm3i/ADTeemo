import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";

describe("routes/match_watchers.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions } = deps;
  const client = testClient(app, {}, undefined, {
    headers: TEST_BOT_SERVICE_AUTH_HEADERS,
  });
  const watcher = {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    requesterId: "requester-1",
    channelId: "channel-1",
  };

  test("連携済みメンバーを指定して監視登録すると、204 No Contentを返す", async () => {
    using upsertStub = stub(
      dbActions,
      "upsertMatchWatcher",
      () => Promise.resolve(),
    );

    const res = await client["match-watchers"].$post({ json: watcher });

    assert(res.status === 204);
    assertSpyCall(upsertStub, 0, { args: [watcher] });
  });

  test("未連携メンバーを監視登録すると、404を返す", async () => {
    using _upsertStub = stub(
      dbActions,
      "upsertMatchWatcher",
      () => Promise.reject(new RecordNotFoundError("Riot account not found")),
    );

    const res = await client["match-watchers"].$post({ json: watcher });

    assertEquals(res.status, 404);
  });

  test("有効な監視対象数が上限に達していると、409を返す", async () => {
    using _upsertStub = stub(
      dbActions,
      "upsertMatchWatcher",
      () =>
        Promise.reject(
          new MatchWatcherLimitError("Enabled match watchers limit exceeded"),
        ),
    );

    const res = await client["match-watchers"].$post({ json: watcher });

    assertEquals(res.status, 409);
  });

  test("有効な監視設定一覧を返す", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    using getStub = stub(
      dbActions,
      "getEnabledMatchWatchers",
      () =>
        Promise.resolve([{
          ...watcher,
          enabled: true,
          lastState: "IDLE" as const,
          currentGameId: null,
          currentMatchId: null,
          currentNotificationMessageId: null,
          pendingResultMatchId: null,
          pendingResultNotificationMessageId: null,
          pendingResultStartedAt: null,
          gameStartedAt: null,
          lastCheckedAt: null,
          lastInGameNotifiedAt: null,
          createdAt,
          updatedAt: createdAt,
        }]),
    );

    const res = await client["match-watchers"].enabled.$get();

    assert(res.status === 200);
    const body = await res.json() as { watchers: unknown[] };
    assertEquals(body.watchers.length, 1);
    assertSpyCall(getStub, 0, { args: [] });
  });

  test("ギルドIDを指定して有効な監視設定一覧を取得すると、そのギルドの監視設定だけを返す", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    using getStub = stub(
      dbActions,
      "getEnabledMatchWatchersByGuild",
      () =>
        Promise.resolve([{
          ...watcher,
          enabled: true,
          lastState: "IDLE" as const,
          currentGameId: null,
          currentMatchId: null,
          currentNotificationMessageId: null,
          pendingResultMatchId: null,
          pendingResultNotificationMessageId: null,
          pendingResultStartedAt: null,
          gameStartedAt: null,
          lastCheckedAt: null,
          lastInGameNotifiedAt: null,
          createdAt,
          updatedAt: createdAt,
        }]),
    );

    const res = await client["match-watchers"].enabled[":guildId"].$get({
      param: { guildId: watcher.guildId },
    });

    assert(res.status === 200);
    const body = await res.json() as {
      watchers: Array<{ guildId: string }>;
    };
    assertEquals(
      body.watchers.map((item: { guildId: string }) => item.guildId),
      [watcher.guildId],
    );
    assertSpyCall(getStub, 0, { args: [watcher.guildId] });
  });

  test("監視状態を更新すると、204 No Contentを返す", async () => {
    using updateStub = stub(
      dbActions,
      "updateMatchWatcherState",
      () => Promise.resolve(),
    );
    const state = {
      lastState: "IN_GAME" as const,
      currentGameId: "12345",
      currentNotificationMessageId: "message-1",
      pendingResultMatchId: "JP1_12344",
      pendingResultNotificationMessageId: "message-0",
      pendingResultStartedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const res = await client["match-watchers"][":guildId"][":targetDiscordId"]
      .state.$patch({
        param: {
          guildId: watcher.guildId,
          targetDiscordId: watcher.targetDiscordId,
        },
        json: state,
      });

    assert(res.status === 204);
    assertSpyCall(updateStub, 0, {
      args: [watcher.guildId, watcher.targetDiscordId, state],
    });
  });

  test("監視処理用Active Game検査を行うと、連携アカウントと進行中試合を返す", async () => {
    const account = {
      discordId: watcher.targetDiscordId,
      puuid: "puuid-1",
      gameName: "Teemo",
      tagLine: "JP1",
      platform: "jp1" as const,
      region: "asia" as const,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: null,
    };
    const activeGame = {
      gameId: 12345,
      gameType: "MATCHED_GAME",
      gameStartTime: 1_700_000_000_000,
      mapId: 11,
      gameMode: "CLASSIC",
      gameQueueConfigId: 420,
      participants: [{
        puuid: "puuid-1",
        championId: 17,
        teamId: 100,
      }],
    };
    using accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account),
    );
    using activeGameStub = stub(
      deps.riotApi,
      "getActiveGameByPuuid",
      () => Promise.resolve(activeGame),
    );
    using entriesStub = stub(
      deps.riotApi,
      "getLeagueEntriesByPuuid",
      () => Promise.resolve([]),
    );
    using snapshotsStub = stub(
      dbActions,
      "upsertPendingRankSnapshots",
      () => Promise.resolve(),
    );

    const res = await client["match-watchers"][":guildId"][
      ":targetDiscordId"
    ].tracking["active-game"].$post({
      param: {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      },
      json: {
        lastState: "IDLE",
        currentGameId: null,
      },
    });

    assertEquals(res.status, 200);
    const body = await res.json() as {
      account: unknown;
      activeGame: unknown;
      notificationIntent: unknown;
      stateTransition: {
        messageIdField: unknown;
        state: { lastState: unknown; currentGameId: unknown };
      };
    };
    assertEquals(body.account, {
      ...account,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(body.activeGame, activeGame);
    assertEquals(body.notificationIntent, { kind: "started", activeGame });
    assertEquals(
      body.stateTransition.messageIdField,
      "currentNotificationMessageId",
    );
    assertEquals(body.stateTransition.state.lastState, "IN_GAME");
    assertEquals(body.stateTransition.state.currentGameId, "12345");
    assertSpyCall(accountStub, 0, { args: [watcher.targetDiscordId] });
    assertSpyCall(activeGameStub, 0, { args: ["jp1", "puuid-1"] });
    assertSpyCall(entriesStub, 0, { args: ["jp1", "puuid-1"] });
    assertEquals(snapshotsStub.calls.length, 1);
  });

  test("監視処理用Active Game検査で未連携メンバーを指定すると、404を返す", async () => {
    using accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(undefined),
    );

    const res = await client["match-watchers"][":guildId"][
      ":targetDiscordId"
    ].tracking["active-game"].$post({
      param: {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      },
      json: {
        lastState: "IDLE",
        currentGameId: null,
      },
    });

    assertEquals(res.status, 404);
    assertSpyCall(accountStub, 0, { args: [watcher.targetDiscordId] });
  });

  test("監視処理用Result検査を行うと、試合結果とrank summaryとOP.GG詳細を返す", async () => {
    const account = {
      discordId: watcher.targetDiscordId,
      puuid: "puuid-1",
      gameName: "Teemo",
      tagLine: "JP1",
      platform: "jp1" as const,
      region: "asia" as const,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: null,
    };
    const match = {
      metadata: {
        matchId: "JP1_12345",
        participants: ["puuid-1"],
      },
      info: {
        gameId: 12345,
        gameCreation: 1_700_000_000_000,
        gameDuration: 1800,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        mapId: 11,
        queueId: 420,
        participants: [{
          puuid: "puuid-1",
          championId: 17,
          championName: "Teemo",
          teamId: 100,
          win: true,
          kills: 10,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          goldEarned: 12345,
        }],
      },
    };
    const beforeSnapshot = {
      id: 1,
      matchId: "JP1_12345",
      puuid: "puuid-1",
      platform: "jp1" as const,
      queueType: "RANKED_SOLO_5x5" as const,
      phase: "before" as const,
      tier: "EMERALD",
      rank: "IV",
      leaguePoints: 19,
      wins: 11,
      losses: 8,
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const afterSnapshot = {
      ...beforeSnapshot,
      id: 2,
      phase: "after" as const,
      leaguePoints: 37,
      fetchedAt: new Date("2026-01-01T00:05:00.000Z"),
    };
    const opggDetail = {
      provider: "opgg" as const,
      providerRegion: "jp",
      providerMatchId: "12345",
      detailUrl: "https://op.gg/lol/summoners/jp/Teemo-JP1/matches/12345",
      providerCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      averageTier: "Emerald",
      participant: {
        puuid: "puuid-1",
        participantId: 1,
        laneScore: 7,
      },
    };
    using accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account),
    );
    using matchStub = stub(
      deps.riotApi,
      "getMatchById",
      () => Promise.resolve(match),
    );
    using entriesStub = stub(
      deps.riotApi,
      "getLeagueEntriesByPuuid",
      () => Promise.resolve([]),
    );
    using finalizeStub = stub(
      dbActions,
      "finalizeMatchRankSnapshots",
      () =>
        Promise.resolve({
          before: [beforeSnapshot],
          after: [afterSnapshot],
        }),
    );
    using opggStub = stub(
      deps.opggMatchDetailService,
      "resolveAndSave",
      () => Promise.resolve(opggDetail),
    );

    const res = await client["match-watchers"][":guildId"][
      ":targetDiscordId"
    ].tracking.result.$post({
      param: {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      },
      json: { matchId: "JP1_12345" },
    });

    assertEquals(res.status, 200);
    const body = await res.json() as {
      account: unknown;
      match: unknown;
      rankSummary: unknown;
      opggDetail: unknown;
      notificationIntent: unknown;
      stateTransition: {
        messageIdField: unknown;
        state: { pendingResultMatchId: unknown };
      };
    };
    assertEquals(body.account, {
      ...account,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(body.match, match);
    assertEquals(body.rankSummary, {
      queueType: "RANKED_SOLO_5x5",
      before: {
        ...beforeSnapshot,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
      after: {
        ...afterSnapshot,
        fetchedAt: "2026-01-01T00:05:00.000Z",
      },
    });
    assertEquals(body.opggDetail, {
      ...opggDetail,
      providerCreatedAt: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(body.notificationIntent, {
      kind: "result",
      match,
      rankSummary: {
        queueType: "RANKED_SOLO_5x5",
        before: {
          ...beforeSnapshot,
          fetchedAt: "2026-01-01T00:00:00.000Z",
        },
        after: {
          ...afterSnapshot,
          fetchedAt: "2026-01-01T00:05:00.000Z",
        },
      },
      opggDetail: {
        ...opggDetail,
        providerCreatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assertEquals(body.stateTransition.messageIdField, null);
    assertEquals(body.stateTransition.state.pendingResultMatchId, null);
    assertSpyCall(accountStub, 0, { args: [watcher.targetDiscordId] });
    assertSpyCall(matchStub, 0, { args: ["asia", "JP1_12345"] });
    assertSpyCall(entriesStub, 0, { args: ["jp1", "puuid-1"] });
    assertEquals(finalizeStub.calls.length, 1);
    assertEquals(opggStub.calls.length, 1);
  });

  test("監視を解除すると、204 No Contentを返す", async () => {
    using disableStub = stub(
      dbActions,
      "disableMatchWatcher",
      () => Promise.resolve(),
    );

    const res = await client["match-watchers"][":guildId"][":targetDiscordId"]
      .$delete({
        param: {
          guildId: watcher.guildId,
          targetDiscordId: watcher.targetDiscordId,
        },
      });

    assert(res.status === 204);
    assertSpyCall(disableStub, 0, {
      args: [watcher.guildId, watcher.targetDiscordId],
    });
  });
});
