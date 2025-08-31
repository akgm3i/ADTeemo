import { Hono } from 'hono';
import { logger } from 'hono/logger';

const app = new Hono();

// Middleware
app.use('*', logger());

import { usersRoutes } from './routes/users.ts';

// Routes
app.get('/health', (c) => {
  return c.json({ ok: true, message: 'Healthy' });
});

const routes = app.route('/users', usersRoutes);

export type AppType = typeof routes;

// Export the app for testing and runtime
export default app;

// Serve the app only when this file is the main module
if (import.meta.main) {
  Deno.serve({ port: 8000 }, app.fetch);
  console.log('Server running on http://localhost:8000');
}
