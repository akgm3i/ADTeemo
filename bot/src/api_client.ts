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
import { createParticipantSchema } from "@adteemo/api/validators";

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
  checkHealth,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEvent,
  getEventStartingTodayByCreatorId,
  createMatchParticipant,
  getLoginUrl,
  watchMatch,
  unwatchMatch,
  getEnabledMatchWatchers,
  updateMatchWatcherState,
};
