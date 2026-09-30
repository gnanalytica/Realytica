import { Router } from 'express';
import { isSampleProject, type DdProject } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { graphAdapter } from '../graph';
import { forgetProjects } from '../memory';
import { needs, principalOf } from '../auth/middleware';
import { SAMPLE_REFERENCES, buildSampleEngagements } from '../sample-engagements';

/**
 * The labelled sample engagements, on request only.
 *
 * Nothing seeds at boot. A workspace holds client files, so both routes here
 * touch sample projects and nothing else: loading adds the samples that are
 * missing, and refreshing replaces the samples with fresh copies. A client
 * project is never removed by either, whatever it is called.
 */

function workspaceProjects(tenantId: string): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return (store.data.projects ?? []).filter((p) => (p.tenantId ?? bootstrap) === tenantId);
}

/**
 * Remove projects with everything they leave behind: their grants, what they
 * taught memory, their graph and their documents.
 */
async function removeProjects(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const gone = new Set(ids);
  store.data.projects = (store.data.projects ?? []).filter((p) => !gone.has(p.id));
  if (store.data.projectIds) store.data.projectIds = store.data.projectIds.filter((id) => !gone.has(id));
  await forgetProjects(ids);
  for (const id of ids) {
    try {
      await graphAdapter.purgeProject(id);
    } catch (err) {
      console.warn(`[samples] could not purge the graph for ${id}: ${(err as Error).message}`);
    }
    try {
      await storageAdapter.deleteCaseDocuments(id);
    } catch (err) {
      console.warn(`[samples] could not remove documents for ${id}: ${(err as Error).message}`);
    }
  }
}

/** Add whichever samples this workspace is missing. */
export async function seedDemoProjects(tenantId: string): Promise<number> {
  if (!store.data.projects) store.data.projects = [];
  const present = new Set(workspaceProjects(tenantId).filter(isSampleProject).map((p) => p.reference));
  const missing = SAMPLE_REFERENCES.filter((reference) => !present.has(reference));
  if (!missing.length) return 0;
  const built = await buildSampleEngagements(missing);
  for (const project of built) {
    project.tenantId = tenantId;
    store.data.projects.push(project);
  }
  await store.save();
  return built.length;
}

/**
 * Replace this workspace's samples with fresh ones.
 *
 * The new ones are built before anything is removed, so a failure part-way
 * leaves the old samples where they were rather than none at all.
 */
export async function refreshSampleProjects(tenantId: string): Promise<{ removed: number; created: number }> {
  if (!store.data.projects) store.data.projects = [];
  const built = await buildSampleEngagements();
  const old = workspaceProjects(tenantId).filter(isSampleProject).map((p) => p.id);
  await removeProjects(old);
  for (const project of built) {
    project.tenantId = tenantId;
    store.data.projects.push(project);
  }
  await store.save();
  return { removed: old.length, created: built.length };
}

export const demoRouter = Router();

demoRouter.post('/seed', needs('admin'), async (req, res) => {
  const created = await seedDemoProjects(principalOf(req).tenantId);
  res.json({ created });
});

demoRouter.post('/samples/refresh', needs('admin'), async (req, res) => {
  const out = await refreshSampleProjects(principalOf(req).tenantId);
  res.json(out);
});
