import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import type { RiotAccount } from "@adteemo/api/schema";
import {
  buildOpggMatchDetailUrl,
  opggClient,
  resetOpggClientCacheForTesting,
  riotPlatformToOpggRegion,
  selectOpggGameCandidate,
  summonerSlug,
} from "./opgg.ts";

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

function match() {
  return {
    metadata: {
      matchId: "JP1_12345",
    },
    info: {
      gameCreation: new Date("2026-06-19T00:00:00.000Z").getTime(),
      gameDuration: 1800,
      queueId: 420,
      participants: [{
        puuid: "puuid-1",
        championId: 17,
        championName: "Teemo",
      }],
    },
  };
}

describe("opgg.ts", () => {
  test("RiotアカウントからOP.GGの地域slugとサモナーslugと詳細URLを組み立てる", () => {
    // Arrange / Act
    const region = riotPlatformToOpggRegion("jp1");
    const slug = summonerSlug("Hide on bush", "KR1");
    const url = buildOpggMatchDetailUrl({
      region,
      slug,
      providerMatchId: "opgg-match-1",
      createdAtMs: 1780000000000,
    });

    // Assert
    assertEquals(region, "jp");
    assertEquals(slug, "Hide%20on%20bush-KR1");
    assertEquals(
      url,
      "https://op.gg/ja/lol/summoners/jp/Hide%20on%20bush-KR1/matches/opgg-match-1/1780000000000",
    );
  });

  test("候補が同順位で一意に決まらないとき、誤リンク防止のためnullを返す", () => {
    // Arrange
    const createdAt = new Date("2026-06-19T00:00:00.000Z");
    const candidates = [
      {
        id: "opgg-match-1",
        createdAt,
        raw: {
          puuid: "puuid-1",
          queue_id: 420,
          champion_id: 17,
          game_length_second: 1800,
        },
      },
      {
        id: "opgg-match-2",
        createdAt,
        raw: {
          puuid: "puuid-1",
          queue_id: 420,
          champion_id: 17,
          game_length_second: 1800,
        },
      },
    ];

    // Act
    const selected = selectOpggGameCandidate(match(), account(), candidates);

    // Assert
    assertEquals(selected, null);
  });

  test("開始時刻が近くてもPUUIDが一致しないとき、候補を選択しない", () => {
    // Arrange
    const candidates = [{
      id: "opgg-match-1",
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
      raw: {
        puuid: "different-puuid",
        queue_id: 420,
        champion_id: 17,
        game_length_second: 1800,
      },
    }];

    // Act
    const selected = selectOpggGameCandidate(match(), account(), candidates);

    // Assert
    assertEquals(selected, null);
  });

  test("開始時刻が近くてもchampionが一致しないとき、候補を選択しない", () => {
    // Arrange
    const candidates = [{
      id: "opgg-match-1",
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
      raw: {
        puuid: "puuid-1",
        queue_id: 420,
        champion_id: 1,
        game_length_second: 1800,
      },
    }];

    // Act
    const selected = selectOpggGameCandidate(match(), account(), candidates);

    // Assert
    assertEquals(selected, null);
  });

  test("開始時刻が近くてもqueueが一致しないとき、候補を選択しない", () => {
    // Arrange
    const candidates = [{
      id: "opgg-match-1",
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
      raw: {
        puuid: "puuid-1",
        queue_id: 430,
        champion_id: 17,
        game_length_second: 1800,
      },
    }];

    // Act
    const selected = selectOpggGameCandidate(match(), account(), candidates);

    // Assert
    assertEquals(selected, null);
  });

  test("更新不可でrenewalを行わなかったとき、次回の更新確認を抑制しない", async () => {
    // Arrange
    resetOpggClientCacheForTesting();
    const actionIds = {
      getGames: "1111111111111111111111111111111111111111",
      renewal: "2222222222222222222222222222222222222222",
      renewalStatus: "3333333333333333333333333333333333333333",
      getGame: "4444444444444444444444444444444444444444",
    };
    let profileGetCount = 0;
    let renewalCount = 0;
    const fetcher: typeof fetch = ((_input: string | URL | Request, init) => {
      const nextAction = init?.headers instanceof Headers
        ? init.headers.get("Next-Action")
        : (init?.headers as Record<string, string> | undefined)?.[
          "Next-Action"
        ] ?? null;

      if (init?.method === "POST") {
        if (nextAction === actionIds.getGames) {
          return Promise.resolve(new Response(JSON.stringify({ data: [] })));
        }
        if (nextAction === actionIds.renewal) {
          renewalCount += 1;
          return Promise.resolve(new Response("RENEWAL_STARTED"));
        }
        if (nextAction === actionIds.renewalStatus) {
          return Promise.resolve(new Response("RENEWAL_PENDING"));
        }
      }

      profileGetCount += 1;
      const renewalAllowed = profileGetCount >= 3;
      return Promise.resolve(
        new Response(`
          <html>
            <script>
              export const getGames = "${actionIds.getGames}";
              export const renewal = "${actionIds.renewal}";
              export const renewalStatus = "${actionIds.renewalStatus}";
              export const getGame = "${actionIds.getGame}";
              window.__OPGG__ = {"isRenewable":${renewalAllowed}};
            </script>
          </html>
        `),
      );
    }) as typeof fetch;

    // Act
    await opggClient.resolveMatchDetail(account(), match(), {
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await opggClient.resolveMatchDetail(account(), match(), {
      fetcher,
      sleep: () => Promise.resolve(),
    });

    // Assert
    assertEquals(profileGetCount, 3);
    assertEquals(renewalCount, 1);
  });

  test("初回実行時にHTMLとchunkからAction IDを抽出し、OP.GG詳細を正規化する", async () => {
    // Arrange
    resetOpggClientCacheForTesting();
    const actionIds = {
      getGames: "1111111111111111111111111111111111111111",
      renewal: "2222222222222222222222222222222222222222",
      renewalStatus: "3333333333333333333333333333333333333333",
      getGame: "4444444444444444444444444444444444444444",
    };
    const calls: { url: string; nextAction: string | null }[] = [];
    const fetcher: typeof fetch = ((input: string | URL | Request, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const nextAction = init?.headers instanceof Headers
        ? init.headers.get("Next-Action")
        : (init?.headers as Record<string, string> | undefined)?.[
          "Next-Action"
        ] ?? null;
      calls.push({ url, nextAction });

      if (init?.method === "POST" && nextAction === actionIds.getGames) {
        return Promise.resolve(
          new Response(JSON.stringify({
            data: [{
              id: "opgg-match-1",
              created_at: "2026-06-19T00:00:00.000Z",
              puuid: "puuid-1",
              queue_id: 420,
              champion_id: 17,
              game_length_second: 1800,
              participant_id: 3,
            }],
          })),
        );
      }
      if (init?.method === "POST" && nextAction === actionIds.getGame) {
        return Promise.resolve(
          new Response(JSON.stringify({
            average_tier: "Emerald",
            participants: [{
              puuid: "puuid-1",
              participant_id: 3,
              lane_score: 7.2,
            }],
          })),
        );
      }
      if (url.endsWith("/action.js")) {
        return Promise.resolve(
          new Response(`
            export const getGames = "${actionIds.getGames}";
            export const renewal = "${actionIds.renewal}";
            export const renewalStatus = "${actionIds.renewalStatus}";
            export const getGame = "${actionIds.getGame}";
          `),
        );
      }
      return Promise.resolve(
        new Response(`
          <html>
            <script src="/action.js"></script>
            <script>window.__OPGG__ = {"isRenewable":false}</script>
          </html>
        `),
      );
    }) as typeof fetch;

    // Act
    const detail = await opggClient.resolveMatchDetail(
      account(),
      match(),
      { fetcher },
    );

    // Assert
    assertEquals(detail?.provider, "opgg");
    assertEquals(detail?.providerRegion, "jp");
    assertEquals(detail?.providerMatchId, "opgg-match-1");
    assertEquals(detail?.averageTier, "Emerald");
    assertEquals(detail?.participant?.participantId, 3);
    assertEquals(detail?.participant?.laneScore, 7.2);
    assertStringIncludes(
      detail?.detailUrl ?? "",
      "/matches/opgg-match-1/1781827200000",
    );
    assertEquals(
      calls.some((call) => call.nextAction === actionIds.getGames),
      true,
    );
    assertEquals(
      calls.some((call) => call.nextAction === actionIds.getGame),
      true,
    );
  });
});
