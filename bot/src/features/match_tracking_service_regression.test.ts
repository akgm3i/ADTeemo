import { stub } from "@std/testing/mock";
import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  account,
  activeGame,
  activeGameWithParticipants,
  match,
  trackingNow,
  watcher,
} from "./testing/match_tracking_fixtures.ts";
import {
  activeInspection,
  resultInspection,
  trackingServiceHarness,
} from "./testing/match_tracking_service_harness.ts";

const secondAccount = () =>
  account({ discordId: "target-2", puuid: "puuid-2" });
const inGame = (
  targetDiscordId = "target-1",
  messageId: string | null = "shared",
  riotAccountPuuid = "puuid-1",
) =>
  watcher({
    targetDiscordId,
    riotAccountPuuid,
    lastState: "IN_GAME",
    currentGameId: "12345",
    currentNotificationMessageId: messageId,
    gameStartedAt: new Date("2026-01-01T00:00:00Z"),
  });

describe("match tracking serviceの共有投稿と連戦の回帰", () => {
  test("同一Discordユーザーの2accountが同じ試合を開始すると、PUUID別に状態を保存し共有表示に両account名を残す", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const accounts = [
      account({ gameName: "Main" }),
      account({ puuid: "puuid-sub", gameName: "Sub", isMain: false }),
    ];
    const game = activeGameWithParticipants(accounts.map((a) => a.puuid));
    using h = trackingServiceHarness({
      watchers: accounts.map((a) => watcher({ riotAccountPuuid: a.puuid })),
      active: accounts.map((a) => ({
        targetDiscordId: a.discordId,
        result: activeInspection(game, a),
      })),
      notifications: [{ messageId: null, resultId: "shared" }, {
        messageId: "shared",
        resultId: "shared",
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(
      new Set(h.states.map((args) => args[2].riotAccountPuuid)),
      new Set(["puuid-1", "puuid-sub"]),
    );
    assertEquals(
      h.renderedActive.at(-1)?.[4]?.map((
        d,
      ) => [d.targetDiscordId, d.riotAccountPuuid, d.accountName]),
      [["target-1", "puuid-1", "Main#JP1"], [
        "target-1",
        "puuid-sub",
        "Sub#JP1",
      ]],
    );
    assertEquals(h.errors, []);
  });

  test("同一Discordユーザーの2accountが同じ試合を終了すると、結果cacheと投稿IDをaccountごとに分離する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const accounts = [
      account(),
      account({ puuid: "puuid-sub", isMain: false }),
    ];
    using h = trackingServiceHarness({
      watchers: accounts.map((a) => inGame(a.discordId, "shared", a.puuid)),
      accounts,
      active: accounts.map((a) => ({
        targetDiscordId: a.discordId,
        result: activeInspection(null, a),
      })),
      results: accounts.map((a) => ({
        targetDiscordId: a.discordId,
        result: resultInspection(match(), a),
      })),
      notifications: [
        { messageId: "shared", resultId: "shared", intent: "result:JP1_12345" },
        { messageId: null, resultId: "sub-result", intent: "result:JP1_12345" },
      ],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.renderedResults.map((args) => args[1].puuid), [
      "puuid-1",
      "puuid-sub",
    ]);
    assertEquals(h.errors, []);
  });

  test("同じ試合を2人が開始すると、2人目は同じ投稿を編集して両watcherへ共有IDを保存する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const game = activeGameWithParticipants(["puuid-1", "puuid-2"]);
    using h = trackingServiceHarness({
      watchers: [
        watcher(),
        watcher({ targetDiscordId: "target-2", riotAccountPuuid: "puuid-2" }),
      ],
      active: [
        { targetDiscordId: "target-1", result: activeInspection(game) },
        {
          targetDiscordId: "target-2",
          result: activeInspection(game, secondAccount()),
        },
      ],
      notifications: [{ messageId: null, resultId: "shared" }, {
        messageId: "shared",
        resultId: "shared",
      }],
    });
    await h.service.processMatchWatchers();
    for (const target of ["target-1", "target-2"]) {
      assertEquals(
        h.states.filter((args) => args[1] === target).at(-1)?.[2]
          .currentNotificationMessageId,
        "shared",
      );
    }
    assertEquals(h.renderedActive.at(-1)?.[4], [{
      targetDiscordId: "target-1",
      riotAccountPuuid: "puuid-1",
      accountName: "Teemo#JP1",
      championId: 17,
    }, {
      targetDiscordId: "target-2",
      riotAccountPuuid: "puuid-2",
      accountName: "Teemo#JP1",
      championId: 18,
    }]);
    assertEquals(h.errors, []);
  });

  for (const currentMessage of [null, "shared", "stale"]) {
    test(`後続tickで参加者が増え既存IDが${currentMessage ?? "未保存"}のとき、確定済み共有IDを同期し進捗通知で上書きしない`, async () => {
      using _batchId = stub(
        crypto,
        "randomUUID",
        () => "00000000-0000-4000-8000-000000000001" as const,
      );
      const game = activeGameWithParticipants(["puuid-1", "puuid-2"]);
      using h = trackingServiceHarness({
        watchers: [
          watcher({ targetDiscordId: "target-2", riotAccountPuuid: "puuid-2" }),
          {
            ...inGame("target-1", currentMessage),
            lastInGameNotifiedAt: trackingNow,
          },
        ],
        accounts: [account()],
        active: [{
          targetDiscordId: "target-2",
          result: activeInspection(game, secondAccount()),
        }, { targetDiscordId: "target-1", result: activeInspection(game) }],
        notifications: [{ messageId: currentMessage, resultId: "shared" }],
      });
      await h.service.processMatchWatchers();
      assertEquals(h.renderedActive.map((args) => args[3]), ["started"]);
      const synchronized = h.states.filter((args) =>
        args[1] === "target-1" &&
        args[2].currentNotificationMessageId !== undefined
      );
      if (currentMessage !== "shared") {
        assertEquals(
          synchronized.at(-1)?.[2].currentNotificationMessageId,
          "shared",
        );
      }
      assertEquals(h.errors, []);
    });
  }

  test("共有投稿を持つ後続watcherだけが残ると、同じIDへ進捗通知して新しい投稿を作らない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame("target-2", "shared", "puuid-2")],
      accounts: [secondAccount()],
      active: [{
        targetDiscordId: "target-2",
        result: activeInspection(activeGame(), secondAccount()),
      }],
      notifications: [{ messageId: "shared", resultId: "shared" }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.renderedActive[0][3], "progress");
    assertEquals(h.states.at(-1)?.[2].currentNotificationMessageId, "shared");
  });

  test("共有進捗投稿が置換されると、同じtickの未通知watcherへ置換IDを同期して再編集しない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame(), inGame("target-2", "shared", "puuid-2")],
      accounts: [account(), secondAccount()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(activeGame(), secondAccount()),
      }],
      notifications: [{ messageId: "shared", resultId: "replacement" }],
    });
    await h.service.processMatchWatchers();
    for (const target of ["target-1", "target-2"]) {
      assertEquals(
        h.states.filter((args) =>
          args[1] === target && args[2].currentNotificationMessageId
        ).at(-1)?.[2].currentNotificationMessageId,
        "replacement",
      );
    }
    assertEquals(h.renderedActive.length, 1);
  });

  for (const scope of ["guild", "channel", "platform"] as const) {
    test(`同じgameIdでも${scope}が異なると、開始通知の投稿IDを共有しない`, async () => {
      using _batchId = stub(
        crypto,
        "randomUUID",
        () => "00000000-0000-4000-8000-000000000001" as const,
      );
      const other = watcher({
        targetDiscordId: "target-2",
        riotAccountPuuid: "puuid-2",
        ...(scope === "guild" ? { guildId: "guild-2" } : {}),
        ...(scope === "channel" ? { channelId: "channel-2" } : {}),
      });
      using h = trackingServiceHarness({
        watchers: [watcher(), other],
        active: [{
          targetDiscordId: "target-1",
          result: activeInspection(activeGame()),
        }, {
          guildId: other.guildId,
          targetDiscordId: "target-2",
          result: activeInspection(activeGame(), {
            ...secondAccount(),
            platform: scope === "platform" ? "na1" : "jp1",
          }),
        }],
        notifications: [{ messageId: null, resultId: "first" }, {
          messageId: null,
          resultId: "second",
        }],
      });
      await h.service.processMatchWatchers();
      assertEquals(h.states.at(-1)?.[2].currentNotificationMessageId, "second");
      assertEquals(h.errors, []);
    });
  }

  for (
    const ids of [["shared", "shared"], ["first", "second"], [
      "first",
      "second",
      "second",
    ]]
  ) {
    test(`同じ試合の${ids.length}人が終了し投稿IDが${ids.join("/")}のとき、各結果へdistinctな投稿を1回だけ割り当てる (#98)`, async () => {
      using _batchId = stub(
        crypto,
        "randomUUID",
        () => "00000000-0000-4000-8000-000000000001" as const,
      );
      const accounts = ids.map((_, index) =>
        account({
          discordId: `target-${index + 1}`,
          puuid: `puuid-${index + 1}`,
        })
      );
      const resultIds = ids.map((id, index) =>
        ids.indexOf(id) === index ? id : `new-${index}`
      );
      using h = trackingServiceHarness({
        watchers: ids.map((id, index) =>
          inGame(`target-${index + 1}`, id, `puuid-${index + 1}`)
        ),
        accounts,
        active: accounts.map((value) => ({
          targetDiscordId: value.discordId,
          result: activeInspection(null, value),
        })),
        results: accounts.map((value) => ({
          targetDiscordId: value.discordId,
          result: resultInspection(match(), value),
        })),
        notifications: ids.map((id, index) => ({
          messageId: ids.indexOf(id) === index ? id : null,
          resultId: resultIds[index],
          intent: "result:JP1_12345",
        })),
      });
      await h.service.processMatchWatchers();
      assertEquals(h.renderedResults.length, ids.length);
      assertEquals(
        h.states.map((args) => args[2].lastState),
        ids.map(() => "IDLE"),
      );
      assertEquals(h.errors, []);
    });
  }

  for (const legacy of [false, true]) {
    test(`${legacy ? "legacy FETCHING_RESULT" : "pending result"}が共有IDを使用中のとき、後続watcherの結果でそのIDを再利用しない (#98)`, async () => {
      using _batchId = stub(
        crypto,
        "randomUUID",
        () => "00000000-0000-4000-8000-000000000001" as const,
      );
      const pending = watcher(
        legacy
          ? {
            lastState: "FETCHING_RESULT",
            currentMatchId: "JP1_12345",
            currentNotificationMessageId: "shared",
          }
          : {
            pendingResultMatchId: "JP1_12345",
            pendingResultNotificationMessageId: "shared",
          },
      );
      using h = trackingServiceHarness({
        watchers: [pending, inGame("target-2", "shared", "puuid-2")],
        accounts: [secondAccount()],
        active: [
          ...(legacy ? [] : [{
            targetDiscordId: "target-1",
            result: activeInspection(null),
          }]),
          {
            targetDiscordId: "target-2",
            result: activeInspection(null, secondAccount()),
          },
        ],
        results: [{
          targetDiscordId: "target-1",
          result: resultInspection(null),
        }, {
          targetDiscordId: "target-2",
          result: resultInspection(null, secondAccount()),
        }],
        notifications: [{ messageId: null, resultId: "new-result" }],
      });
      await h.service.processMatchWatchers();
      assertEquals(
        h.states.at(-1)?.[2].pendingResultNotificationMessageId,
        "new-result",
      );
      assertEquals(h.errors, []);
    });
  }

  test("同じ共有試合の2人が次の試合へ進むと、旧結果のIDを新試合に流用せず後続結果も分離する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame(), inGame("target-2", "shared", "puuid-2")],
      accounts: [account(), secondAccount()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame(67890)),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(activeGame(67890), secondAccount()),
      }],
      results: [
        { targetDiscordId: "target-1", result: resultInspection(null) },
        {
          targetDiscordId: "target-2",
          result: resultInspection(null, secondAccount()),
        },
      ],
      notifications: [
        { messageId: null, resultId: "new-game", intent: "started:jp1:67890" },
        {
          messageId: "shared",
          resultId: "shared",
          intent: "pending:JP1_12345",
        },
        {
          messageId: "new-game",
          resultId: "new-game",
          intent: "started:jp1:67890",
        },
        {
          messageId: null,
          resultId: "second-old-result",
          intent: "pending:JP1_12345",
        },
      ],
    });
    await h.service.processMatchWatchers();
    for (const target of ["target-1", "target-2"]) {
      const state = h.states.filter((args) => args[1] === target).at(-1)?.[2];
      assertEquals(state?.currentGameId, "67890");
      assertEquals(state?.currentNotificationMessageId, "new-game");
      assertEquals(state?.pendingResultMatchId, "JP1_12345");
    }
    assertEquals(h.errors, []);
  });

  test("pending resultがある状態でActive Game検査が失敗すると、先に結果を取得して通知し後続watcherを継続する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [
        watcher({
          pendingResultMatchId: "JP1_12345",
          pendingResultNotificationMessageId: "shared",
        }),
        watcher({ targetDiscordId: "target-2", riotAccountPuuid: "puuid-2" }),
      ],
      results: [{
        targetDiscordId: "target-1",
        result: resultInspection(match()),
      }],
      active: [{
        targetDiscordId: "target-1",
        result: {
          success: false,
          error: "upstream",
          status: 502,
          code: "RIOT_API_UNAVAILABLE",
        },
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(null, secondAccount()),
      }],
      notifications: [{ messageId: "shared", resultId: "shared" }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.states.length, 1);
    assertEquals(h.states[0][2].pendingResultMatchId, null);
    assertEquals(h.warnings.length, 1);
  });

  test("IDLEの対象が試合中でないとき、通知も不要な状態更新も行わない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [watcher()],
      active: [{ targetDiscordId: "target-1", result: activeInspection(null) }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.states, []);
  });
  test("同一tickで共有投稿を置換した後に別watcherの終了を検知すると、置換後IDを結果待ちに保存する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame(), inGame("target-2", "shared", "puuid-2")],
      accounts: [account(), secondAccount()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(null, secondAccount()),
      }],
      results: [{
        targetDiscordId: "target-2",
        result: resultInspection(null, secondAccount()),
      }],
      notifications: [{ messageId: "shared", resultId: "replacement" }, {
        messageId: "replacement",
        resultId: "replacement",
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(
      h.states.at(-1)?.[2].pendingResultNotificationMessageId,
      "replacement",
    );
  });

  test("同じtickで2人が開始し共有投稿が置換されると、先行watcherにも置換後IDを保存する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [
        watcher(),
        watcher({ targetDiscordId: "target-2", riotAccountPuuid: "puuid-2" }),
      ],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(activeGame(), secondAccount()),
      }],
      notifications: [{ messageId: null, resultId: "shared" }, {
        messageId: "shared",
        resultId: "replacement",
      }],
    });
    await h.service.processMatchWatchers();
    for (const target of ["target-1", "target-2"]) {
      assertEquals(
        h.states.filter((args) => args[1] === target).at(-1)?.[2]
          .currentNotificationMessageId,
        "replacement",
      );
    }
  });

  test("通知間隔内に未保存とstaleのIDが混在すると、再編集せず3人の共有IDを同期する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    const accounts = [
      account(),
      secondAccount(),
      account({ discordId: "target-3", puuid: "puuid-3" }),
    ];
    using h = trackingServiceHarness({
      watchers: [
        { ...inGame(), lastInGameNotifiedAt: trackingNow },
        inGame("target-2", null, "puuid-2"),
        inGame("target-3", "stale", "puuid-3"),
      ],
      accounts,
      active: accounts.map((value) => ({
        targetDiscordId: value.discordId,
        result: activeInspection(activeGame(), value),
      })),
    });
    await h.service.processMatchWatchers();
    for (const target of ["target-2", "target-3"]) {
      assertEquals(
        h.states.filter((args) => args[1] === target).at(-1)?.[2]
          .currentNotificationMessageId,
        "shared",
      );
    }
  });

  test("新試合を始めたwatcherの後に同じ新試合の既存watcherがいても、進捗で開始通知を上書きしない", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame(), {
        ...inGame("target-2", "new-game", "puuid-2"),
        currentGameId: "67890",
      }],
      accounts: [account(), secondAccount()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame(67890)),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(activeGame(67890), secondAccount()),
      }],
      results: [{
        targetDiscordId: "target-1",
        result: resultInspection(null),
      }],
      notifications: [{ messageId: "new-game", resultId: "new-game" }, {
        messageId: "shared",
        resultId: "shared",
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.renderedActive.map((args) => args[3]), ["started"]);
  });

  test("旧結果を待ちながら現在試合を監視すると、pendingを維持して現在試合の進捗を更新する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [{
        ...inGame(),
        pendingResultMatchId: "JP1_11111",
        pendingResultNotificationMessageId: "old-result",
      }],
      accounts: [account()],
      results: [{
        targetDiscordId: "target-1",
        result: resultInspection(null),
      }],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }],
      notifications: [{ messageId: "shared", resultId: "shared" }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.states[0][2].pendingResultMatchId, "JP1_11111");
    assertEquals(h.states.at(-1)?.[2].currentGameId, "12345");
  });

  test("同一targetを2 guildで監視すると、Active Game判定・通知・状態保存をguildごとに行う", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [watcher(), watcher({ guildId: "guild-2" })],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }, {
        guildId: "guild-2",
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }],
      notifications: [{ messageId: null, resultId: "guild-1-message" }, {
        messageId: null,
        resultId: "guild-2-message",
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(
      h.states.map((args) => [args[0], args[2].currentNotificationMessageId]),
      [["guild-1", "guild-1-message"], ["guild-2", "guild-2-message"]],
    );
  });

  for (const dueFirst of [true, false]) {
    test(`同じPUUIDの2 guildで通知時刻が違う場合、${dueFirst ? "期限到来" : "通知間隔内"}のguildを先に処理しても各入力で判定し期限到来guildだけ通知する`, async () => {
      using _batchId = stub(
        crypto,
        "randomUUID",
        () => "00000000-0000-4000-8000-000000000001" as const,
      );
      const game = activeGame();
      const due = watcher({
        ...inGame(),
        guildId: "guild-due",
        channelId: "channel-due",
        currentNotificationMessageId: "due-message",
        lastInGameNotifiedAt: new Date(trackingNow.getTime() - 600_000),
      });
      const recent = watcher({
        ...inGame(),
        guildId: "guild-recent",
        channelId: "channel-recent",
        currentNotificationMessageId: "recent-message",
        gameStartedAt: new Date(trackingNow.getTime() - 120_000),
        lastInGameNotifiedAt: new Date(trackingNow.getTime() - 1_000),
      });
      const watchers = dueFirst ? [due, recent] : [recent, due];
      using h = trackingServiceHarness({
        watchers,
        accounts: [account()],
        active: watchers.map((value) => ({
          guildId: value.guildId,
          targetDiscordId: value.targetDiscordId,
          result: {
            success: true as const,
            account: account(),
            activeGame: game,
          },
        })),
        notifications: [{ messageId: "due-message", resultId: "due-message" }],
      });
      await h.service.processMatchWatchers();
      assertEquals(
        h.activeInspections.map(([guildId, targetDiscordId, state]) => ({
          guildId,
          targetDiscordId,
          state,
        })),
        watchers.map((value) => ({
          guildId: value.guildId,
          targetDiscordId: value.targetDiscordId,
          state: {
            inspectionBatchId: "00000000-0000-4000-8000-000000000001",
            riotAccountPuuid: value.riotAccountPuuid,
          },
        })),
      );
      assertEquals(h.notifications.map((args) => args[0].guildId), [
        "guild-due",
      ]);
      assertEquals(
        h.states.filter((args) => args[2].lastInGameNotifiedAt !== undefined)
          .map((args) => args[0]),
        ["guild-due"],
      );
      assertEquals(h.errors, []);
    });
  }

  test("保存済みpendingの期限が過ぎたら、外部結果を取得せず期限切れ通知後に解除する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [
        watcher({
          lastState: "FETCHING_RESULT",
          currentMatchId: "JP1_12345",
          gameStartedAt: new Date(trackingNow.getTime() - 10_800_000),
        }),
      ],
      notifications: [{
        messageId: null,
        resultId: "timeout-message",
        intent: "timeout:JP1_12345",
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.states.at(-1)?.[2].pendingResultMatchId, null);
    assertEquals(h.states.at(-1)?.[2].lastState, "IDLE");
    assertEquals(h.notifications[0][2].toJSON().title, "timeout");
  });
  test("開始通知が一時失敗すると、IN_GAMEも通知時刻も保存せず後続watcherを処理する", async () => {
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [
        watcher(),
        watcher({ targetDiscordId: "target-2", riotAccountPuuid: "puuid-2" }),
      ],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }, {
        targetDiscordId: "target-2",
        result: activeInspection(null, secondAccount()),
      }],
      notifications: [{
        messageId: null,
        resultId: "unused",
        failure: { status: "retryable_failure", reason: "send" },
      }],
    });
    await h.service.processMatchWatchers();
    assertEquals(h.states, []);
    assertEquals(h.errors.length, 1);
    assertEquals(h.errors[0][0], "match_tracking.watcher_failed");
  });
});

