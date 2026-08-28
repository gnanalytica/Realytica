/**
 * Browser-persisted UI preferences — theme, sidebar state, area unit.
 *
 * Stored under a `realytica.` prefix. Every access is wrapped: `localStorage` throws outright in some privacy
 * modes, and a preference is never worth taking a page down for.
 */

const PREFIX = 'realytica.';

export function readPref(suffix: string): string | null {
  try {
    return localStorage.getItem(PREFIX + suffix);
  } catch {
    /* storage blocked — no persisted preference */
    return null;
  }
}

export function writePref(suffix: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + suffix, value);
  } catch {
    /* storage blocked — the preference still applies for this page view */
  }
}
