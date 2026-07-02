import { testClient } from "@hono/hono/testing";
import { assert, assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import { createTestDependencies } from "../test_utils.ts";
import { MatchWatcherLimitError, RecordNotFoundError } from "../errors.ts";

describe("routes/match_watchers.ts", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { dbActions } = deps;
  const client = testClient(app);
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
    const body = await res.json();
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
    const body = await res.json();
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
    assertEquals(await res.json(), {
      account: {
        ...account,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      activeGame,
    });
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
