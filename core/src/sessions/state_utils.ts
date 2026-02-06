/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {State} from './state.js';

/**
 * Extracts state delta into app, user, and session specific deltas.
 *
 * @param delta The state delta to extract.
 * @return The extracted state deltas.
 */
export function extractStateDelta(delta: Record<string, unknown>): {
  app: Record<string, unknown>;
  user: Record<string, unknown>;
  session: Record<string, unknown>;
} {
  const app: Record<string, unknown> = {};
  const user: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(delta)) {
    if (key.startsWith(State.APP_PREFIX)) {
      app[key.substring(State.APP_PREFIX.length)] = value;
    } else if (key.startsWith(State.USER_PREFIX)) {
      user[key.substring(State.USER_PREFIX.length)] = value;
    } else {
      session[key] = value;
    }
  }

  return {app, user, session};
}

/**
 * Merges app, user, and session states into a single state object.
 *
 * @param appState The app state.
 * @param userState The user state.
 * @param sessionState The session state.
 * @return The merged state.
 */
export function mergeState(
  appState: Record<string, unknown>,
  userState: Record<string, unknown>,
  sessionState: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {...sessionState};

  for (const [key, value] of Object.entries(appState)) {
    merged[State.APP_PREFIX + key] = value;
  }

  for (const [key, value] of Object.entries(userState)) {
    merged[State.USER_PREFIX + key] = value;
  }

  return merged;
}
