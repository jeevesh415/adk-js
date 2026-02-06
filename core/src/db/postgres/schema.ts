/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {relations} from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import {Event} from '../../events/event.js';

/**
 * The internal metadata table.
 */
export const internalMetadata = pgTable('adk_internal_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * The sessions table.
 */
export const sessions = pgTable(
  'sessions',
  {
    appName: text('app_name').notNull(),
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    state: jsonb('state').notNull().default({}),
    createTime: bigint('create_time', {mode: 'number'}).notNull(),
    lastUpdateTime: bigint('last_update_time', {mode: 'number'}).notNull(),
  },
  (table) => [primaryKey({columns: [table.appName, table.userId, table.id]})],
);

/**
 * The sessions relations.
 */
export const sessionsRelations = relations(sessions, ({many}) => ({
  events: many(events),
}));

/**
 * The events table.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').notNull(),
    appName: text('app_name').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    invocationId: text('invocation_id').notNull(),
    timestamp: bigint('timestamp', {mode: 'number'}).notNull(),
    eventData: jsonb('event_data').$type<Event>(),
  },
  (table) => [
    primaryKey({
      columns: [table.appName, table.userId, table.sessionId, table.id],
    }),
    index('events_session_idx').on(
      table.appName,
      table.userId,
      table.sessionId,
    ),
    foreignKey({
      columns: [table.appName, table.userId, table.sessionId],
      foreignColumns: [sessions.appName, sessions.userId, sessions.id],
      name: 'events_session_fkey',
    }).onDelete('cascade'),
  ],
);

/**
 * The events relations.
 */
export const eventsRelations = relations(events, ({one}) => ({
  session: one(sessions, {
    fields: [events.appName, events.userId, events.sessionId],
    references: [sessions.appName, sessions.userId, sessions.id],
  }),
}));

/**
 * The app states table.
 */
export const appStates = pgTable('app_states', {
  appName: text('app_name').primaryKey(),
  state: jsonb('state').notNull().default({}),
  updateTime: bigint('update_time', {mode: 'number'}).notNull(),
});

/**
 * The user states table.
 */
export const userStates = pgTable(
  'user_states',
  {
    appName: text('app_name').notNull(),
    userId: text('user_id').notNull(),
    state: jsonb('state').notNull().default({}),
    updateTime: bigint('update_time', {mode: 'number'}).notNull(),
  },
  (table) => [primaryKey({columns: [table.appName, table.userId]})],
);
