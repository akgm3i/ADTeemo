import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import type {
  ActiveGame,
  LeagueEntry,
  MatchRankSnapshot,
  RiotAccount,
  RiotMatch,
} from "../contract/mod.ts";
import { createMatchTrackingInspectionService } from "./match_tracking.ts";

const account: RiotAccount = {
  isMain: true,
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
const match: RiotMatch = {
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
const beforeSnapshot: MatchRankSnapshot = {
  id: 1,
  matchId: "JP1_12345",
  puuid: "puuid-1",
  platform: "jp1",
  queueType: "RANKED_SOLO_5x5",
  phase: "before",
  tier: "EMERALD",
  rank: "IV",
  leaguePoints: 19,
  wins: 11,
  losses: 8,
  fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const afterSnapshot: MatchRankSnapshot = {
  ...beforeSnapshot,
  id: 2,
  phase: "after",
  leaguePoints: 37,
  fetchedAt: new Date("2026-01-01T00:05:00.000Z"),
};

describe("services/match_tracking.ts", () => {
  test("Active Game検査ではaccountと進行中試合だけを取得し、rank取得や通知判断を行わない", async () => {
    // Arrange
    const calls: unknown[] = [];
    const unexpected = (): never => {
      throw new Error("Unexpected enrichment");
    };
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: (...args) => {
          calls.push(args);
          return Promise.resolve(account);
        },
        finalizeMatchRankSnapshots: unexpected,
      },
      riotApi: {
        getActiveGameByPuuid: (...args) => {
          calls.push(args);
          return Promise.resolve(activeGame);
        },
        getLeagueEntriesByPuuid: unexpected,
        getMatchById: unexpected,
      },
      opggMatchDetailService: { resolveAndSave: unexpected },
      logger: { warn() {} },
    });

    // Act
    const result = await service.inspectActiveGame({
      guildId: "guild",
      targetDiscordId: "target-1",
      riotAccountPuuid: "puuid-1",
    });

    // Assert
    assertEquals(result, { status: "ok", account, activeGame });
    assertEquals(calls, [["target-1", "puuid-1"], ["jp1", "puuid-1"]]);
  });

  test("Match-v5に未反映のとき、rankとOP.GGを解決せずmatch nullの観測を返す", async () => {
    // Arrange
    const unexpected = (): never => {
      throw new Error("Unexpected enrichment");
    };
    const calls: unknown[] = [];
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.resolve(account),
        finalizeMatchRankSnapshots: unexpected,
      },
      riotApi: {
        getActiveGameByPuuid: unexpected,
        getLeagueEntriesByPuuid: unexpected,
        getMatchById: (...args) => {
          calls.push(args);
          return Promise.resolve(null);
        },
      },
      opggMatchDetailService: { resolveAndSave: unexpected },
      logger: { warn() {} },
    });

    // Act
    const result = await service.inspectResult({
      guildId: "guild",
      targetDiscordId: "target-1",
      matchId: "JP1_12345",
    });

    // Assert
    assertEquals(result, {
      status: "ok",
      account,
      match: null,
      rankSummary: null,
      opggDetail: null,
    });
    assertEquals(calls, [["asia", "JP1_12345"]]);
  });

  test("結果を取得できると、rank snapshotを確定してOP.GGを解決し取得事実を返す", async () => {
    // Arrange
    const calls: unknown[] = [];
    const at = new Date("2026-01-01T00:05:00Z");
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.resolve(account),
        finalizeMatchRankSnapshots: (payload) => {
          calls.push(["finalize", payload]);
          return Promise.resolve({
            before: [beforeSnapshot],
            after: [afterSnapshot],
          });
        },
      },
      riotApi: {
        getActiveGameByPuuid: () => Promise.resolve(null),
        getLeagueEntriesByPuuid: (...args) => {
          calls.push(["league", ...args]);
          return Promise.resolve(entries);
        },
        getMatchById: (...args) => {
          calls.push(["match", ...args]);
          return Promise.resolve(match);
        },
      },
      opggMatchDetailService: {
        resolveAndSave: (input) => {
          calls.push(["opgg", input.matchId]);
          return Promise.resolve(null);
        },
      },
      logger: { warn() {} },
      clock: { now: () => at },
    });

    // Act
    const result = await service.inspectResult({
      guildId: "guild",
      targetDiscordId: "target-1",
      matchId: "JP1_12345",
    });

    // Assert
    assertEquals(result, {
      status: "ok",
      account,
      match,
      rankSummary: {
        queueType: "RANKED_SOLO_5x5",
        before: beforeSnapshot,
        after: afterSnapshot,
      },
      opggDetail: null,
    });
    assertEquals(calls, [
      ["match", "asia", "JP1_12345"],
      ["league", "jp1", "puuid-1"],
      ["finalize", {
        matchId: "JP1_12345",
        platform: "jp1",
        gameId: "12345",
        puuid: "puuid-1",
        snapshots: [
          { ...entries[0], fetchedAt: at },
          {
            queueType: "RANKED_FLEX_SR",
            tier: null,
            rank: null,
            leaguePoints: null,
            wins: null,
            losses: null,
            fetchedAt: at,
          },
        ],
      }],
      ["opgg", "JP1_12345"],
    ]);
  });
});
