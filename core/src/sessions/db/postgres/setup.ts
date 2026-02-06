import {migrate} from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import {getDb} from './index.js';

// Support ESM and CJS
const dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);

/**
 * Sets up the database by running migrations.
 */
export function setupDatabase(connectionString: string) {
  return migrate(getDb(connectionString), {
    migrationsFolder: path.join(dirname, 'migrations'),
  });
}
