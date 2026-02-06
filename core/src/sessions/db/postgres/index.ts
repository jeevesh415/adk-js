/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {drizzle} from 'drizzle-orm/node-postgres';
import {Pool} from 'pg';
import * as schema from './schema.js';

type PostgresDB = ReturnType<typeof drizzle<typeof schema>>;

let dbInstance: PostgresDB | undefined;

/**
 * Checks if the given connection string is a Postgres connection string.
 */
export function isPostgresConnectionString(connectionString: string): boolean {
  return connectionString.startsWith('postgresql://');
}

export function getDb(connectionString?: string): PostgresDB {
  if (!dbInstance) {
    if (!connectionString) {
      connectionString = process.env.DATABASE_URL;
    }

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    if (!isPostgresConnectionString(connectionString)) {
      throw new Error(
        'Invalid DATABASE_URL. It should start with "postgresql://".',
      );
    }

    const pool = new Pool({connectionString});
    dbInstance = drizzle(pool, {schema});
  }

  return dbInstance;
}

export {PostgresDB, schema};
