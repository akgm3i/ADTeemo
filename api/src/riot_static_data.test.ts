import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { dbActions } from "./db/actions.ts";
import { riotStaticData } from "./riot_static_data.ts";

describe("riot_static_data.ts", () => {
  test("チャンピオン名がキャッシュ済みかつTTL内の場合、外部取得せずDBの値を返す", async () => {
    using getCacheStub = stub(
      dbActions,
      "getRiotStaticDataCache",
      () =>
        Promise.resolve({
          key: "champions:ja_JP",
          version: "15.24.1",
          value: JSON.stringify({ "17": "ティーモ" }),
          updatedAt: new Date(),
        }),
    );
    using upsertCacheStub = stub(
      dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    const name = await riotStaticData.getChampionNameById(17, "ja_JP");

    assertEquals(name, "ティーモ");
    assertSpyCalls(getCacheStub, 1);
    assertSpyCalls(upsertCacheStub, 0);
    assertSpyCalls(fetchStub, 0);
  });

  test("キュー名が未キャッシュの場合、公式static JSONを取得してDBへ保存する", async () => {
    using getCacheStub = stub(
      dbActions,
      "getRiotStaticDataCache",
      () => Promise.resolve(undefined),
    );
    using upsertCacheStub = stub(
      dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify([{
              queueId: 420,
              description: "5v5 Ranked Solo games",
            }]),
            { status: 200 },
          ),
        ),
    );

    const name = await riotStaticData.getQueueNameById(420, "en_US");

    assertEquals(name, "5v5 Ranked Solo games");
    assertSpyCalls(getCacheStub, 1);
    assertSpyCalls(upsertCacheStub, 1);
    assertSpyCalls(fetchStub, 1);
  });

  test("ja_JPの代表キューは日本語ユーザー向けの表示名を返す", async () => {
    using getCacheStub = stub(
      dbActions,
      "getRiotStaticDataCache",
      () => Promise.reject(new Error("cache should not be called")),
    );
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );

    const name = await riotStaticData.getQueueNameById(420, "ja_JP");

    assertEquals(name, "ランクソロ/デュオ");
    assertSpyCalls(getCacheStub, 0);
    assertSpyCalls(fetchStub, 0);
  });

  test("ja_JPの代表マップとゲームモードは日本語ユーザー向けの表示名を返す", async () => {
    using getCacheStub = stub(
      dbActions,
      "getRiotStaticDataCache",
      () => Promise.reject(new Error("cache should not be called")),
    );
    using fetchStub = stub(
      globalThis,
      "fetch",
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
    using _getCacheStub = stub(
      dbActions,
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
      dbActions,
      "upsertRiotStaticDataCache",
      () => Promise.resolve(),
    );
    using fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response(null, { status: 500 })),
    );

    const name = await riotStaticData.getMapNameById(11, "en_US");

    assertEquals(name, "Summoner's Rift");
    assertSpyCalls(fetchStub, 1);
  });
});
