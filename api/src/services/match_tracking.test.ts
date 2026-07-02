import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import type { ActiveGame, LeagueEntry, RiotAccount } from "../contract/mod.ts";
import { createMatchTrackingInspectionService } from "./match_tracking.ts";

const account: RiotAccount = {
  discordId: "target-1",
  puuid: "puuid-1",
  gameName: "Teemo",
  tagLine: "JP1",
  platform: "jp1",
  region: "asia",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: null,
};
const activeGame: ActiveGame = {
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
const entries: LeagueEntry[] = [{
  queueType: "RANKED_SOLO_5x5",
  tier: "EMERALD",
  rank: "IV",
  leaguePoints: 19,
  wins: 11,
  losses: 8,
}];

describe("services/match_tracking.ts", () => {
  test("新しいランク対象試合を検知すると、Riot取得後にpending rank snapshotを保存してactiveGameを返す", async () => {
    const calls: string[] = [];
    const savedPayloads: unknown[] = [];
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: (discordId) => {
          calls.push(`account:${discordId}`);
          return Promise.resolve(account);
        },
        upsertPendingRankSnapshots: (payload) => {
          calls.push("saveSnapshots");
          savedPayloads.push(payload);
          return Promise.resolve();
        },
      },
      riotApi: {
        getActiveGameByPuuid: (platform, puuid) => {
          calls.push(`activeGame:${platform}:${puuid}`);
          return Promise.resolve(activeGame);
        },
        getLeagueEntriesByPuuid: (platform, puuid) => {
          calls.push(`leagueEntries:${platform}:${puuid}`);
          return Promise.resolve(entries);
        },
      },
      logger: { warn: () => {} },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    });

    const result = await service.inspectActiveGame({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      lastState: "IDLE",
      currentGameId: null,
    });

    assertEquals(result, { status: "ok", account, activeGame });
    assertEquals(calls, [
      "account:target-1",
      "activeGame:jp1:puuid-1",
      "leagueEntries:jp1:puuid-1",
      "saveSnapshots",
    ]);
    assertEquals(savedPayloads, [{
      platform: "jp1",
      gameId: "12345",
      puuid: "puuid-1",
      snapshots: [{
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 19,
        wins: 11,
        losses: 8,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      }, {
        queueType: "RANKED_FLEX_SR",
        tier: null,
        rank: null,
        leaguePoints: null,
        wins: null,
        losses: null,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      }],
    }]);
  });

  test("同じ進行中試合を再確認すると、pending rank snapshotを保存せずactiveGameを返す", async () => {
    const calls: string[] = [];
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.resolve(account),
        upsertPendingRankSnapshots: () => {
          calls.push("saveSnapshots");
          return Promise.resolve();
        },
      },
      riotApi: {
        getActiveGameByPuuid: () => Promise.resolve(activeGame),
        getLeagueEntriesByPuuid: () => {
          calls.push("leagueEntries");
          return Promise.resolve(entries);
        },
      },
      logger: { warn: () => {} },
    });

    const result = await service.inspectActiveGame({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      lastState: "IN_GAME",
      currentGameId: "12345",
    });

    assertEquals(result, { status: "ok", account, activeGame });
    assertEquals(calls, []);
  });
});