for (const nextGame of [false, true]) {
  test(`終了検知時に結果が確定している場合、${nextGame ? "新試合の監視を開始し旧投稿は" : "進行投稿を"}直接結果へ更新する`, async () => {
    // Arrange
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [inGame()],
      accounts: [account()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(nextGame ? activeGame(67890) : null),
      }],
      results: [{
        targetDiscordId: "target-1",
        result: resultInspection(match()),
      }],
      notifications: [
        ...(nextGame
          ? [{
            messageId: null,
            resultId: "new-game",
            intent: "started:jp1:67890",
          }]
          : []),
        { messageId: "shared", resultId: "shared", intent: "result:JP1_12345" },
      ],
    });
    // Act
    await h.service.processMatchWatchers();
    // Assert
    assertEquals(h.errors, []);
    assertEquals(h.states.at(-1)?.[2].pendingResultMatchId, null);
    assertEquals(h.states.at(-1)?.[2].currentGameId, nextGame ? "67890" : null);
  });
}

test("終了検知時の結果取得が失敗した場合、確認中の投稿IDを保存して次tickに結果取得を再開できる", async () => {
  // Arrange
  using _batchId = stub(
    crypto,
    "randomUUID",
    () => "00000000-0000-4000-8000-000000000001" as const,
  );
  using h = trackingServiceHarness({
    watchers: [inGame()],
    accounts: [account()],
    active: [{ targetDiscordId: "target-1", result: activeInspection(null) }],
    results: [{
      targetDiscordId: "target-1",
      result: {
        success: false,
        error: "upstream",
        status: 502,
        code: "RIOT_API_UNAVAILABLE",
      },
    }],
    notifications: [{
      messageId: "shared",
      resultId: "replacement",
      intent: "pending:JP1_12345",
    }],
  });
  // Act
  await h.service.processMatchWatchers();
  // Assert
  assertEquals(h.errors, []);
  assertEquals(h.warnings.length, 1);
  assertEquals(h.states.at(-1)?.[2].lastState, "IDLE");
  assertEquals(h.states.at(-1)?.[2].pendingResultMatchId, "JP1_12345");
  assertEquals(
    h.states.at(-1)?.[2].pendingResultNotificationMessageId,
    "replacement",
  );
});

