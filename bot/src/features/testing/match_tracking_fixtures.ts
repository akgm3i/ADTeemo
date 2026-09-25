import type {
  MatchRankSnapshot,
  MatchWatcher,
  RiotAccount,
  RiotMatch,
} from "@adteemo/api/contract";
export const trackingNow = new Date("2026-01-01T00:05:00.000Z");
export function watcher(overrides: Partial<MatchWatcher> = {}): MatchWatcher {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    guildId: "guild-1",
    targetDiscordId: "target-1",
    riotAccountPuuid: "puuid-1",
    requesterId: "requester-1",
    channelId: "channel-1",
    enabled: true,
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    currentNotificationMessageId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    gameStartedAt: null,
    lastCheckedAt: null,
    lastInGameNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function account(overrides: Partial<RiotAccount> = {}): RiotAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    discordId: "target-1",
    isMain: true,
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

export function activeGame(gameId = 12345) {
  return {
    gameId,
    gameType: "MATCHED_GAME",
    gameStartTime: trackingNow.getTime() - 120_000,
    gameLength: 120,
    mapId: 11,
    gameMode: "CLASSIC",
    gameQueueConfigId: 420,
    participants: [{
      puuid: "puuid-1",
      championId: 17,
      teamId: 100,
    }],
  };
}

export function activeGameWithParticipants(puuids: string[], gameId = 12345) {
  return {
    ...activeGame(gameId),
    participants: puuids.map((puuid, index) => ({
      puuid,
      championId: 17 + index,
      teamId: 100,
    })),
  };
}

export function match(): RiotMatch {
  return {
    metadata: {
      matchId: "JP1_12345",
      participants: ["puuid-1"],
    },
    info: {
      gameId: 12345,
      gameCreation: trackingNow.getTime() - 2_000_000,
      gameDuration: 1800,
      gameEndTimestamp: trackingNow.getTime(),
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
        totalDamageDealtToChampions: 23456,
        visionScore: 20,
        totalEnemyJungleMinionsKilled: 7,
        teamPosition: "TOP",
        individualPosition: "TOP",
      }],
    },
  };
}

export function resolvedRiotStaticData() {
  return {
    success: true as const,
    data: {
      champions: {
        "17": {
          name: "ティーモ",
          iconUrl:
            "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Teemo.png",
        },
        "18": {
          name: "トリスターナ",
          iconUrl:
            "https://ddragon.leagueoflegends.com/cdn/16.12.1/img/champion/Tristana.png",
        },
      },
      queues: { "420": "ランクソロ/デュオ" },
      maps: { "11": "サモナーズリフト" },
      gameModes: { CLASSIC: "クラシック" },
    },
  };
}

export function rankSnapshot(
  overrides: Partial<MatchRankSnapshot> = {},
): MatchRankSnapshot {
  return {
    id: 0,
    matchId: "JP1_12345",
    platform: "jp1",
    puuid: "puuid-1",
    queueType: "RANKED_SOLO_5x5",
    phase: "before",
    tier: "EMERALD",
    rank: "IV",
    leaguePoints: 2,
    wins: 10,
    losses: 8,
    fetchedAt: trackingNow,
    ...overrides,
  };
}
