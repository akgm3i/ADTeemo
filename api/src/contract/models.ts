import type {
  ExternalMatchProvider,
  MatchWatcherState,
  RankedQueueType,
  RankSnapshotPhase,
  RiotPlatform,
  RiotRegion,
} from "./domain.ts";

export type Event = {
  id: number;
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  scheduledStartAt: Date;
  createdAt: Date;
};

export type RiotAccount = {
  discordId: string;
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: RiotPlatform;
  region: RiotRegion;
  createdAt: Date;
  updatedAt: Date | null;
};

export type MatchWatcher = {
  guildId: string;
  targetDiscordId: string;
  requesterId: string;
  channelId: string;
  enabled: boolean;
  lastState: MatchWatcherState;
  currentGameId: string | null;
  currentMatchId: string | null;
  currentNotificationMessageId: string | null;
  pendingResultMatchId: string | null;
  pendingResultNotificationMessageId: string | null;
  pendingResultStartedAt: Date | null;
  gameStartedAt: Date | null;
  lastCheckedAt: Date | null;
  lastInGameNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

export type MatchWatcherStatePatch = {
  lastState: MatchWatcherState;
  currentGameId?: string | null;
  currentMatchId?: string | null;
  currentNotificationMessageId?: string | null;
  pendingResultMatchId?: string | null;
  pendingResultNotificationMessageId?: string | null;
  pendingResultStartedAt?: Date | null;
  gameStartedAt?: Date | null;
  lastCheckedAt?: Date | null;
  lastInGameNotifiedAt?: Date | null;
};

export type PendingMatchRankSnapshot = {
  platform: RiotPlatform;
  gameId: string;
  puuid: string;
  queueType: RankedQueueType;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
  expiresAt: Date;
};

export type MatchRankSnapshot = {
  id: number;
  matchId: string;
  puuid: string;
  platform: RiotPlatform;
  queueType: RankedQueueType;
  phase: RankSnapshotPhase;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
};

export type MatchTrackingRankSummary = {
  queueType: RankedQueueType;
  before: MatchRankSnapshot | null;
  after: MatchRankSnapshot | null;
};

export type ExternalMatchDetail = {
  matchId: string;
  provider: ExternalMatchProvider;
  providerRegion: string;
  providerMatchId: string;
  detailUrl: string;
  providerCreatedAt: Date;
  averageTier: string | null;
  fetchedAt: Date;
};

export type ExternalMatchParticipantDetail = {
  matchId: string;
  provider: ExternalMatchProvider;
  puuid: string;
  participantId: number | null;
  laneScore: number | null;
  fetchedAt: Date;
};

export type OpggMatchDetail = {
  provider: "opgg";
  providerRegion: string;
  providerMatchId: string;
  detailUrl: string;
  providerCreatedAt: Date;
  averageTier: string | null;
  participant?: {
    puuid: string;
    participantId: number | null;
    laneScore: number | null;
  };
};

export type RiotStaticDataResolveData = {
  champions: Record<string, { name: string | null; iconUrl: string | null }>;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};

export type ActiveGame = {
  gameId: number;
  gameType: string;
  gameStartTime: number;
  mapId: number;
  gameLength?: number;
  gameMode: string;
  gameQueueConfigId?: number;
  participants: {
    puuid?: string;
    summonerName?: string;
    riotId?: string;
    championId: number;
    teamId: number;
  }[];
};

export type RiotMatch = {
  metadata: {
    matchId: string;
    participants: string[];
  };
  info: {
    gameId: number;
    gameCreation: number;
    gameDuration: number;
    gameEndTimestamp?: number;
    gameMode: string;
    gameType: string;
    mapId: number;
    queueId: number;
    participants: {
      puuid: string;
      riotIdGameName?: string;
      riotIdTagline?: string;
      summonerName?: string;
      championId?: number;
      championName: string;
      teamId: number;
      win: boolean;
      kills: number;
      deaths: number;
      assists: number;
      totalMinionsKilled: number;
      neutralMinionsKilled: number;
      goldEarned: number;
      totalDamageDealtToChampions?: number;
      visionScore?: number;
      totalEnemyJungleMinionsKilled?: number;
      teamPosition?: string;
      individualPosition?: string;
    }[];
  };
};

export type LeagueEntry = {
  queueType: string;
  tier?: string;
  rank?: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

export type MatchTrackingNotificationIntent =
  | {
    kind: "started" | "progress";
    activeGame: ActiveGame;
  }
  | {
    kind: "resultPending";
    matchId: string;
  }
  | {
    kind: "result";
    match: RiotMatch;
    rankSummary: MatchTrackingRankSummary | null;
    opggDetail: OpggMatchDetail | null;
  }
  | {
    kind: "timeout";
    matchId: string;
  };

export type MatchTrackingStateTransition = {
  state: MatchWatcherStatePatch;
  messageIdField:
    | "currentNotificationMessageId"
    | "pendingResultNotificationMessageId"
    | null;
};
