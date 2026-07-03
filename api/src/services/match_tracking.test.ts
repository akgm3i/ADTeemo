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
        finalizeMatchRankSnapshots: () =>
          Promise.resolve({ before: [], after: [] }),
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
        getMatchById: () => Promise.resolve(null),
      },
      opggMatchDetailService: {
        resolveAndSave: () => Promise.resolve(null),
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
        finalizeMatchRankSnapshots: () =>
          Promise.resolve({ before: [], after: [] }),
      },
      riotApi: {
        getActiveGameByPuuid: () => Promise.resolve(activeGame),
        getLeagueEntriesByPuuid: () => {
          calls.push("leagueEntries");
          return Promise.resolve(entries);
        },
        getMatchById: () => Promise.resolve(null),
      },
      opggMatchDetailService: {
        resolveAndSave: () => Promise.resolve(null),
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

  test("結果取得待ちの試合がMatch-v5に未反映のとき、rankとOP.GGを解決せずmatch nullを返す", async () => {
    const calls: string[] = [];
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.resolve(account),
        upsertPendingRankSnapshots: () => Promise.resolve(),
        finalizeMatchRankSnapshots: () => {
          calls.push("finalizeSnapshots");
          return Promise.resolve({ before: [], after: [] });
        },
      },
      riotApi: {
        getActiveGameByPuuid: () => Promise.resolve(null),
        getLeagueEntriesByPuuid: () => {
          calls.push("leagueEntries");
          return Promise.resolve(entries);
        },
        getMatchById: (region, matchId) => {
          calls.push(`match:${region}:${matchId}`);
          return Promise.resolve(null);
        },
      },
      opggMatchDetailService: {
        resolveAndSave: () => {
          calls.push("opgg");
          return Promise.resolve(null);
        },
      },
      logger: { warn: () => {} },
    });

    const result = await service.inspectResult({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      matchId: "JP1_12345",
    });

    assertEquals(result, {
      status: "ok",
      account,
      match: null,
      rankSummary: null,
      opggDetail: null,
    });
    assertEquals(calls, ["match:asia:JP1_12345"]);
  });

  test("結果取得待ちの試合がMatch-v5で取得できると、rank snapshotを確定しOP.GG詳細を解決して返す", async () => {
    const calls: string[] = [];
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
    const service = createMatchTrackingInspectionService({
      dbActions: {
        getRiotAccountByDiscordId: () => Promise.resolve(account),
        upsertPendingRankSnapshots: () => Promise.resolve(),
        finalizeMatchRankSnapshots: (payload) => {
          calls.push(`finalize:${payload.matchId}:${payload.puuid}`);
          return Promise.resolve({
            before: [beforeSnapshot],
            after: [afterSnapshot],
          });
        },
      },
      riotApi: {
        getActiveGameByPuuid: () => Promise.resolve(null),
        getLeagueEntriesByPuuid: (platform, puuid) => {
          calls.push(`leagueEntries:${platform}:${puuid}`);
          return Promise.resolve(entries);
        },
        getMatchById: (region, matchId) => {
          calls.push(`match:${region}:${matchId}`);
          return Promise.resolve(match);
        },
      },
      opggMatchDetailService: {
        resolveAndSave: (payload) => {
          calls.push(
            `opgg:${payload.matchId}:${payload.match.participant.puuid}`,
          );
          return Promise.resolve(opggDetail);
        },
      },
      logger: { warn: () => {} },
      clock: { now: () => new Date("2026-01-01T00:05:00.000Z") },
    });

    const result = await service.inspectResult({
      guildId: "guild-1",
      targetDiscordId: "target-1",
      matchId: "JP1_12345",
    });

    assertEquals(result, {
      status: "ok",
      account,
      match,
      rankSummary: {
        queueType: "RANKED_SOLO_5x5",
        before: beforeSnapshot,
        after: afterSnapshot,
      },
      opggDetail,
    });
    assertEquals(calls, [
      "match:asia:JP1_12345",
      "leagueEntries:jp1:puuid-1",
      "finalize:JP1_12345:puuid-1",
      "opgg:JP1_12345:puuid-1",
    ]);
  });
});
