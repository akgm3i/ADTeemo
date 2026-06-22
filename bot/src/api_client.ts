import type { Lane } from "@adteemo/api/schema";
import type {
  MatchWatcher,
  MatchWatcherState,
  RiotAccount,
  RiotPlatform,
  RiotRegion,
} from "@adteemo/api/schema";
import { type Client, hcWithType } from "@adteemo/api/hc";
import { z } from "zod";
import {
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  resolveOpggMatchDetailSchema,
  upsertPendingRankSnapshotsSchema,
} from "@adteemo/api/validators";

const API_URL = Deno.env.get("API_URL");
if (!API_URL) {
  throw new Error("API_URL environment variable must be set");
}

export const client: Client = hcWithType(API_URL);

function dateOrNull(value: string | Date | null) {
  return value === null ? null : new Date(value);
}

function parseRiotAccount(
  account: {
    createdAt: string | Date;
    updatedAt: string | Date | null;
  } & Omit<RiotAccount, "createdAt" | "updatedAt">,
): RiotAccount {
  return {
    ...account,
    createdAt: new Date(account.createdAt),
    updatedAt: dateOrNull(account.updatedAt),
  };
}

function parseMatchWatcher(
  watcher:
    & {
      createdAt: string | Date;
      updatedAt: string | Date | null;
      gameStartedAt: string | Date | null;
      lastCheckedAt: string | Date | null;
      lastInGameNotifiedAt: string | Date | null;
      pendingResultStartedAt: string | Date | null;
    }
    & Omit<
      MatchWatcher,
      | "createdAt"
      | "updatedAt"
      | "gameStartedAt"
      | "lastCheckedAt"
      | "lastInGameNotifiedAt"
      | "pendingResultStartedAt"
    >,
): MatchWatcher {
  return {
    ...watcher,
    createdAt: new Date(watcher.createdAt),
    updatedAt: dateOrNull(watcher.updatedAt),
    gameStartedAt: dateOrNull(watcher.gameStartedAt),
    lastCheckedAt: dateOrNull(watcher.lastCheckedAt),
    lastInGameNotifiedAt: dateOrNull(watcher.lastInGameNotifiedAt),
    pendingResultStartedAt: dateOrNull(watcher.pendingResultStartedAt),
  };
}

async function linkAccountByRiotId(
  discordId: string,
  gameName: string,
  tagLine: string,
  platform?: RiotPlatform,
  region?: RiotRegion,
) {
  try {
    const res = await client.users["link-by-riot-id"].$patch({
      json: { discordId, gameName, tagLine, platform, region },
    });

    if (!res.ok) {
      if (res.status === 404) {
        const body = await res.json();
        return { success: false as const, error: body.error };
      }

      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      error: "Failed to communicate with API",
    };
  }
}

