import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { app } from './main.ts';

Deno.test('GET /health should return a healthy response', async () => {
  const res = await app.request('/health');
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, message: 'Healthy' });
});
