/**
 * Keeping the stored graph level with the case store.
 *
 * The projection is cheap and pure, so the question is only WHEN to run it.
 * After every mutation, for the cases that actually moved: a case whose
 * `updatedAt` has not changed cannot have produced a different graph, and
 * rebuilding every case on every save would make an upload to one file cost a
 * projection of the whole workspace.
 *
 * Awaited rather than fired off, for the same reason `store.save()` is: on
 * serverless the process can be frozen the moment a response is sent, so work
 * left running after it is work that may never happen. But a failure here is
 * swallowed — the graph is an index over data that is already durable in the
 * case store, and a graph store being unreachable must not fail an upload.
 * It is logged once per case rather than silently, because a graph quietly
 * months out of date is worse than one obviously missing.
 */

import { buildDdGraph, type PropertyCase } from '@realytica/shared';
import { graphAdapter } from './index';

/** caseId -> the `updatedAt` the stored graph was built from. */
const synced = new Map<string, string>();

export async function syncGraph(cases: PropertyCase[]): Promise<void> {
  const live = new Set(cases.map(c => c.id));

  for (const propertyCase of cases) {
    if (synced.get(propertyCase.id) === propertyCase.updatedAt) continue;
    try {
      await graphAdapter.sync(buildDdGraph(propertyCase, propertyCase.updatedAt));
      synced.set(propertyCase.id, propertyCase.updatedAt);
    } catch (err) {
      console.warn(`[graph] could not sync case ${propertyCase.id}: ${(err as Error).message}`);
    }
  }

  // A case deleted from the store must not leave its graph behind — it holds
  // owner names and document titles, and "deleted" has to mean deleted.
  for (const caseId of [...synced.keys()]) {
    if (live.has(caseId)) continue;
    try {
      await graphAdapter.purge(caseId);
      synced.delete(caseId);
    } catch (err) {
      console.warn(`[graph] could not purge case ${caseId}: ${(err as Error).message}`);
    }
  }
}

/** Forgets what has been synced, so the next call rebuilds everything. Tests only. */
export function resetSyncState(): void {
  synced.clear();
}
