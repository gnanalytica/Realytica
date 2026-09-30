/**
 * A deploy replaced the code this page is running.
 *
 * Every build names its chunks by content hash, and a deploy serves only its
 * own. A page opened before the deploy still asks for the old names when it
 * lazily loads a screen, gets nothing back, and the screen cannot be drawn.
 * "Try again" asks for the same missing file again; only loading the new
 * build helps, so that is what happens.
 */

/** Chrome, Safari and Firefox word a missing module differently; Vite adds its own for CSS. */
const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return STALE_CHUNK.test(message);
}

const KEY = 'realytica.reloadedForNewBuild';

/**
 * Whether to load the new build now: at most once a minute.
 *
 * The limit is what stops a chunk missing for some other reason from putting
 * the page in a reload loop; without storage to hold it, the answer is no and
 * the screen offers the button instead. The caller does the reloading, which
 * keeps this file free of the page and testable without one.
 */
export function mayReloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