for (const failedDelivery of [false, true]) {
  test(`新試合中に旧結果の取得が拒否され、取得不可通知が${failedDelivery ? "一時失敗" : "成功"}すると、新試合を保持し旧結果待ちを${failedDelivery ? "維持" : "解除"}する`, async () => {
    // Arrange
    using _batchId = stub(
      crypto,
      "randomUUID",
      () => "00000000-0000-4000-8000-000000000001" as const,
    );
    using h = trackingServiceHarness({
      watchers: [{
        ...inGame(),
        currentGameId: "67890",
        currentGameMode: "CLASSIC",
        currentNotificationMessageId: "new-game",
        lastInGameNotifiedAt: trackingNow,
        pendingResultMatchId: "JP1_12345",
        pendingResultGameMode: "KIWI",
        pendingResultNotificationMessageId: "old-game",
        pendingResultStartedAt: new Date("2026-01-01T00:00:00Z"),
      }],
      accounts: [account()],
      results: [{
        targetDiscordId: "target-1",
        result: {
          success: false,
          status: 502,
          code: "RIOT_MATCH_ACCESS_DENIED",
          error: "denied",
        },
      }],
      active: failedDelivery ? [] : [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame(67890)),
      }],
      notifications: [{
        messageId: "old-game",
        resultId: "old-game",
        intent: "unavailable:JP1_12345",
        ...(failedDelivery
          ? {
            failure: {
              status: "retryable_failure" as const,
              reason: "edit" as const,
            },
          }
          : {}),
      }],
    });
    // Act
    await h.service.processMatchWatchers();
    // Assert
    if (failedDelivery) assertEquals(h.states, []);
    else {
      assertEquals(h.states[0][2].pendingResultMatchId, null);
      assertEquals(h.states[0][2].currentGameId, "67890");
      assertEquals(h.states[0][2].currentNotificationMessageId, "new-game");
    }
    assertEquals(h.notifications[0][2].data.title, "mayhem");
    if (!failedDelivery) {
      assertEquals(h.states[0][2].currentGameMode, "CLASSIC");
      assertEquals(h.states[0][2].pendingResultGameMode, null);
    }
    assertEquals(h.warnings[0][1]?.reason, "match_access_denied");
  });
}

