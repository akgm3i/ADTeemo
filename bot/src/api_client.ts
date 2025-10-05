import type { Lane } from "@adteemo/api/schema";
import { type Client, hcWithType } from "@adteemo/api/hc";
import { z } from "zod";
import { createParticipantSchema } from "@adteemo/api/validators";
import type { CustomGameEvent, Result } from "./types.ts";

const API_URL = Deno.env.get("API_URL");
if (!API_URL) {
  throw new Error("API_URL environment variable must be set");
}

export const client: Client = hcWithType(API_URL);

type ErrorPayload = { error: unknown };

function hasErrorProperty(value: unknown): value is ErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (hasErrorProperty(payload) && typeof payload.error === "string") {
    return payload.error;
  }
  return undefined;
}

async function linkAccountByRiotId(
  discordId: string,
  gameName: string,
  tagLine: string,
): Promise<Result> {
  try {
    const res = await client.users["link-by-riot-id"].$patch({
      json: { discordId, gameName, tagLine },
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => undefined);
      const error = extractErrorMessage(errorBody) ??
        `API Error: ${res.status} ${res.statusText}`;
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false as const, error };
    }

    return { success: true as const, error: null };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      error: "Failed to communicate with API",
    };
  }
}

async function checkHealth() {
  try {
    const res = await client.health.$get();
    if (!res.ok) {
      const error = `API Error: ${res.status} ${res.statusText}`;
      console.error(error);
      return { success: false as const, error };
    }

    const data = await res.json();
    return { success: true as const, message: data.message };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      error: "Failed to communicate with API",
    };
  }
}

async function setMainRole(userId: string, role: Lane): Promise<Result> {
  try {
    const res = await client.users[":userId"]["main-role"].$put({
      param: { userId: userId },
      json: { role: role },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false as const,
        error: `API returned status ${res.status}`,
      };
    }
    return { success: true as const, error: null };
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
  scheduledStartAt: Date; // From main branch
}): Promise<Result> {
  try {
    const res = await client.events.$post({ json: event });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false as const,
        error: `API returned status ${res.status}`,
      };
    }
    return { success: true as const, error: null };
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
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false as const,
        events: [],
        error: `API returned status ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      success: true as const,
      events: data.events ?? [],
      error: null,
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      events: [],
      error: "Failed to communicate with API",
    };
  }
}

async function deleteCustomGameEvent(
  discordEventId: string,
): Promise<Result> {
  try {
    const res = await client.events[":discordEventId"].$delete({
      param: { discordEventId },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false as const,
        error: `API returned status ${res.status}`,
      };
    }

    return { success: true as const, error: null };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false as const, error: "Failed to communicate with API" };
  }
}

async function getEventStartingTodayByCreatorId(
  creatorId: string,
): Promise<
  | { success: true; event: CustomGameEvent; error: null }
  | { success: false; event: null; error: string }
> {
  try {
    const res = await client.events.today["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    if (res.status === 404) {
      const errorBody = await res.json().catch(() => undefined);
      const error = extractErrorMessage(errorBody) ?? "Event not found";
      return { success: false as const, event: null, error };
    }

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false as const,
        event: null,
        error: `API returned status ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      success: true as const,
      event: data.event as CustomGameEvent,
      error: null,
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      event: null,
      error: "Failed to communicate with API",
    };
  }
}

export type MatchParticipant = z.infer<typeof createParticipantSchema>;

async function createMatchParticipant(
  matchId: string,
  participant: MatchParticipant,
): Promise<
  | { success: true; id: number; error: null }
  | { success: false; id: null; error: string }
> {
  try {
    const res = await client.matches[":matchId"].participants.$post({
      param: { matchId },
      json: participant,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => undefined);
      const error = extractErrorMessage(errorBody) ??
        `API returned status ${res.status}`;
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false as const, id: null, error };
    }

    const data = await res.json() as { id?: number };
    if (typeof data.id !== "number") {
      console.error("API response missing participant id", data);
      return {
        success: false as const,
        id: null,
        error: "API response missing participant id",
      };
    }

    return {
      success: true as const,
      id: data.id,
      error: null,
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false as const,
      id: null,
      error: "Failed to communicate with API",
    };
  }
}

async function getLoginUrl(
  discordId: string,
): Promise<Result & { url?: string }> {
  try {
    const res = await client.auth.rso["login-url"].$get({
      query: { discordId },
    });

    if (!res.ok) {
      console.error("API Error:", res.status, await res.text());
      return {
        success: false,
        error: `API Error: ${res.status}  ${res.statusText}`,
      };
    }

    const data = await res.json();
    return { success: true, url: data.url, error: null };
  } catch (e) {
    console.error("Failed to communicate with API", e);
    return { success: false, error: "Failed to communicate with API" };
  }
}

export const apiClient = {
  linkAccountByRiotId,
  checkHealth,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEvent,
  getEventStartingTodayByCreatorId,
  createMatchParticipant,
  getLoginUrl,
};
