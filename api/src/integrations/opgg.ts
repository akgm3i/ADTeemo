import type { RiotAccount } from "../db/schema.ts";

type RiotMatch = {
  metadata: {
    matchId: string;
  };
  info: {
    gameCreation: number;
    gameDuration: number;
    queueId: number;
    participants: {
      puuid: string;
      championId?: number;
      championName?: string;
    }[];
  };
};

type ActionName = "getGames" | "renewal" | "renewalStatus" | "getGame";
type ActionIds = Record<ActionName, string>;

type OpggGameCandidate = {
  id: string;
  createdAt: Date;
  raw: Record<string, unknown>;
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

type ResolveOptions = {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const OPGG_ORIGIN = "https://op.gg";
const DEFAULT_LOCALE = "ja";
const MATCH_CREATED_AT_TOLERANCE_MS = 120_000;
const ACTION_REQUEST_TIMEOUT_MS = 8_000;
const RENEWAL_STATUS_DELAY_MS = 3_000;
const RENEWAL_SUPPRESSION_MS = 5 * 60_000;
const ACTION_NAMES: ActionName[] = [
  "getGames",
  "renewal",
  "renewalStatus",
  "getGame",
];

let cachedActionIds: ActionIds | null = null;
const renewalSuppressions = new Map<string, number>();

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function riotPlatformToOpggRegion(platform: string) {
  const map: Record<string, string> = {
    br1: "br",
    eun1: "eune",
    euw1: "euw",
    jp1: "jp",
    kr: "kr",
    la1: "lan",
    la2: "las",
    na1: "na",
    oc1: "oce",
    tr1: "tr",
    ru: "ru",
    ph2: "ph",
    sg2: "sg",
    th2: "th",
    tw2: "tw",
    vn2: "vn",
  };
  return map[platform.toLowerCase()] ?? platform.toLowerCase();
}

export function summonerSlug(gameName: string, tagLine: string) {
  return encodeURIComponent(`${gameName}-${tagLine}`);
}

function profileUrl(locale: string, region: string, slug: string) {
  return `${OPGG_ORIGIN}/${locale}/lol/summoners/${region}/${slug}`;
}

export function buildOpggMatchDetailUrl(input: {
  locale?: string;
  region: string;
  slug: string;
  providerMatchId: string;
  createdAtMs: number;
}) {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return `${OPGG_ORIGIN}/${locale}/lol/summoners/${input.region}/${input.slug}/matches/${input.providerMatchId}/${input.createdAtMs}`;
}

function absoluteUrl(url: string, baseUrl: string) {
  return new URL(url, baseUrl).toString();
}

function extractScriptUrls(html: string, baseUrl: string) {
  return [...html.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/g)]
    .map((match) => absoluteUrl(match[1], baseUrl));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function nearestActionId(text: string, actionName: ActionName) {
  const actionMatches = [...text.matchAll(
    new RegExp(`(?<![A-Za-z0-9_])${actionName}(?![A-Za-z0-9_])`, "gi"),
  )];
  const idMatches = [...text.matchAll(/[0-9a-f]{40}/gi)];
  let best: { id: string; distance: number } | null = null;
  let ambiguous = false;

  for (const actionMatch of actionMatches) {
    const actionStart = actionMatch.index;
    const actionEnd = actionStart + actionMatch[0].length;
    for (const idMatch of idMatches) {
      const idStart = idMatch.index;
      const idEnd = idStart + idMatch[0].length;
      const distance = idEnd <= actionStart
        ? actionStart - idEnd
        : idStart - actionEnd;
      if (distance < 0 || distance > 800) continue;
      if (!best || distance < best.distance) {
        best = { id: idMatch[0], distance };
        ambiguous = false;
      } else if (distance === best.distance && idMatch[0] !== best.id) {
        ambiguous = true;
      }
    }
  }

  return ambiguous ? null : best?.id ?? null;
}

function extractActionIdsFromText(text: string): Partial<ActionIds> {
  const ids: Partial<ActionIds> = {};
  for (const actionName of ACTION_NAMES) {
    const id = nearestActionId(text, actionName);
    if (id) {
      ids[actionName] = id;
    }
  }
  return ids;
}

function completeActionIds(ids: Partial<ActionIds>): ids is ActionIds {
  return ACTION_NAMES.every((actionName) =>
    typeof ids[actionName] === "string"
  );
}

function parseRenewalAllowed(html: string) {
  if (
    /"isRenewable"\s*:\s*true/.test(html) ||
    /"renewable"\s*:\s*true/.test(html) ||
    /"canRenew"\s*:\s*true/.test(html) ||
    /data-renewable=["']true["']/.test(html) ||
    /RENEWAL_AVAILABLE/.test(html)
  ) {
    return true;
  }
  if (
    /"isRenewable"\s*:\s*false/.test(html) ||
    /"renewable"\s*:\s*false/.test(html) ||
    /"canRenew"\s*:\s*false/.test(html) ||
    /data-renewable=["']false["']/.test(html)
  ) {
    return false;
  }
  return null;
}

class OpggHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`OP.GG request failed: ${status}`);
    this.name = "OpggHttpError";
  }
}

function isStaleActionIdError(error: unknown) {
  return error instanceof OpggHttpError &&
    error.status === 404 &&
    /Failed to find Server Action|Server Action(?: ["'][^"']+["'])? (?:was )?not found/i
      .test(error.responseBody);
}

async function fetchText(
  fetcher: typeof fetch,
  url: string,
  init?: RequestInit,
) {
  const signal = AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS);
  const response = await fetcher(url, { ...init, signal });
  if (!response.ok) {
    throw new OpggHttpError(response.status, await response.text());
  }
  return await response.text();
}

