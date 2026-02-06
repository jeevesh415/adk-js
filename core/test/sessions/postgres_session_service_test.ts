/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createEvent, PostgresSessionService} from '@google/adk';
import {PgTransaction} from 'drizzle-orm/pg-core';
import {afterEach, beforeEach, describe, expect, it, Mock, vi} from 'vitest';
import * as dbFuncs from '../../src/sessions/db/postgres/index.js';

// Mock the DB module
vi.mock('../../src/sessions/db/postgres/index.js');

describe('PostgresSessionService', () => {
  let service: PostgresSessionService;
  let mockDb: {
    insert: Mock;
    query: {
      sessions: {
        findFirst: Mock;
        findMany: Mock;
      };
      appStates: {
        findFirst: Mock;
      };
      userStates: {
        findFirst: Mock;
      };
      events: {
        findFirst: Mock;
        findMany: Mock;
      };
    };
    delete: Mock;
    transaction: Mock;
  };

  beforeEach(() => {
    service = new PostgresSessionService();
    // Setup mock DB structure
    mockDb = {
      insert: vi.fn(),
      query: {
        sessions: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        appStates: {
          findFirst: vi.fn(),
        },
        userStates: {
          findFirst: vi.fn(),
        },
        events: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      delete: vi.fn(),
      transaction: vi.fn(),
    };
    // Mock getDb to return our mock
    vi.spyOn(dbFuncs, 'getDb').mockReturnValue(
      mockDb as unknown as dbFuncs.PostgresDB,
    );

    process.env.DATABASE_URL =
      'postgres://user:password@localhost:5432/adk_test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createSession inserts into DB and returns session', async () => {
    // const mockSession = {
    //   id: 'sess-1',
    //   appName: 'app1',
    //   userId: 'user1',
    //   state: {foo: 'bar'},
    //   lastUpdateTime: 1000n,
    //   createTime: 1000n,
    // };

    // Mock transaction to simulate behavior
    mockDb.transaction.mockImplementation(
      async (
        callback: (
          tx: PgTransaction<{
            readonly $brand: 'PgQueryResultHKT';
            readonly row: unknown;
            readonly type: unknown;
          }>,
        ) => Promise<void>,
      ) => {
        const tx = {
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{state: {}}]), // For app/user states
          query: {
            appStates: {findFirst: vi.fn().mockResolvedValue(null)},
            userStates: {findFirst: vi.fn().mockResolvedValue(null)},
          },
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        } as unknown as PgTransaction<{
          readonly $brand: 'PgQueryResultHKT';
          readonly row: unknown;
          readonly type: unknown;
        }>;

        // Override for specific inserts if needed, but for now generic return is fine
        // The session insert doesn't return in the new implementation (it returns via createSession logic)

        await callback(tx);
      },
    );

    const result = await service.createSession({
      appName: 'app1',
      userId: 'user1',
      state: {foo: 'bar'}, // 'foo' will be treated as session state as it has no prefix
      sessionId: 'sess-1',
    });

    expect(mockDb.transaction).toHaveBeenCalled();
    expect(result.id).toBe('sess-1');
    expect(result.state).toEqual({foo: 'bar'});
  });

  it('getSession fetches session and events', async () => {
    const mockSession = {
      id: 'sess-1',
      appName: 'app1',
      userId: 'user1',
      state: {sess: 'ion'},
      lastUpdateTime: 1000n,
      events: [
        {
          id: 'evt-2',
          invocationId: 'inv-1',
          timestamp: 2000n,
          eventData: createEvent({
            id: 'evt-2',
            timestamp: 2000,
            content: {parts: [{text: 'hi'}]},
          }),
        },
        {
          id: 'evt-1',
          invocationId: 'inv-1',
          timestamp: 1000n,
          eventData: createEvent({
            id: 'evt-1',
            timestamp: 1000,
            content: {parts: [{text: 'hello'}]},
          }),
        },
      ],
    };

    mockDb.query.sessions.findFirst.mockResolvedValue(mockSession);
    mockDb.query.appStates.findFirst.mockResolvedValue({
      state: {'global': 'val'},
    });
    mockDb.query.userStates.findFirst.mockResolvedValue({
      state: {'pref': 'dark'},
    });

    const result = await service.getSession({
      appName: 'app1',
      userId: 'user1',
      sessionId: 'sess-1',
    });

    expect(result).toBeDefined();
    expect(result?.id).toBe('sess-1');
    // Verify merged state
    expect(result?.state).toEqual({
      sess: 'ion',
      'app:global': 'val',
      'user:pref': 'dark',
    });
    // Result should be in chronological order
    expect(result?.events[0].id).toBe('evt-1');
    expect(result?.events[1].id).toBe('evt-2');
  });

  it('appendEvent uses transaction to insert event and update session', async () => {
    const session = {
      id: 'sess-1',
      appName: 'app',
      userId: 'user',
      state: {},
      events: [],
      lastUpdateTime: 0,
    };
    const event = createEvent({
      id: 'evt-1',
      timestamp: 123,
      actions: {
        stateDelta: {
          foo: 'bar', // Session
          'app:key': 'val', // App
          'user:pref': 'on', // User
        },
        artifactDelta: {},
        requestedAuthConfigs: {},
        requestedToolConfirmations: {},
      },
    });

    const mockUpdate = vi.fn().mockReturnThis();

    mockDb.transaction.mockImplementation(async (callback) => {
      const tx = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        update: mockUpdate,
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        query: {
          sessions: {findFirst: vi.fn().mockResolvedValue({state: {}})},
          appStates: {findFirst: vi.fn().mockResolvedValue({state: {}})},
          userStates: {findFirst: vi.fn().mockResolvedValue({state: {}})},
        },
      };
      await callback(tx);
    });

    await service.appendEvent({session, event});

    expect(session.state).toEqual({
      foo: 'bar',
      'app:key': 'val',
      'user:pref': 'on',
    }); // In-memory update has everything

    expect(mockDb.transaction).toHaveBeenCalled();
    // Start to verify that update was called 3 times (once for each scope)
    // Note: implementation does 3 updates
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });
});
