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

export function getDb(connectionString?: string): PostgresDB {
  if (!dbInstance) {
    if (!connectionString) {
      connectionString = process.env.DATABASE_URL;
    }

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    if (!connectionString.startsWith('postgres://')) {
      throw new Error(
        'Invalid DATABASE_URL. It should start with "postgres://".',
      );
    }

    const pool = new Pool({connectionString});
    dbInstance = drizzle(pool, {schema});
  }

  return dbInstance;
}

export {PostgresDB, schema};
