/**
 * The timed read of every project's Google Drive folder.
 *
 * For each project connected to one, what was made or changed in the folder
 * since it was last read through is taken in as if it had been dropped in
 * the app (`connectors/sync.ts`). Safe to call twice: a file is taken once
 * for each state of it, a folder another call is at work on is passed over,
 * and a project that fails is counted and leaves the rest to go on.
 *
 * One call has so long for all of them. The projects read longest ago go
 * first, so a call that runs out of time leaves the ones it did not reach
 * at the front of the next. Without `GOOGLE_SERVICE_ACCOUNT_JSON` it reads
 * nothing, and says so in what it returns.
 */

import type { DdProject } from '@realytica/shared';
import { googleDrive } from '../connectors/google-drive';
import type { FolderProvider } from '../connectors/provider';
import { syncFolder, type SyncOptions } from '../connectors/sync';
import { store } from '../store';

/** How long one call goes on starting projects, and files. */
const RUN_BUDGET_MS = 180_000;
/** Files taken in from one project's folder by one call. */
const FILES_A_PROJECT = 25;

export interface DriveSyncDeps extends Pick<SyncOptions, 'provider' | 'source' | 'vault' | 'budgetMs' | 'maxFiles'> {
  /** The projects this instance holds. */
  projects?: () => readonly DdProject[];
}

export async function driveSync(now: Date, deps: DriveSyncDeps = {}): Promise<Record<string, number>> {
  const out = { projects: 0, read: 0, takenIn: 0, changed: 0, skipped: 0, waiting: 0, failed: 0, busy: 0, notReached: 0, notSetUp: 0 };
  const provider: FolderProvider = deps.provider ?? googleDrive();
  const connected = (deps.projects?.() ?? store.data.projects ?? [])
    .filter((project) => project.connector?.kind === 'google_drive')
    .sort((a, b) => (a.connector!.lastSyncAt ?? '').localeCompare(b.connector!.lastSyncAt ?? ''))
    .map((project) => project.id);
  out.projects = connected.length;
  if (!provider.configured()) {
    out.notSetUp = 1;
    return out;
  }
  const deadline = Date.now() + (deps.budgetMs ?? RUN_BUDGET_MS);
  for (const [n, id] of connected.entries()) {
    const left = deadline - Date.now();
    if (left <= 0) {
      out.notReached = connected.length - n;
      break;
    }
    try {
      const run = await syncFolder(id, {
        now,
        provider,
        budgetMs: left,
        maxFiles: deps.maxFiles ?? FILES_A_PROJECT,
        ...(deps.source ? { source: deps.source } : {}),
        ...(deps.vault ? { vault: deps.vault } : {}),
      });
      if (run.busy) out.busy += 1;
      else if (run.error) out.failed += 1;
      else out.read += 1;
      out.takenIn += run.takenIn;
      out.changed += run.changed;
      out.skipped += run.skipped;
      out.waiting += run.waiting;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] drive folder of ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}
