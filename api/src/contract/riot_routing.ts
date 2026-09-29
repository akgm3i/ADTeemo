export const riotRegions = ["americas", "asia", "europe", "sea"] as const;
export type RiotRegion = (typeof riotRegions)[number];

// Current platform routes; historical identifiers remain valid below.
// https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends
export const riotRouting = {
  br1: { region: "americas", opggRegion: "br" },
  eun1: { region: "europe", opggRegion: "eune" },
  euw1: { region: "europe", opggRegion: "euw" },
  jp1: { region: "asia", opggRegion: "jp" },
  kr: { region: "asia", opggRegion: "kr" },
  la1: { region: "americas", opggRegion: "lan" },
  la2: { region: "americas", opggRegion: "las" },
  na1: { region: "americas", opggRegion: "na" },
  oc1: { region: "sea", opggRegion: "oce" },
  tr1: { region: "europe", opggRegion: "tr" },
  ru: { region: "europe", opggRegion: "ru" },
  sg2: { region: "sea", opggRegion: "sg" },
  tw2: { region: "sea", opggRegion: "tw" },
  vn2: { region: "sea", opggRegion: "vn" },
} as const satisfies Record<string, { region: RiotRegion; opggRegion: string }>;

export type CurrentRiotPlatform = keyof typeof riotRouting;
export const currentRiotPlatforms = Object.keys(riotRouting) as [
  CurrentRiotPlatform,
  ...CurrentRiotPlatform[],
];
export const legacyRiotPlatforms = ["ph2", "th2"] as const;
export const riotPlatforms = [
  ...currentRiotPlatforms,
  ...legacyRiotPlatforms,
] as const;
export type RiotPlatform = (typeof riotPlatforms)[number];
export const defaultRiotPlatform: CurrentRiotPlatform = "jp1";

export function isRiotPlatform(value: string): value is RiotPlatform {
  return riotPlatforms.includes(value as RiotPlatform);
}

export function canonicalRiotPlatform(
  platform: RiotPlatform,
): CurrentRiotPlatform {
  return platform === "ph2" || platform === "th2" ? "sg2" : platform;
}

export function riotRegionForPlatform(platform: RiotPlatform): RiotRegion {
  return riotRouting[canonicalRiotPlatform(platform)].region;
}

// A match ID identifies historical data, so never canonicalize its prefix.
export function riotPlatformForMatchId(
  matchId: string,
): RiotPlatform | undefined {
  const separator = matchId.indexOf("_");
  if (separator < 0 || separator === matchId.length - 1) return undefined;
  const platform = matchId.slice(0, separator).toLowerCase();
  return isRiotPlatform(platform) ? platform : undefined;
}
