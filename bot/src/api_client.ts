import type { Lane } from "@adteemo/api/schema";

const API_URL = Deno.env.get("API_URL");
if (!API_URL) {
  throw new Error("API_URL environment variable must be set");
}
import { hcWithType } from "@adteemo/api/hc";

const client = hcWithType(API_URL);

export async function checkHealth() {
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

export async function setMainRole(userId: string, role: Lane) {
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
