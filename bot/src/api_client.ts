import { hc } from 'hono/client';
import type { app } from '../../api/src/main.ts';

const API_URL = Deno.env.get('API_URL');
if (!API_URL) {
  throw new Error('API_URL environment variable must be set');
}

// Create the RPC client
export const client = hc<typeof app>(API_URL);
