import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createRiotStaticData } from "./riot_static_data.ts";

type StaticDataCache = {
  key: string;
  version: string;
  value: string;
  updatedAt: Date;
};

function dependencies() {
  return {
    dbActions: {
      getRiotStaticDataCache: (
        _key: string,
      ): Promise<StaticDataCache | undefined> => Promise.resolve(undefined),
      upsertRiotStaticDataCache: (_cache: {
        key: string;
        version: string;
        value: string;
      }) => Promise.resolve(),
    },
    env: {
      get: (_key: string) => undefined,
    },
    fetchJson: (_url: string): Promise<unknown> =>
      Promise.reject(new Error("fetch should not be called")),
    logger: {
      warn: (_message: string, _metadata?: Record<string, unknown>) => {},
    },
  };
}

describe("riot_static_data.ts", () => {
  test("チャンピオン名がキャッシュ済みかつTTL内の場合、外部取得せずDBの値を返す", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () =>
        Promise.resolve({
          key: "champions-data:ja_JP",
          version: "15.24.1",
          value: JSON.stringify({
            "17": { name: "ティーモ", imageFull: "Teemo.png" },
          }),
          updatedAt: new Date(),
        }),
    );
    using upsertCacheStub = stub(
      deps.dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    const name = await riotStaticData.getChampionNameById(17, "ja_JP");

    assertEquals(name, "ティーモ");
    assertSpyCalls(getCacheStub, 1);
    assertSpyCalls(upsertCacheStub, 0);
    assertSpyCalls(fetchStub, 0);
  });

  test("チャンピオン名と画像URLを続けて解決するとき、単一の取得結果とキャッシュを共有する", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    let cached: StaticDataCache | undefined;
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () => Promise.resolve(cached),
    );
    using upsertCacheStub = stub(
      deps.dbActions,
      "upsertRiotStaticDataCache",
      (value) => {
        cached = { ...value, updatedAt: new Date() };
        return Promise.resolve();
      },
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      (input) => {
        const url = String(input);
        if (url.endsWith("/api/versions.json")) {
          return Promise.resolve(["16.12.1"]);
        }
        return Promise.resolve(
          {
            data: {
              Teemo: {
                key: "17",
                name: "ティーモ",
                image: { full: "Teemo.png" },
              },
            },
          },
        );
      },
    );

    const name = await riotStaticData.getChampionNameById(17, "ja_JP");
    const url = await riotStaticData.getChampionIconUrlById(17, "ja_JP");

    assertEquals(name, "ティーモ");
    assertEquals(
      url,
      "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
    );
    assertSpyCalls(fetchStub, 2);
    assertSpyCalls(getCacheStub, 2);
    assertSpyCalls(upsertCacheStub, 1);
    assertEquals(cached?.key, "champions-data:ja_JP");
  });

  test("チャンピオン画像のstatic data取得に失敗しキャッシュもない場合、エラーを返す", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using _getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () => Promise.resolve(undefined),
    );
    using _upsertCacheStub = stub(
      deps.dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using _fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("Failed to fetch Riot static data: 503")),
    );

    let error: unknown;
    try {
      await riotStaticData.getChampionIconUrlById(17, "ja_JP");
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof Error, true);
  });

  test("キュー名が未キャッシュの場合、公式static JSONを取得してDBへ保存する", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () => Promise.resolve(undefined),
    );
    using upsertCacheStub = stub(
      deps.dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () =>
        Promise.resolve(
          [{
            queueId: 420,
            description: "5v5 Ranked Solo games",
          }],
        ),
    );

    const name = await riotStaticData.getQueueNameById(420, "en_US");

    assertEquals(name, "5v5 Ranked Solo games");
    assertSpyCalls(getCacheStub, 1);
    assertSpyCalls(upsertCacheStub, 1);
    assertSpyCalls(fetchStub, 1);
  });

  test("ja_JPの代表キューは日本語ユーザー向けの表示名を返す", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () => Promise.reject(new Error("cache should not be called")),
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    const name = await riotStaticData.getQueueNameById(420, "ja_JP");

    assertEquals(name, "ランクソロ/デュオ");
    assertSpyCalls(getCacheStub, 0);
    assertSpyCalls(fetchStub, 0);
  });

  test("ja_JPの代表マップとゲームモードは日本語ユーザー向けの表示名を返す", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () => Promise.reject(new Error("cache should not be called")),
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    const map = await riotStaticData.getMapNameById(11, "ja_JP");
    const mode = await riotStaticData.getGameModeName("CLASSIC", "ja_JP");

    assertEquals(map, "サモナーズリフト");
    assertEquals(mode, "クラシック");
    assertSpyCalls(getCacheStub, 0);
    assertSpyCalls(fetchStub, 0);
  });

  test("キャッシュ更新に失敗した場合、古いDB値をfallbackとして返す", async () => {
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using _getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      () =>
        Promise.resolve({
          key: "maps",
          version: "static.developer.riotgames.com",
          value: JSON.stringify({ "11": "Summoner's Rift" }),
          updatedAt: new Date(0),
        }),
    );
    using _upsertCacheStub = stub(
      deps.dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("Failed to fetch Riot static data: 500")),
    );

    const name = await riotStaticData.getMapNameById(11, "en_US");

    assertEquals(name, "Summoner's Rift");
    assertSpyCalls(fetchStub, 1);
  });

  test("複数の静的データ識別子を解決するとき、種別ごとに単一のキャッシュ読み込みから表示データを返す", async () => {
    // Arrange
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      (key) => {
        const values: Record<string, string> = {
          "champions-data:en_US": JSON.stringify({
            "17": { name: "Teemo", imageFull: "Teemo.png" },
            "18": { name: "Tristana", imageFull: null },
          }),
          queues: JSON.stringify({ "420": "5v5 Ranked Solo games" }),
          maps: JSON.stringify({ "11": "Summoner's Rift" }),
          gameModes: JSON.stringify({ CLASSIC: "Classic" }),
        };
        return Promise.resolve({
          key,
          version: key.startsWith("champions-data:")
            ? "16.12.1"
            : "static.developer.riotgames.com",
          value: values[key],
          updatedAt: new Date(),
        });
      },
    );
    using fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    // Act
    const result = await riotStaticData.resolve({
      locale: "en_US",
      championIds: [17, 18, 17],
      queueIds: [420, 420],
      mapIds: [11],
      gameModes: ["CLASSIC"],
    });

    // Assert
    assertEquals(result, {
      champions: {
        "17": {
          name: "Teemo",
          iconUrl:
            "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
        },
        "18": { name: "Tristana", iconUrl: null },
      },
      queues: { "420": "5v5 Ranked Solo games" },
      maps: { "11": "Summoner's Rift" },
      gameModes: { CLASSIC: "Classic" },
    });
    assertSpyCalls(getCacheStub, 4);
    assertSpyCalls(fetchStub, 0);
  });

  test("一部の静的データ取得に失敗したとき、失敗した種別だけnullにして取得済みデータを返す", async () => {
    // Arrange
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using _getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      (key) =>
        Promise.resolve(
          key === "champions-data:en_US"
            ? {
              key,
              version: "16.12.1",
              value: JSON.stringify({
                "17": { name: "Teemo", imageFull: "Teemo.png" },
              }),
              updatedAt: new Date(),
            }
            : undefined,
        ),
    );
    using _fetchStub = stub(
      deps,
      "fetchJson",
      () => Promise.reject(new Error("Failed to fetch Riot static data: 503")),
    );
    using warnStub = stub(deps.logger, "warn", () => {});

    // Act
    const result = await riotStaticData.resolve({
      locale: "en_US",
      championIds: [17],
      queueIds: [420],
    });

    // Assert
    assertEquals(result, {
      champions: {
        "17": {
          name: "Teemo",
          iconUrl:
            "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
        },
      },
      queues: { "420": null },
      maps: {},
      gameModes: {},
    });
    assertSpyCall(warnStub, 0, {
      args: ["riot_static_data.resolve_queues_failed", {
        error: "Failed to fetch Riot static data: 503",
      }],
    });
  });

  test("未知の識別子を含む静的データを解決するとき、対応する値をnullで返す", async () => {
    // Arrange
    const deps = dependencies();
    const riotStaticData = createRiotStaticData(deps);
    using _getCacheStub = stub(
      deps.dbActions,
      "getRiotStaticDataCache",
      (key) =>
        Promise.resolve({
          key,
          version: key.startsWith("champions-data:")
            ? "16.12.1"
            : "static.developer.riotgames.com",
          value: "{}",
          updatedAt: new Date(),
        }),
    );

    // Act
    const result = await riotStaticData.resolve({
      locale: "en_US",
      championIds: [999],
      queueIds: [999],
      mapIds: [999],
      gameModes: ["UNKNOWN"],
    });

    // Assert
    assertEquals(result, {
      champions: { "999": { name: null, iconUrl: null } },
      queues: { "999": null },
      maps: { "999": null },
      gameModes: { UNKNOWN: null },
    });
  });
});
