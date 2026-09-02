import { Router } from 'express';
import { seedBdaReferenceProject, seedDemoProject } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { graphAdapter } from '../graph';
import { forgetProjects } from '../memory';
import { needs, principalOf } from '../auth/middleware';

/**
 * `tenantId` is passed in rather than looked up: a seeded project has to land
 * in the workspace of whoever asked for it, and boot-time seeding (before
 * anybody has signed in) leaves it unset for the first workspace to adopt.
 */
export async function seedDemoProjects(tenantId?: string): Promise<number> {
  if (!store.data.projects) store.data.projects = [];
  let created = 0;
  const own = (project: ReturnType<typeof seedDemoProject>) => {
    if (tenantId) project.tenantId = tenantId;
    return project;
  };
  /*
   * "Already seeded" is asked of this workspace, not of the deployment.
   *
   * Asking it globally means a second firm signing in sees no demo files
   * because the first firm holds RYT-0001, and — worse — a workspace that has
   * just reset itself gets nothing back for the same reason.
   */
  const bootstrap = store.data.tenants?.[0]?.id;
  const here = store.data.projects.filter((p) => (p.tenantId ?? bootstrap) === (tenantId ?? bootstrap));
  if (!here.some((p) => p.reference === 'RYT-0001' || p.name === 'Harohalli Greenfield Township')) {
    store.data.projects.push(own(seedDemoProject()));
    created += 1;
  }
  if (!here.some((p) => p.reference === 'RYT-0003' || p.name === 'Koramangala 4th Block infill')) {
    store.data.projects.push(own(seedBdaReferenceProject()));
    created += 1;
  }
  const seq = store.data.nextProjectSeq ?? 1;
  if (seq < 4) store.data.nextProjectSeq = 4;
  if (created) await store.save();
  return created;
}

export const demoRouter = Router();

demoRouter.post('/seed', needs('admin'), async (req, res) => {
  const created = await seedDemoProjects(principalOf(req).tenantId);
  res.json({ created });
});

/**
 * Start this workspace over.
 *
 * It used to wipe every project in the store and argue that owner-only made
 * that safe. It does not: an owner of one workspace is not entitled to
 * another's data, and a deployment where any owner can destroy every firm's
 * files is the same defect as one where any admin can rewrite every firm's
 * prompts — authority larger than the role that granted it. So it removes this
 * workspace's projects and nothing else, and the seed puts the demo files back
 * where the caller can see them.
 *
 * Everything the projects leave behind goes with them: their grants, what they
 * taught memory, their graph, their documents. A reset that left those would
 * be a reset that kept the owner names it claimed to have removed.
 */
demoRouter.post('/reset', needs('owner'), async (req, res) => {
  const me = principalOf(req);
  const bootstrap = store.data.tenants?.[0]?.id;
  const all = store.data.projects ?? [];
  const mine = all.filter((p) => (p.tenantId ?? bootstrap) === me.tenantId);
  const ids = mine.map((p) => p.id);

  store.data.projects = all.filter((p) => !ids.includes(p.id));
  // The shard index loses only what went, or the core document would name
  // documents that no longer exist — or forget ones that still do.
  if (store.data.projectIds) store.data.projectIds = store.data.projectIds.filter((id) => !ids.includes(id));
  await forgetProjects(ids);

  for (const id of ids) {
    try {
      await graphAdapter.purgeProject(id);
    } catch (err) {
      console.warn(`[demo] could not purge the graph for ${id}: ${(err as Error).message}`);
    }
    try {
      await storageAdapter.deleteCaseDocuments(id);
    } catch (err) {
      console.warn(`[demo] could not remove documents for ${id}: ${(err as Error).message}`);
    }
  }

  await store.save();
  const created = await seedDemoProjects(me.tenantId);
  res.json({ ok: true, removed: ids.length, created });
});
