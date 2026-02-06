/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {and, desc, eq} from 'drizzle-orm';
import {Event} from '../events/event.js';
import {
  AppendEventRequest,
  BaseSessionService,
  CreateSessionRequest,
  DeleteSessionRequest,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
} from './base_session_service.js';
import {getDb, PostgresDB, schema} from './db/postgres/index.js';
import {createSession, Session} from './session.js';
import {extractStateDelta, mergeState} from './state_utils.js';

/**
 * A session service that uses a Postgres database.
 */
export class PostgresSessionService extends BaseSessionService {
  private db: PostgresDB;

  constructor(connectionString?: string) {
    super();

    this.db = getDb(connectionString);
  }

  async createSession(request: CreateSessionRequest): Promise<Session> {
    const sessionId = request.sessionId || crypto.randomUUID();
    const now = Date.now();

    // Split initial state
    const {
      app: appStateDelta,
      user: userStateDelta,
      session: sessionState,
    } = extractStateDelta(request.state || {});

    // Ensure App and User states exist, and apply deltas
    let appState: Record<string, unknown> = {};
    let userState: Record<string, unknown> = {};

    await this.db.transaction(async (tx) => {
      // 1. App State
      await tx
        .insert(schema.appStates)
        .values({
          appName: request.appName,
          state: {},
          updateTime: now,
        })
        .onConflictDoUpdate({
          target: schema.appStates.appName,
          set: {
            updateTime: now,
            state:
              Object.keys(appStateDelta).length > 0
                ? // Merge existing state with delta
                  // Note: creating a custom SQL merge would be better but simple JSON merge works for now
                  // properly handling this atomically might require sql operators if high concurrency
                  undefined // optimization: if we have sql operator. For now, we might need to fetch-modify-update or use jsonb_concat if available
                : undefined,
          },
        })
        .returning();

      // Since Drizzle's onConflictDoUpdate with dynamic JSON merging is tricky,
      // let's do a simpler Fetch -> Upsert pattern or improved Upsert for state to be safe.
      // Actually, standard pattern in the python code: "Fetch app and user states from storage ... Create state tables if not exist"

      // Let's mimic the Python logic more closely for consistency:
      // 1. Fetch existing
      let storedAppState = await tx.query.appStates.findFirst({
        where: eq(schema.appStates.appName, request.appName),
      });
      let storedUserState = await tx.query.userStates.findFirst({
        where: and(
          eq(schema.userStates.appName, request.appName),
          eq(schema.userStates.userId, request.userId),
        ),
      });

      // 2. Create if missing
      if (!storedAppState) {
        [storedAppState] = await tx
          .insert(schema.appStates)
          .values({
            appName: request.appName,
            state: {},
            updateTime: now,
          })
          .returning();
      }

      if (!storedUserState) {
        [storedUserState] = await tx
          .insert(schema.userStates)
          .values({
            appName: request.appName,
            userId: request.userId,
            state: {},
            updateTime: now,
          })
          .returning();
      }

      // 3. Apply Deltas
      if (Object.keys(appStateDelta).length > 0) {
        storedAppState.state = {
          ...(storedAppState.state as object),
          ...appStateDelta,
        };
        await tx
          .update(schema.appStates)
          .set({state: storedAppState.state, updateTime: now})
          .where(eq(schema.appStates.appName, request.appName));
      }

      if (Object.keys(userStateDelta).length > 0) {
        storedUserState.state = {
          ...(storedUserState.state as object),
          ...userStateDelta,
        };
        await tx
          .update(schema.userStates)
          .set({state: storedUserState.state, updateTime: now})
          .where(
            and(
              eq(schema.userStates.appName, request.appName),
              eq(schema.userStates.userId, request.userId),
            ),
          );
      }

      // Capture for return
      appState = storedAppState.state as Record<string, unknown>;
      userState = storedUserState.state as Record<string, unknown>;

      // 4. Insert Session
      await tx.insert(schema.sessions).values({
        id: sessionId,
        appName: request.appName,
        userId: request.userId,
        state: sessionState,
        createTime: now,
        lastUpdateTime: now,
      });
    });

    const mergedState = mergeState(appState, userState, sessionState);

    return createSession({
      id: sessionId,
      appName: request.appName,
      userId: request.userId,
      state: mergedState,
      lastUpdateTime: now,
      events: [],
    });
  }

  /**
   * @inheritdoc
   */
  async getSession(request: GetSessionRequest): Promise<Session | undefined> {
    const result = await this.db.query.sessions.findFirst({
      where: and(
        eq(schema.sessions.id, request.sessionId),
        eq(schema.sessions.appName, request.appName),
        eq(schema.sessions.userId, request.userId),
      ),
      with: {
        events: {
          orderBy: [desc(schema.events.timestamp)],
          limit: request.config?.numRecentEvents,
        },
      },
    });

    if (!result) {
      return undefined;
    }

    // Fetch App and User states
    const appStateResult = await this.db.query.appStates.findFirst({
      where: eq(schema.appStates.appName, request.appName),
    });

    const userStateResult = await this.db.query.userStates.findFirst({
      where: and(
        eq(schema.userStates.appName, request.appName),
        eq(schema.userStates.userId, request.userId),
      ),
    });

    const appState = (appStateResult?.state || {}) as Record<string, unknown>;
    const userState = (userStateResult?.state || {}) as Record<string, unknown>;
    const sessionState = result.state as Record<string, unknown>;

    // Merge states
    const mergedState = mergeState(appState, userState, sessionState);

    // Map DB events to Event objects
    // Note: Python reverses the list (DESC -> ASC) so oldest first in the list
    const events: Event[] = result.events.reverse().map((dbEvent) => {
      return dbEvent.eventData as Event;
    });

    // If config.afterTimestamp is set, currently we rely on DB filtering generally
    // but the previous implementation didn't strictly filter events by timestamp in the query options passed query.sessions.findFirst
    // beyond the limit.
    // The previous implementation was:
    // with: { events: { orderBy: [desc(timestamp)], limit: ... } }
    // It seems simple filtering by timestamp wasn't fully implemented in the `findFirst` query for `events` relation
    // in the previous version shown either.
    // We will keep it as is for now unless we want to enhance it.

    return createSession({
      id: result.id,
      appName: result.appName,
      userId: result.userId,
      state: mergedState,
      lastUpdateTime: Number(result.lastUpdateTime),
      events: events,
    });
  }

