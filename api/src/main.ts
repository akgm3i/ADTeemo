import { Hono } from 'hono';
import { logger } from 'https://deno.land/x/hono@v4.2.3/middleware/logger/index.ts';

const app = new Hono();

// Middleware
app.use('*', logger());

import { usersRoutes } from './routes/users.ts';

// Routes
app.get('/health', (c) => {
  return c.json({ ok: true, message: 'Healthy' });
});

app.route('/users', usersRoutes);

// Export the app for testing
export { app };

// Serve the app only when this file is the main module
if (import.meta.main) {
  Deno.serve({ port: 8000 }, app.fetch);
  console.log('Server running on http://localhost:8000');
}
