import {isPostgresConnectionString} from '../db/postgres/index.js';
import {setupDatabase as setupPostgresDatabase} from './postgres/setup.js';

/**
 * Sets up the database by running migrations.
 */
export function setupDatabase(connectionString: string): Promise<void> {
  if (isPostgresConnectionString(connectionString)) {
    return setupPostgresDatabase(connectionString);
  }

  throw new Error('Unsupported database type, supported types: postgres');
}
