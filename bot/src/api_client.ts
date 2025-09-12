import type { Lane } from "@adteemo/api/schema";
import { type Client, hcWithType } from "@adteemo/api/hc";

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

async function getTodaysCustomGameEventByCreatorId(creatorId: string) {
  try {
    const res = await client.events.today["by-creator"][":creatorId"].$get({
      param: { creatorId },
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`API Error: ${res.status} ${res.statusText}`, data);
      const error = (data as {error?: string}).error || `API returned status ${res.status}`;
      return { success: false, event: null, error };
    }

    // Hono's hc client treats any 2xx as "ok", so we still need to check our custom success flag.
    if ("success" in data && data.success) {
      return { success: true, event: data.event, error: null };
    }

    // This case handles 2xx responses that are not logical successes.
    const error = (data as { error?: string }).error || "API returned a non-success response";
    return { success: false, event: null, error };
  } catch (error) {
    console.error("Failed to communicate with API", error);
    return {
      success: false,
      event: null,
      error: "Failed to communicate with API",
    };
  }
}

export const apiClient = {
  checkHealth,
  setMainRole,
  createCustomGameEvent,
  getCustomGameEventsByCreatorId,
  deleteCustomGameEvent,
  getTodaysCustomGameEventByCreatorId,
};
