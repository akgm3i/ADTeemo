import type { Lane } from "@adteemo/api/schema";
import { type Client, hcWithType } from "@adteemo/api/hc";
import { z } from "zod";
import { createParticipantSchema } from "@adteemo/api/validators";
import { Result } from "./types.ts";

const API_URL = Deno.env.get("API_URL");
if (!API_URL) {
  throw new Error("API_URL environment variable must be set");
}

const client: Client = hcWithType(API_URL);

async function checkHealth() {
  try {
    const res = await client.health.$get();
    if (res.ok) {
      const data = await res.json();
      return { success: data.ok, message: data.message, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false, error: `API returned status ${res.status}` };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function setMainRole(userId: string, role: Lane) {
  try {
    const res = await client.users[":userId"]["main-role"].$put({
      param: { userId: userId },
      json: { role: role },
    });

    if (res.ok) {
      const data = await res.json();
      return { success: data.success, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false, error: `API returned status ${res.status}` };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function createCustomGameEvent(event: {
  name: string;
  guildId: string;
  creatorId: string;
  discordScheduledEventId: string;
  recruitmentMessageId: string;
  scheduledStartAt: Date; // From main branch
}) {
  try {
    const res = await client.events.$post({ json: event });

    if (res.ok) {
      const data = await res.json();
      return { success: data.success, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false, error: `API returned status ${res.status}` };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function getCustomGameEventsByCreatorId(creatorId: string) {
  try {
    const res = await client.events["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    if (res.ok) {
      const data = await res.json();
      return { success: data.success, events: data.events, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false,
        events: [],
        error: `API returned status ${res.status}`,
      };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false,
      events: [],
      error: "Failed to communicate with API",
    };
  }
}

async function deleteCustomGameEvent(discordEventId: string) {
  try {
    const res = await client.events[":discordEventId"].$delete({
      param: { discordEventId },
    });

    if (res.ok) {
      const data = await res.json();
      return { success: data.success, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return { success: false, error: `API returned status ${res.status}` };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return { success: false, error: "Failed to communicate with API" };
  }
}

async function getEventStartingTodayByCreatorId(creatorId: string) {
  try {
    const res = await client.events.today["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      try {
        const errorJson = JSON.parse(errorBody);
        const error = (errorJson as { error?: string }).error ||
          `API returned status ${res.status}`;
        return { success: false, event: null, error };
      } catch {
        return {
          success: false,
          event: null,
          error: `API returned status ${res.status}`,
        };
      }
    }

    const data = await res.json();
    if ("success" in data && data.success) {
      return { success: true, event: data.event, error: null };
    }
    return {
      success: false,
      event: null,
      error: (data as { error?: string }).error ??
        "API returned a non-success response",
    };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false,
      event: null,
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

    if (res.ok) {
      const data = await res.json();
      return { success: data.success, id: data.id, error: null };
    } else {
      const errorBody = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`, errorBody);
      return {
        success: false,
        data: null,
        error: `API returned status ${res.status}`,
      };
    }
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false,
      data: null,
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
  checkHealth,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEvent,
  getEventStartingTodayByCreatorId,
  createMatchParticipant,
  getLoginUrl,
};