test("次のMayhemが始まってから前試合の結果取得が拒否されても、使用チャンピオンと概算時間を混ぜない", async () => {
  using _batchId = stub(
    crypto,
    "randomUUID",
    () => "00000000-0000-4000-8000-000000000001" as const,
  );
  const previous = { championId: 17, elapsedSeconds: 840 };
  using h = trackingServiceHarness({
    watchers: [{
      ...inGame(),
      currentGameMode: "KIWI",
      currentGameObservation: previous,
    }],
    accounts: [account()],
    active: [{
      targetDiscordId: "target-1",
      result: activeInspection({
        ...activeGame(67890),
        gameMode: "KIWI",
        participants: [{ puuid: "puuid-1", championId: 18, teamId: 100 }],
      }),
    }],
    results: [{
      targetDiscordId: "target-1",
      result: {
        success: false,
        status: 502,
        code: "RIOT_MATCH_ACCESS_DENIED",
        error: "denied",
      },
    }],
    notifications: [
      { messageId: null, resultId: "new-game", intent: "started:jp1:67890" },
      {
        messageId: "shared",
        resultId: "shared",
        intent: "unavailable:JP1_12345",
      },
    ],
  });
  await h.service.processMatchWatchers();
  assertEquals(h.errors, []);
  assertEquals(h.renderedUnavailable[0][3], previous);
  assertEquals(h.states[0][2].pendingResultObservation, previous);
  assertEquals(h.states.at(-1)?.[2].pendingResultObservation, null);
  assertEquals(h.states.at(-1)?.[2].currentGameObservation, {
    championId: 18,
    elapsedSeconds: 120,
  });
});

