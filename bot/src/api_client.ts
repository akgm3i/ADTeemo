import { hc } from 'hono/client';
import type { AppType } from '../../api/src/main.ts';
import type { Lane } from '../../api/src/db/schema.ts';

const API_URL = Deno.env.get('API_URL');
if (!API_URL) {
  throw new Error('API_URL environment variable must be set');
}

// Create the RPC client
const client = hc<AppType>(API_URL);

/**
 * Sets the main role for a given user via the API.
 * @param userId The user's Discord ID.
 * @param role The role to set.
 * @returns An object indicating success or failure.
 */
export async function setMainRole(userId: string, role: Lane) {
    try {
        const res = await client.users[':userId']['main-role'].$put({
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
        console.error('Failed to communicate with API', error);
        return { success: false, error: 'Failed to communicate with API' };
    }
}
