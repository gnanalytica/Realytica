/**
 * The timer's part of the law and policy watch.
 *
 * Once a day, for every firm: look at each listed page that is due, and keep
 * what changed as a change waiting on a person. Nothing here reaches a
 * project. A change is put on projects only when a firm admin or a
 * department's lead confirms it (`routes/law-watch.ts`).
 *
 * Safe to call twice: a source looked at today is not due again today, so a
 * second run looks at nothing and writes nothing. One firm or one page
 * failing leaves the rest of the run to finish. A page that could not be
 * read is counted as failed and says why on its row.
 */

import { store } from '../store';
import { lookAtLawSources, type LawLookDeps } from '../law-watch';

/** Look at every firm's due sources as of `now`. Returns counts; never throws. */
export async function lawWatchCron(now: Date, deps?: Partial<LawLookDeps>): Promise<Record<string, number>> {
  const out = { firms: 0, looked: 0, changed: 0, failed: 0 };
  for (const tenant of store.data.tenants ?? []) {
    out.firms += 1;
    try {
      const run = await lookAtLawSources(tenant.id, now, deps ? { deps } : {});
      out.looked += run.looked;
      out.changed += run.changed;
      out.failed += run.failed;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] law watch for ${tenant.id}: ${(err as Error).message}`);
    }
  }
  return out;
}