async function getRiotAccount(discordId: string) {
  try {
    const res = await client.users[":userId"]["riot-account"].$get({
      param: { userId: discordId },
    });

    if (!res.ok) {
      if (res.status === 404) {
        const body = await res.json();
        return { success: false as const, error: body.error };
      }
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return { success: true as const, account: parseRiotAccount(body.account) };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getActiveGameByPuuid(
  platform: RiotPlatform,
  puuid: string,
) {
  const res = await client.riot["active-games"][":platform"][":puuid"].$get({
    param: { platform, puuid },
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error);
  }
  const body = await res.json();
  return body.activeGame;
}

async function getMatchById(region: RiotRegion, matchId: string) {
  const res = await client.riot.matches[":region"][":matchId"].$get({
    param: { region, matchId },
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error);
  }
  const body = await res.json();
  return body.match;
}

async function getLeagueEntriesByPuuid(
  platform: RiotPlatform,
  puuid: string,
) {
  const res = await client.riot["league-entries"][":platform"][":puuid"].$get({
    param: { platform, puuid },
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error);
  }
  const body = await res.json();
  return body.entries;
}

async function checkHealth() {
  try {
    const res = await client.health.$get();

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return { success: true as const, message: body.message };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      error: "Failed to communicate with API",
    };
  }
}

async function setMainRole(userId: string, guildId: string, role: Lane) {
  try {
    const res = await client.users[":userId"]["main-role"].$put({
      param: { userId: userId },
      json: { guildId, role },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function createCustomGameEvent(event: {
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  scheduledStartAt: Date;
}) {
  try {
    const res = await client.events.$post({ json: event });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getCustomGameEventsByCreatorId(creatorId: string) {
  try {
    const res = await client.events["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return { success: true as const, events: body.events };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function deleteCustomGameEvent(discordEventId: string) {
  try {
    const res = await client.events[":discordEventId"].$delete({
      param: { discordEventId },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getEventStartingTodayByCreatorId(creatorId: string) {
  try {
    const res = await client.events.today["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    if (!res.ok) {
      if (res.status === 404) {
        const body = await res.json();
        return { success: false as const, error: body.error };
      }

      throw new Error(`Unexpected response: ${res}`);
    }

    const data = await res.json();
    return {
      success: true as const,
      event: data.event,
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      error: "Failed to communicate with API",
    };
  }
}

export type MatchParticipant = z.infer<typeof createParticipantSchema>;
export type RankSnapshotPayload = z.infer<
  typeof upsertPendingRankSnapshotsSchema
>["snapshots"][number];
export type FinalizedRankSnapshot = {
  matchId: string;
  puuid: string;
  platform: RiotPlatform;
  queueType: RankSnapshotPayload["queueType"];
  phase: "before" | "after";
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
  fetchedAt: Date;
};
export type RiotStaticDataResolveInput = {
  locale?: string;
  championIds?: number[];
  queueIds?: number[];
  mapIds?: number[];
  gameModes?: string[];
};
export type RiotStaticDataResolveData = {
  champions: Record<
    string,
    { name: string | null; iconUrl: string | null }
  >;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};
export type RiotStaticDataResolveResult =
  | { success: true; data: RiotStaticDataResolveData }
  | { success: false; error: string };
export type ResolveOpggMatchDetailPayload = z.infer<
  typeof resolveOpggMatchDetailSchema
>;
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
export type ResolveOpggMatchDetailResult =
  | { success: true; detail: OpggMatchDetail | null }
  | { success: false; error: string };

function parseRankSnapshot(
  snapshot: Omit<FinalizedRankSnapshot, "fetchedAt"> & {
    fetchedAt: string | Date;
  },
): FinalizedRankSnapshot {
  return {
    ...snapshot,
    fetchedAt: new Date(snapshot.fetchedAt),
  };
}

async function createMatchParticipant(
  matchId: string,
  participant: MatchParticipant,
) {
  try {
    const res = await client.matches[":matchId"].participants.$post({
      param: { matchId },
      json: participant,
    });

    if (!res.ok) {
      if (res.status === 404) {
        const body = await res.json();
        console.error(`API Error: ${res.status} ${res.statusText}`, body);
        return { success: false as const, error: body.error };
      }

      throw new Error(`Unexpected response: ${res}`);
    }

    const data = await res.json();
    if (typeof data.id !== "number") {
      console.error("API response missing participant id", data);
      return {
        success: false as const,
        error: "API response missing participant id",
      };
    }

    return { success: true as const, id: data.id };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function upsertPendingRankSnapshots(
  payload: z.infer<typeof upsertPendingRankSnapshotsSchema>,
) {
  try {
    const res = await client.matches["rank-snapshots"].pending.$post({
      json: payload,
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function finalizeRankSnapshots(
  matchId: string,
  payload: z.infer<typeof finalizeRankSnapshotsSchema>,
) {
  try {
    const res = await client.matches[":matchId"]["rank-snapshots"].finalize
      .$post({
        param: { matchId },
        json: payload,
      });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return {
      success: true as const,
      snapshots: {
        before: body.snapshots.before.map(parseRankSnapshot),
        after: body.snapshots.after.map(parseRankSnapshot),
      },
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function resolveRiotStaticData(
  payload: RiotStaticDataResolveInput,
): Promise<RiotStaticDataResolveResult> {
  try {
    const res = await client.riot["static-data"].resolve.$post({
      json: payload,
    });

    if (!res.ok) {
      const body = await res.json();
      return { success: false, error: body.error };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function resolveOpggMatchDetail(
  matchId: string,
  payload: ResolveOpggMatchDetailPayload,
): Promise<ResolveOpggMatchDetailResult> {
  try {
    const res = await client.matches[":matchId"]["external-details"].opgg
      .resolve.$post({
        param: { matchId },
        json: payload,
      });

    if (!res.ok) {
      const body = await res.json();
      return { success: false, error: body.error };
    }

    const body = await res.json();
    return {
      success: true,
      detail: body.detail === null ? null : {
        ...body.detail,
        providerCreatedAt: new Date(body.detail.providerCreatedAt),
      },
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function getLoginUrl(discordId: string) {
  try {
    const res = await client.auth.rso["login-url"].$get({
      query: { discordId },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return { success: true as const, url: body.url };
  } catch (e) {
    console.error("Failed to communicate with API", e);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function watchMatch(watcher: {
  guildId: string;
  targetDiscordId: string;
  requesterId: string;
  channelId: string;
}) {
  try {
    const res = await client["match-watchers"].$post({ json: watcher });

    if (!res.ok) {
      if (res.status === 404 || res.status === 409) {
        const body = await res.json();
        return {
          success: false as const,
          error: body.error,
          status: res.status,
        };
      }
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function unwatchMatch(guildId: string, targetDiscordId: string) {
  try {
    const res = await client["match-watchers"][":guildId"][
      ":targetDiscordId"
    ].$delete({
      param: { guildId, targetDiscordId },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getEnabledMatchWatchers() {
  try {
    const res = await client["match-watchers"].enabled.$get();

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return {
      success: true as const,
      watchers: body.watchers.map(parseMatchWatcher),
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getEnabledMatchWatchersByGuild(guildId: string) {
  try {
    const res = await client["match-watchers"].enabled[":guildId"].$get({
      param: { guildId },
    });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    const body = await res.json();
    return {
      success: true as const,
      watchers: body.watchers.map(parseMatchWatcher),
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function updateMatchWatcherState(
  guildId: string,
  targetDiscordId: string,
  state: {
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
  },
) {
  try {
    const res = await client["match-watchers"][":guildId"][":targetDiscordId"]
      .state.$patch({
        param: { guildId, targetDiscordId },
        json: state,
      });

    if (!res.ok) {
      throw new Error(`Unexpected response: ${res}`);
    }

    return { success: true as const };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

export const apiClient = {
  linkAccountByRiotId,
  getRiotAccount,
  getActiveGameByPuuid,
  getMatchById,
  getLeagueEntriesByPuuid,
  checkHealth,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEvent,
  getEventStartingTodayByCreatorId,
  createMatchParticipant,
  upsertPendingRankSnapshots,
  finalizeRankSnapshots,
  resolveRiotStaticData,
  resolveOpggMatchDetail,
  getLoginUrl,
  watchMatch,
  unwatchMatch,
  getEnabledMatchWatchers,
  getEnabledMatchWatchersByGuild,
  updateMatchWatcherState,
};
