import type { Lane } from "@adteemo/api/schema";
import { type Client, hcWithType } from "@adteemo/api/hc";
import { z } from "zod";
import { createParticipantSchema } from "@adteemo/api/validators";

const API_URL = Deno.env.get("API_URL");
if (!API_URL) {
  throw new Error("API_URL environment variable must be set");
}

export const client: Client = hcWithType(API_URL);

async function linkAccountByRiotId(
  discordId: string,
  gameName: string,
  tagLine: string,
) {
  try {
    const res = await client.users["link-by-riot-id"].$patch({
      json: { discordId, gameName, tagLine },
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

async function setMainRole(userId: string, role: Lane) {
  try {
    const res = await client.users[":userId"]["main-role"].$put({
      param: { userId: userId },
      json: { role: role },
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
