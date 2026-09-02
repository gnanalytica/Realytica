import { useCallback, useState } from 'react';
import { readPref, writePref } from './prefs';

/**
 * State that survives walking away from the screen it was set on.
 *
 * Theme, sidebar and chat width already persisted; the filters people actually
 * set every few minutes did not. Narrow the evidence register to gaps, open a
 * finding to check something, come back — and you were reading the whole
 * register again, wondering why the row you were on had moved.
 *
 * Scoped by project, because "gaps" on one file says nothing about another, and
 * a filter silently carried across projects is worse than no filter at all.
 */
export function useStickyState<T extends string>(
  scope: string,
  key: string,
  fallback: T,
  valid?: (value: string) => boolean,
): [T, (next: T) => void] {
  const storageKey = `filter.${scope}.${key}`;
  const [value, set] = useState<T>(() => {
    const raw = readPref(storageKey);
    // A stored value can outlive the option that produced it — a status
    // renamed, a filter removed — so anything unrecognised falls back rather
    // than leaving a register filtered to nothing with no way to tell why.
    if (!raw) return fallback;
    if (valid && !valid(raw)) return fallback;
    return raw as T;
  });

  const put = useCallback(
    (next: T) => {
      set(next);
      writePref(storageKey, next);
    },
    [storageKey],
  );

  return [value, put];
}
