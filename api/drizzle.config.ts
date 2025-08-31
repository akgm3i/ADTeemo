import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'libsql',
  dbCredentials: {
    url: 'file:/app/data/sqlite.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;