test("旧PH2と新SG2でnumeric gameIdが一致しても、旧結果と新しい開始投稿・Mayhem観測を分離する", async () => {
  // Arrange
  const movedAccount = account({ platform: "sg2", region: "sea" });
  const previousObservation = { championId: 17, elapsedSeconds: 3600 };
  const nextGame = {
    ...activeGame(),
    gameMode: "KIWI",
    gameQueueConfigId: 2400,
    gameStartTime: trackingNow.getTime() - 60_000,
    gameLength: 60,
    participants: [{ puuid: "puuid-1", championId: 99, teamId: 100 }],
  };
  const oldMatch = match();
  oldMatch.metadata.matchId = "PH2_12345";
  using h = trackingServiceHarness({
    watchers: [watcher({
      ...inGame(),
      currentMatchId: "PH2_12345",
      currentGameMode: "KIWI",
      currentGameObservation: previousObservation,
    })],
    accounts: [movedAccount],
    active: [{
      targetDiscordId: "target-1",
      result: activeInspection(nextGame, movedAccount),
    }],
    results: [{
      targetDiscordId: "target-1",
      result: resultInspection(oldMatch, movedAccount),
    }],
    notifications: [
      { messageId: null, resultId: "new-active", intent: "started:sg2:12345" },
      { messageId: "shared", resultId: "shared", intent: "result:PH2_12345" },
    ],
  });

  // Act
  await h.service.processMatchWatchers();

  // Assert
  assertEquals(h.errors, []);
  assertEquals(h.states.at(-1)?.[2].currentMatchId, "SG2_12345");
  assertEquals(h.states.at(-1)?.[2].currentNotificationMessageId, "new-active");
  assertEquals(h.states.at(-1)?.[2].currentGameObservation, {
    championId: 99,
    elapsedSeconds: 60,
  });
  assertEquals(h.renderedResults[0][5], previousObservation);
});

