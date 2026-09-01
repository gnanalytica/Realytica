/**
 * Keeping the stored graph level with the project store.
 *
 * The projection is cheap and pure, so the question is only WHEN to run it.
 * After every mutation, for the projects that actually moved: a file whose
 * `updatedAt` has not changed cannot have produced a different graph, and
 * rebuilding every project on every save would make an upload to one cost a
 * projection of the whole workspace.
 *
 * Awaited rather than fired off, for the same reason `store.save()` is: on
 * serverless the process can be frozen the moment a response is sent, so work
 * left running after it is work that may never happen. But a failure here is
 * swallowed — the graph is an index over data that is already durable in the
 * project store, and a graph store being unreachable must not fail an upload.
 * It is logged once per file rather than silently, because a graph quietly
 * months out of date is worse than one obviously missing.
 *
 * This used to take a `cases` array too and project a second graph family from
 * it. That array is always empty — no mounted route creates a `PropertyCase`
 * and the demo reset clears it outright — so the loop ran over nothing on
 * every save while making the case graph look persisted. It is gone; see
 * `types.ts` for what replaced it.
 */

import { buildProjectGraph, type DdProject } from '@realytica/shared';
import { graphAdapter } from './index';

/** projectId -> the `updatedAt` the stored graph was built from. */
const synced = new Map<string, string>();

export async function syncGraph(projects: DdProject[]): Promise<void> {
  const live = new Set(projects.map(p => p.id));

  for (const project of projects) {
    if (synced.get(project.id) === project.updatedAt) continue;
    try {
      const built = buildProjectGraph(project);
      await graphAdapter.syncProject({
        projectId: project.id,
        builtAt: project.updatedAt,
        nodes: built.nodes,
        edges: built.edges,
      });
      synced.set(project.id, project.updatedAt);
    } catch (err) {
      console.warn(`[graph] could not sync project ${project.id}: ${(err as Error).message}`);
    }
  }

  // A project deleted from the store must not leave its graph behind — it
  // holds owner names and document titles, and "deleted" has to mean deleted.
  for (const projectId of [...synced.keys()]) {
    if (live.has(projectId)) continue;
    try {
      await graphAdapter.purgeProject(projectId);
      synced.delete(projectId);
    } catch (err) {
      console.warn(`[graph] could not purge project ${projectId}: ${(err as Error).message}`);
    }
  }
}

/** Forgets what has been synced, so the next call rebuilds everything. Tests only. */
export function resetSyncState(): void {
  synced.clear();
}
