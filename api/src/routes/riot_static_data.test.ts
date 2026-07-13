import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { createApp } from "../app.ts";
import {
  createTestDependencies,
  TEST_BOT_SERVICE_AUTH_HEADERS,
} from "../test_utils.ts";

describe("POST /riot/static-data/resolve", () => {
  const deps = createTestDependencies();
  const app = createApp(deps);
  const { riotStaticData } = deps;

  test("ロケールと識別子群を指定したとき、解決した静的表示データをまとめて返す", async () => {
    // Arrange
    const resolved = {
      champions: {
        "17": { name: "ティーモ", iconUrl: "https://example.com/Teemo.png" },
      },
      queues: { "420": "ランクソロ/デュオ" },
      maps: { "11": "サモナーズリフト" },
      gameModes: { CLASSIC: "クラシック" },
    };
    using resolveStub = stub(
      riotStaticData,
      "resolve",
      () => Promise.resolve(resolved),
    );

    // Act
    const res = await app.request("/riot/static-data/resolve", {
      method: "POST",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        locale: "ja_JP",
        championIds: [17],
        queueIds: [420],
        mapIds: [11],
        gameModes: ["CLASSIC"],
      }),
    });

    // Assert
    assertEquals(res.status, 200);
    assertEquals(await res.json(), resolved);
    assertSpyCall(resolveStub, 0, {
      args: [{
        locale: "ja_JP",
        championIds: [17],
        queueIds: [420],
        mapIds: [11],
        gameModes: ["CLASSIC"],
      }],
    });
  });

  test("負の識別子を指定したとき、静的データを解決せず400を返す", async () => {
    // Arrange
    using resolveStub = stub(
      riotStaticData,
      "resolve",
      () =>
        Promise.resolve({
          champions: {},
          queues: {},
          maps: {},
          gameModes: {},
        }),
    );

    // Act
    const res = await app.request("/riot/static-data/resolve", {
      method: "POST",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "content-type": "application/json",
      },
      body: JSON.stringify({ championIds: [-1] }),
    });

    // Assert
    assertEquals(res.status, 400);
    assertEquals(await res.json(), {
      error: "Invalid Riot static data resolve request",
    });
    assertSpyCalls(resolveStub, 0);
  });

  test("静的データの取得に失敗したとき、successを含まないエラーと502を返す", async () => {
    // Arrange
    using _resolveStub = stub(
      riotStaticData,
      "resolve",
      () => Promise.reject(new Error("Failed to fetch Riot static data: 503")),
    );

    // Act
    const res = await app.request("/riot/static-data/resolve", {
      method: "POST",
      headers: {
        ...TEST_BOT_SERVICE_AUTH_HEADERS,
        "content-type": "application/json",
      },
      body: JSON.stringify({ championIds: [17] }),
    });

    // Assert
    assertEquals(res.status, 502);
    assertEquals(await res.json(), {
      error: "Failed to fetch Riot static data: 503",
    });
  });
});