test("旧pendingの期限切れはBotが結果取得前に判断し、新しいcurrentMatchIdを保持する", async () => {
  // Arrange
  using h = trackingServiceHarness({
    watchers: [watcher({
      ...inGame(),
      currentGameId: "67890",
      currentMatchId: "JP1_67890",
      lastInGameNotifiedAt: trackingNow,
      pendingResultMatchId: "JP1_12345",
      pendingResultNotificationMessageId: "old-result",
      pendingResultStartedAt: new Date(trackingNow.getTime() - 10_800_000),
    })],
    accounts: [account()],
    active: [{
      targetDiscordId: "target-1",
      result: activeInspection(activeGame(67890)),
    }],
    notifications: [{
      messageId: "old-result",
      resultId: "old-result",
      intent: "timeout:JP1_12345",
    }],
  });

  // Act
  await h.service.processMatchWatchers();

  // Assert
  assertEquals(h.errors, []);
  assertEquals(h.states[0][2].pendingResultMatchId, null);
  assertEquals(h.states[0][2].currentMatchId, "JP1_67890");
});

for (const saveFails of [false, true]) {
  test(`ランク開始時に取得したbeforeを${saveFails ? "保存できなくても警告して" : "保存して"}開始通知を継続する`, async () => {
    // Arrange
    const entries = [{
      queueType: "RANKED_SOLO_5x5" as const,
      tier: "GOLD",
      rank: "I",
      leaguePoints: 42,
      wins: 10,
      losses: 8,
    }];
    using h = trackingServiceHarness({
      watchers: [watcher()],
      active: [{
        targetDiscordId: "target-1",
        result: activeInspection(activeGame()),
      }],
      leagueEntries: entries,
      rankSaveResult: saveFails
        ? { success: false, error: "repository unavailable" }
        : { success: true },
      notifications: [{
        messageId: null,
        resultId: "started",
        intent: "started:jp1:12345",
      }],
    });

    // Act
    await h.service.processMatchWatchers();

    // Assert
    assertEquals(h.rankReads, [["jp1", "puuid-1"]]);
    assertEquals(h.rankSnapshots, [{
      platform: "jp1",
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [
        { ...entries[0], fetchedAt: trackingNow },
        {
          queueType: "RANKED_FLEX_SR",
          tier: null,
          rank: null,
          leaguePoints: null,
          wins: null,
          losses: null,
          fetchedAt: trackingNow,
        },
      ],
    }]);
    assertEquals(h.states[0][2].currentNotificationMessageId, "started");
    assertEquals(
      h.warnings.map(([event]) => event),
      saveFails ? ["match_tracking.rank_snapshot_pending_save_failed"] : [],
    );
    assertEquals(h.errors, []);
  });
}
