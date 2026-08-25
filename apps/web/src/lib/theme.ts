export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'valytica.theme';

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked — fall through to system */
  }
  return 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked — theme still applies for this page view */
  }
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