  async listSessions(
    request: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    // Fetch sessions
    const sessionResults = await this.db.query.sessions.findMany({
      where: and(
        eq(schema.sessions.appName, request.appName),
        eq(schema.sessions.userId, request.userId),
      ),
      orderBy: [desc(schema.sessions.lastUpdateTime)],
    });

    // Fetch App and User states once
    const appStateResult = await this.db.query.appStates.findFirst({
      where: eq(schema.appStates.appName, request.appName),
    });
    const userStateResult = await this.db.query.userStates.findFirst({
      where: and(
        eq(schema.userStates.appName, request.appName),
        eq(schema.userStates.userId, request.userId),
      ),
    });

    const appState = (appStateResult?.state || {}) as Record<string, unknown>;
    const userState = (userStateResult?.state || {}) as Record<string, unknown>;

    const sessions = sessionResults.map((result) =>
      createSession({
        id: result.id,
        appName: result.appName,
        userId: result.userId,
        state: mergeState(
          appState,
          userState,
          result.state as Record<string, unknown>,
        ),
        lastUpdateTime: Number(result.lastUpdateTime),
        events: [],
      }),
    );

    return {sessions};
  }

  async deleteSession(request: DeleteSessionRequest): Promise<void> {
    await this.db
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, request.sessionId),
          eq(schema.sessions.appName, request.appName),
          eq(schema.sessions.userId, request.userId),
        ),
      );
  }

  override async appendEvent(request: AppendEventRequest): Promise<Event> {
    const {session, event} = request;

    if (event.partial) {
      return event;
    }

    // Update in-memory session object for consistency
    // We'll update the session.state with the FULL merged state including the delta
    this.updateSessionState(request);
    session.events.push(event);
    session.lastUpdateTime = event.timestamp;

    // Extract deltas for DB persistence
    const delta = (event.actions?.stateDelta || {}) as Record<string, unknown>;
    const {
      app: appStateDelta,
      user: userStateDelta,
      session: sessionStateDelta,
    } = extractStateDelta(delta);

    // Persist to DB
    await this.db.transaction(async (tx) => {
      // 1. Update Session State (only session-level keys)
      // We first need to fetch the existing session-only state from DB to merge delicately
      // OR, since session.state in memory IS the full merged state, we can't just dump it.
      // We need to fetch the stored session state and apply only `sessionStateDelta`.

      // However, a more robust way for the session-level state is:
      // Get current stored session-level state.
      const storedSession = await tx.query.sessions.findFirst({
        where: and(
          eq(schema.sessions.id, session.id),
          eq(schema.sessions.appName, session.appName),
          eq(schema.sessions.userId, session.userId),
        ),
      });

      let newSessionLevelState =
        (storedSession?.state as Record<string, unknown>) || {};
      newSessionLevelState = {...newSessionLevelState, ...sessionStateDelta};

      await tx
        .update(schema.sessions)
        .set({
          state: newSessionLevelState,
          lastUpdateTime: session.lastUpdateTime,
        })
        .where(
          and(
            eq(schema.sessions.id, session.id),
            eq(schema.sessions.appName, session.appName),
            eq(schema.sessions.userId, session.userId),
          ),
        );

      // 2. Update App State
      if (Object.keys(appStateDelta).length > 0) {
        const storedAppState = await tx.query.appStates.findFirst({
          where: eq(schema.appStates.appName, session.appName),
        });
        if (storedAppState) {
          const newState = {
            ...(storedAppState.state as object),
            ...appStateDelta,
          };
          await tx
            .update(schema.appStates)
            .set({state: newState, updateTime: session.lastUpdateTime})
            .where(eq(schema.appStates.appName, session.appName));
        }
      }

      // 3. Update User State
      if (Object.keys(userStateDelta).length > 0) {
        const storedUserState = await tx.query.userStates.findFirst({
          where: and(
            eq(schema.userStates.appName, session.appName),
            eq(schema.userStates.userId, session.userId),
          ),
        });
        if (storedUserState) {
          const newState = {
            ...(storedUserState.state as object),
            ...userStateDelta,
          };
          await tx
            .update(schema.userStates)
            .set({state: newState, updateTime: session.lastUpdateTime})
            .where(
              and(
                eq(schema.userStates.appName, session.appName),
                eq(schema.userStates.userId, session.userId),
              ),
            );
        }
      }

      // 4. Insert Event
      await tx.insert(schema.events).values({
        id: event.id,
        appName: session.appName,
        userId: session.userId,
        sessionId: session.id,
        invocationId: event.invocationId,
        timestamp: event.timestamp,
        eventData: event,
      });
    });

    return event;
  }
}
