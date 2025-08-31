import { assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { client } from './main.ts';

Deno.test('Bot client should be instantiated', () => {
  assertExists(client, 'The client should exist and be an object.');
});