async function resolveActionIds(
  fetcher: typeof fetch,
  url: string,
): Promise<{ ids: ActionIds; renewalAllowed: boolean | null }> {
  const html = await fetchText(fetcher, url);
  const chunkUrls = unique(extractScriptUrls(html, url));
  const ids: Partial<ActionIds> = extractActionIdsFromText(html);

  for (const chunkUrl of chunkUrls) {
    if (completeActionIds(ids)) break;
    const chunkText = await fetchText(fetcher, chunkUrl);
    Object.assign(ids, extractActionIdsFromText(chunkText));
  }

  if (!completeActionIds(ids)) {
    throw new Error("OP.GG action IDs could not be resolved");
  }

  return { ids, renewalAllowed: parseRenewalAllowed(html) };
}

async function actionIds(fetcher: typeof fetch, url: string) {
  if (cachedActionIds) {
    return { ids: cachedActionIds, renewalAllowed: null };
  }
  const resolved = await resolveActionIds(fetcher, url);
  cachedActionIds = resolved.ids;
  return resolved;
}

async function callServerAction(
  fetcher: typeof fetch,
  profile: string,
  actionId: string,
  payload: unknown,
) {
  return await fetchText(fetcher, profile, {
    method: "POST",
    headers: {
      "Accept": "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
    },
    body: JSON.stringify([payload]),
  });
}

async function callResolvedAction(
  fetcher: typeof fetch,
  profile: string,
  actionName: ActionName,
  payload: unknown,
) {
  const first = await actionIds(fetcher, profile);
  try {
    return await callServerAction(
      fetcher,
      profile,
      first.ids[actionName],
      payload,
    );
  } catch (error) {
    if (!isStaleActionIdError(error)) {
      throw error;
    }
    cachedActionIds = null;
    const resolved = await actionIds(fetcher, profile);
    return await callServerAction(
      fetcher,
      profile,
      resolved.ids[actionName],
      payload,
    );
  }
}

