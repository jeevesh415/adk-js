import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/sessions/db/postgres/schema.ts',
  out: './src/sessions/db/postgres/migrations',
});
