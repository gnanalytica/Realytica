/**
 * Saved copies of what the server last said, so screens open with no signal.
 *
 * Every successful read of the projects list or a project's site view is
 * written to AsyncStorage. When a read fails because the phone cannot reach
 * the server, the query returns the saved copy instead and the screen says
 * how old it is. On launch the saved copies are poured into the query cache
 * before the first screen draws, so even a cold start offline shows data.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { ApiError } from './http';
import { AsyncStorage, keysWithPrefix, readJSON, writeJSON } from './storage';

const PREFIX = 'realytica.cache.';

/** What a cached query holds: the server's answer and how fresh it is. */
export interface Cached<T> {
  value: T;
  /** When the server sent this. */
  savedAt: string;
  /** True when this came from the server just now; false when it is the phone's saved copy. */
  live: boolean;
}

function storageKey(key: QueryKey): string {
  return PREFIX + JSON.stringify(key);
}

/**
 * Wrap a network read: save what comes back, and fall back to the saved copy
 * when the server cannot be reached. Errors the server actually answered with
 * (403, 404) are not hidden behind stale data — they are passed on.
 */
export async function readThrough<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<Cached<T>> {
  try {
    const value = await fetcher();
    const fresh: Cached<T> = { value, savedAt: new Date().toISOString(), live: true };
    // Saving is best effort: a full disk must not turn a good answer into an error.
    writeJSON(storageKey(key), { value, savedAt: fresh.savedAt }).catch(() => {});
    return fresh;
  } catch (err) {
    if (err instanceof ApiError && err.unreachable) {
      const saved = await readJSON<{ value: T; savedAt: string }>(storageKey(key));
      if (saved) return { value: saved.value, savedAt: saved.savedAt, live: false };
    }
    throw err;
  }
}

/** Put every saved copy into the query cache, marked with the time it was saved. Called once on launch. */
export async function hydrateQueryCache(client: QueryClient): Promise<void> {
  const keys = await keysWithPrefix(PREFIX);
  if (!keys.length) return;
  const rows = await AsyncStorage.multiGet(keys);
  for (const [k, raw] of rows) {
    if (!raw) continue;
    try {
      const queryKey = JSON.parse(k.slice(PREFIX.length)) as QueryKey;
      const saved = JSON.parse(raw) as { value: unknown; savedAt: string };
      const cached: Cached<unknown> = { value: saved.value, savedAt: saved.savedAt, live: false };
      // updatedAt in the past makes the query stale, so it refetches as soon as a screen uses it.
      client.setQueryData(queryKey, cached, { updatedAt: Date.parse(saved.savedAt) || 0 });
    } catch {
      // Skip anything unreadable.
    }
  }
}

/** Forget every saved copy: on sign-out, and whenever the phone is paired afresh. */
export async function clearSavedCopies(): Promise<void> {
  const keys = await keysWithPrefix(PREFIX);
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
