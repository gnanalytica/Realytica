/**
 * Keeping the stored graph level with the case and project stores.
 *
 * The projection is cheap and pure, so the question is only WHEN to run it.
 * After every mutation, for the cases and projects that actually moved: a
 * record whose `updatedAt` has not changed cannot have produced a different
 * graph, and rebuilding every file on every save would make an upload to one
 * cost a projection of the whole workspace.
 *
 * Awaited rather than fired off, for the same reason `store.save()` is: on
 * serverless the process can be frozen the moment a response is sent, so work
 * left running after it is work that may never happen. But a failure here is
 * swallowed — the graph is an index over data that is already durable in the
 * case/project store, and a graph store being unreachable must not fail an
 * upload. It is logged once per file rather than silently, because a graph
 * quietly months out of date is worse than one obviously missing.
 */

import { buildDdGraph, buildProjectGraph, type DdProject, type PropertyCase } from '@realytica/shared';
import { graphAdapter } from './index';

/** caseId -> the `updatedAt` the stored graph was built from. */
const synced = new Map<string, string>();
/** projectId -> the `updatedAt` the stored cockpit graph was built from. */
const syncedProjects = new Map<string, string>();

export async function syncGraph(cases: PropertyCase[], projects: DdProject[] = []): Promise<void> {
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

  await syncProjectGraphs(projects);
}

async function syncProjectGraphs(projects: DdProject[]): Promise<void> {
  const live = new Set(projects.map(p => p.id));

  for (const project of projects) {
    if (syncedProjects.get(project.id) === project.updatedAt) continue;
    try {
      const built = buildProjectGraph(project);
      await graphAdapter.syncProject({
        projectId: project.id,
        builtAt: project.updatedAt,
        nodes: built.nodes,
        edges: built.edges,
      });
      syncedProjects.set(project.id, project.updatedAt);
    } catch (err) {
      console.warn(`[graph] could not sync project ${project.id}: ${(err as Error).message}`);
    }
  }

  for (const projectId of [...syncedProjects.keys()]) {
    if (live.has(projectId)) continue;
    try {
      await graphAdapter.purgeProject(projectId);
      syncedProjects.delete(projectId);
    } catch (err) {
      console.warn(`[graph] could not purge project ${projectId}: ${(err as Error).message}`);
    }
  }
}

/** Forgets what has been synced, so the next call rebuilds everything. Tests only. */
export function resetSyncState(): void {
  synced.clear();
  syncedProjects.clear();
}
