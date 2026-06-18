type ProfileAccount = {
  gameName: string;
  tagLine: string;
  platform: string;
};

const OP_GG_REGION_BY_PLATFORM: Record<string, string> = {
  BR1: "br",
  EUN1: "eune",
  EUW1: "euw",
  JP1: "jp",
  KR: "kr",
  LA1: "lan",
  LA2: "las",
  NA1: "na",
  OC1: "oce",
  PH2: "ph",
  RU: "ru",
  SG2: "sg",
  TH2: "th",
  TR1: "tr",
  TW2: "tw",
  VN2: "vn",
};

export function buildOpGgSummonerUrl(account: ProfileAccount) {
  const gameName = account.gameName.trim();
  const tagLine = account.tagLine.trim();
  const platform = account.platform.trim().toUpperCase();
  const region = OP_GG_REGION_BY_PLATFORM[platform];

  if (!gameName || !tagLine || !region) return null;

  return `https://www.op.gg/summoners/${region}/${
    encodeURIComponent(`${gameName}-${tagLine}`)
  }`;
}

export function formatProfileLinks(account: ProfileAccount) {
  const opGgUrl = buildOpGgSummonerUrl(account);
  if (!opGgUrl) return null;

  return `[OP.GG](${opGgUrl})`;
}
