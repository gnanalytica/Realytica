import { readPref, writePref } from './prefs';

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'theme';

export function getStoredTheme(): ThemeMode {
  const v = readPref(KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  writePref(KEY, mode);
}

export function initTheme(): ThemeMode {
  const mode = getStoredTheme();
  applyTheme(mode);
  return mode;
}

/** The eight categorical slots, in fixed order. Never cycle past slot 8. */
export const SERIES_VARS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

export function seriesColor(index: number): string {
  return SERIES_VARS[index % SERIES_VARS.length];
}