function parseJsonFragments(text: string) {
  const values: unknown[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const start = text[index];
    if (start !== "{" && start !== "[") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{" || char === "[") depth += 1;
      if (char === "}" || char === "]") depth -= 1;
      if (depth !== 0) continue;

      try {
        values.push(JSON.parse(text.slice(index, cursor + 1)));
        index = cursor;
      } catch {
        // Next.js RSCにはJSON断片以外の構造も混ざるため、失敗断片は無視する。
      }
      break;
    }
  }
  return values;
}

function walk(value: unknown, visit: (value: unknown) => void) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function numberValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function opggGamesFromActionText(text: string) {
  const candidates: OpggGameCandidate[] = [];
  for (const fragment of parseJsonFragments(text)) {
    walk(fragment, (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      const id = stringValue(record, ["id", "game_id", "gameId"]);
      const createdAt = stringValue(record, [
        "created_at",
        "createdAt",
        "createdAtText",
      ]);
      if (!id || !createdAt) return;
      const parsedCreatedAt = new Date(createdAt);
      if (Number.isNaN(parsedCreatedAt.getTime())) return;
      candidates.push({ id, createdAt: parsedCreatedAt, raw: record });
    });
  }
  return candidates;
}

function records(value: unknown) {
  const found: Record<string, unknown>[] = [];
  walk(value, (candidate) => {
    if (
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ) {
      found.push(candidate as Record<string, unknown>);
    }
  });
  return found;
}

function participantRecord(raw: Record<string, unknown>, puuid: string) {
  return records(raw).find((record) =>
    stringValue(record, ["puuid"]) === puuid
  );
}

function candidatePuuidMatch(candidate: OpggGameCandidate, puuid: string) {
  return Boolean(
    stringValue(candidate.raw, ["puuid"]) === puuid ||
      participantRecord(candidate.raw, puuid),
  );
}

function candidateQueueMatch(candidate: OpggGameCandidate, queueId: number) {
  const queue = numberValue(candidate.raw, ["queue_id", "queueId"]);
  return queue === null ? false : queue === queueId;
}

function candidateChampionMatch(
  candidate: OpggGameCandidate,
  participant: RiotMatch["info"]["participants"][number],
) {
  const participantCandidate =
    participantRecord(candidate.raw, participant.puuid) ??
      candidate.raw;
  const championId = numberValue(participantCandidate, [
    "champion_id",
    "championId",
  ]);
  if (championId !== null && participant.championId !== undefined) {
    return championId === participant.championId;
  }
  const championName = stringValue(participantCandidate, [
    "champion_name",
    "championName",
  ]);
  return championName !== null && participant.championName !== undefined
    ? championName.toLowerCase() === participant.championName.toLowerCase()
    : false;
}

function candidateGameLengthDiff(
  candidate: OpggGameCandidate,
  gameDurationSeconds: number,
) {
  const length = numberValue(candidate.raw, [
    "game_length_second",
    "gameLengthSecond",
    "game_length",
    "gameLength",
    "duration",
  ]);
  return length === null ? Number.MAX_SAFE_INTEGER : Math.abs(
    length - gameDurationSeconds,
  );
}

export function selectOpggGameCandidate(
  match: RiotMatch,
  account: RiotAccount,
  candidates: OpggGameCandidate[],
) {
  const participant = match.info.participants.find((candidate) =>
    candidate.puuid === account.puuid
  );
  if (!participant) return null;

  const ranked = candidates
    .map((candidate) => {
      const timeDiff = Math.abs(
        candidate.createdAt.getTime() - match.info.gameCreation,
      );
      return {
        candidate,
        timeDiff,
        gameLengthDiff: candidateGameLengthDiff(
          candidate,
          match.info.gameDuration,
        ),
        puuidMatch: candidatePuuidMatch(candidate, account.puuid),
        queueMatch: candidateQueueMatch(candidate, match.info.queueId),
        championMatch: candidateChampionMatch(candidate, participant),
      };
    })
    .filter(({ timeDiff, puuidMatch, queueMatch, championMatch }) =>
      timeDiff <= MATCH_CREATED_AT_TOLERANCE_MS &&
      puuidMatch &&
      queueMatch &&
      championMatch
    )
    .sort((left, right) =>
      left.timeDiff - right.timeDiff ||
      left.gameLengthDiff - right.gameLengthDiff
    );

  if (ranked.length === 0) return null;
  const [best, second] = ranked;
  if (
    second &&
    best.timeDiff === second.timeDiff &&
    best.gameLengthDiff === second.gameLengthDiff
  ) {
    return null;
  }
  return best.candidate;
}

function detailFromActionText(
  text: string,
  account: RiotAccount,
  fallback: OpggMatchDetail,
) {
  let averageTier: string | null = null;
  let participant = fallback.participant;
  for (const fragment of parseJsonFragments(text)) {
    for (const record of records(fragment)) {
      averageTier ??= stringValue(record, ["average_tier", "averageTier"]);
      if (stringValue(record, ["puuid"]) !== account.puuid) continue;
      participant = {
        puuid: account.puuid,
        participantId: numberValue(record, ["participant_id", "participantId"]),
        laneScore: numberValue(record, ["lane_score", "laneScore"]),
      };
    }
  }

  return {
    ...fallback,
    averageTier: averageTier ?? fallback.averageTier,
    participant,
  };
}

async function fetchProfileRenewalAllowed(fetcher: typeof fetch, url: string) {
  const html = await fetchText(fetcher, url);
  return parseRenewalAllowed(html);
}

function renewalKey(region: string, puuid: string) {
  return `${region}:${puuid}`;
}

function isRenewalSuppressed(region: string, puuid: string, now = Date.now()) {
  const key = renewalKey(region, puuid);
  const lastRenewal = renewalSuppressions.get(key);
  return lastRenewal !== undefined &&
    now - lastRenewal < RENEWAL_SUPPRESSION_MS;
}

function recordRenewal(region: string, puuid: string, now = Date.now()) {
  const key = renewalKey(region, puuid);
  renewalSuppressions.set(key, now);
}

function renewalFinished(text: string) {
  return text.includes("RENEWAL_FINISH");
}

async function getGames(
  fetcher: typeof fetch,
  profile: string,
  region: string,
  puuid: string,
) {
  const text = await callResolvedAction(fetcher, profile, "getGames", {
    locale: DEFAULT_LOCALE,
    region,
    puuid,
    gameType: "TOTAL",
    endedAt: "",
    champion: "",
  });
  return opggGamesFromActionText(text);
}

async function resolveMatchDetail(
  account: RiotAccount,
  match: RiotMatch,
  options: ResolveOptions = {},
): Promise<OpggMatchDetail | null> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const region = riotPlatformToOpggRegion(account.platform);
  const slug = summonerSlug(account.gameName, account.tagLine);
  const profile = profileUrl(DEFAULT_LOCALE, region, slug);

  let candidates = await getGames(fetcher, profile, region, account.puuid);
  let candidate = selectOpggGameCandidate(match, account, candidates);

  if (!candidate && !isRenewalSuppressed(region, account.puuid)) {
    const renewalAllowed = await fetchProfileRenewalAllowed(fetcher, profile);
    if (renewalAllowed) {
      recordRenewal(region, account.puuid);
      await callResolvedAction(fetcher, profile, "renewal", {
        region,
        puuid: account.puuid,
        isPremiumPrimary: false,
      });
      await sleep(RENEWAL_STATUS_DELAY_MS);
      const statusText = await callResolvedAction(
        fetcher,
        profile,
        "renewalStatus",
        { region, puuid: account.puuid },
      );
      if (renewalFinished(statusText)) {
        candidates = await getGames(fetcher, profile, region, account.puuid);
        candidate = selectOpggGameCandidate(match, account, candidates);
      }
    }
  }

  if (!candidate) return null;

  const detailUrl = buildOpggMatchDetailUrl({
    region,
    slug,
    providerMatchId: candidate.id,
    createdAtMs: candidate.createdAt.getTime(),
  });
  const fallback: OpggMatchDetail = {
    provider: "opgg",
    providerRegion: region,
    providerMatchId: candidate.id,
    detailUrl,
    providerCreatedAt: candidate.createdAt,
    averageTier: null,
    participant: {
      puuid: account.puuid,
      participantId: numberValue(
        participantRecord(candidate.raw, account.puuid) ?? candidate.raw,
        ["participant_id", "participantId"],
      ),
      laneScore: numberValue(
        participantRecord(candidate.raw, account.puuid) ?? candidate.raw,
        ["lane_score", "laneScore"],
      ),
    },
  };

  try {
    const detailText = await callResolvedAction(fetcher, profile, "getGame", {
      gameId: candidate.id,
      region,
      createdAt: candidate.createdAt.toISOString(),
      locale: DEFAULT_LOCALE,
    });
    return detailFromActionText(detailText, account, fallback);
  } catch {
    return fallback;
  }
}

export const opggClient = {
  resolveMatchDetail,
};

export function resetOpggClientCacheForTesting() {
  cachedActionIds = null;
  renewalSuppressions.clear();
}
