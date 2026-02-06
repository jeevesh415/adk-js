import {BaseSessionService} from './base_session_service.js';
import {isPostgresConnectionString} from './db/postgres/index.js';
import {InMemorySessionService} from './in_memory_session_service.js';
import {PostgresSessionService} from './postgres_session_service.js';

export function resolveDatabaseServiceFromUri(
  uri?: string,
): BaseSessionService {
  if (!uri && process.env.DATABASE_URL) {
    console.log(
      'Using DATABASE_URL from the environment to initialize SessionService',
      process.env.DATABASE_URL,
    );
    uri = process.env.DATABASE_URL;
  }

  if (!uri) {
    return new InMemorySessionService();
  }

  if (isPostgresConnectionString(uri)) {
    return new PostgresSessionService(uri);
  }

  throw new Error(`Unsupported session service URI: ${uri}`);
}
