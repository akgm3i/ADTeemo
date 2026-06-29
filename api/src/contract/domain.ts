export const lanes = ["Top", "Jungle", "Middle", "Bottom", "Support"] as const;
export type Lane = (typeof lanes)[number];

export const riotPlatforms = [
  "br1",
  "eun1",
  "euw1",
  "jp1",
  "kr",
  "la1",
  "la2",
  "na1",
  "oc1",
  "tr1",
  "ru",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
] as const;
export type RiotPlatform = (typeof riotPlatforms)[number];

export const riotRegions = ["americas", "asia", "europe", "sea"] as const;
export type RiotRegion = (typeof riotRegions)[number];

export const matchWatcherStates = [
  "IDLE",
  "IN_GAME",
  "FETCHING_RESULT",
] as const;
export type MatchWatcherState = (typeof matchWatcherStates)[number];

export const rankedQueueTypes = [
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
] as const;
export type RankedQueueType = (typeof rankedQueueTypes)[number];

export const rankSnapshotPhases = ["before", "after"] as const;
export type RankSnapshotPhase = (typeof rankSnapshotPhases)[number];

export const externalMatchProviders = ["opgg"] as const;
export type ExternalMatchProvider = (typeof externalMatchProviders)[number];
