/**
 * Browser-persisted UI preferences — theme, sidebar state, area unit.
 *
 * These are stored under a `realytica.` prefix. The product shipped earlier
 * under the name Valytica, so anyone who has used it already has their
 * preferences under `valytica.` instead; reads check the old prefix when the
 * new one is absent, and writes always use the new one. Nobody comes back to
 * a re-renamed build and finds their theme reset.
 *
 * Every access is wrapped: `localStorage` throws outright in some privacy
 * modes, and a preference is never worth taking a page down for.
 */

const PREFIX = 'realytica.';
const LEGACY_PREFIX = 'valytica.';

export function readPref(suffix: string): string | null {
  try {
    return localStorage.getItem(PREFIX + suffix) ?? localStorage.getItem(LEGACY_PREFIX + suffix);
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
