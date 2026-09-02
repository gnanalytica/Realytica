import { Router } from 'express';
import { seedBdaReferenceProject, seedDemoProject } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';
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
  if (!store.data.projects.some((p) => p.reference === 'RYT-0001' || p.name === 'Harohalli Greenfield Township')) {
    store.data.projects.push(own(seedDemoProject()));
    created += 1;
  }
  if (!store.data.projects.some((p) => p.reference === 'RYT-0003' || p.name === 'Koramangala 4th Block infill')) {
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
 * Wipes every project in the store, not just this workspace's.
 *
 * Owner-only, therefore, and it stays owner-only: a demo convenience that any
 * admin of any workspace could fire is a way to lose somebody else's data.
 */
demoRouter.post('/reset', needs('owner'), async (req, res) => {
  store.data.cases = [];
  store.data.nextReferenceSeq = 1;
  store.data.projects = [];
  store.data.nextProjectSeq = 1;
  // The shard index goes too, or a reset would leave the core document
  // naming project documents that `deleteAllDocuments` just removed.
  store.data.projectIds = [];
  store.data.intakeSessions = [];
  try {
    await storageAdapter.deleteAllDocuments();
  } catch {
    /* nothing stored yet — reset still succeeds */
  }
  await store.save();
  const created = await seedDemoProjects(principalOf(req).tenantId);
  res.json({ ok: true, created });
});
