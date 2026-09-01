import { Router } from 'express';
import { seedBdaReferenceProject, seedDemoProject } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';

export async function seedDemoProjects(): Promise<number> {
  if (!store.data.projects) store.data.projects = [];
  let created = 0;
  if (!store.data.projects.some((p) => p.reference === 'RYT-0001' || p.name === 'Harohalli Greenfield Township')) {
    store.data.projects.push(seedDemoProject());
    created += 1;
  }
  if (!store.data.projects.some((p) => p.reference === 'RYT-0003' || p.name === 'Koramangala 4th Block infill')) {
    store.data.projects.push(seedBdaReferenceProject());
    created += 1;
  }
  const seq = store.data.nextProjectSeq ?? 1;
  if (seq < 4) store.data.nextProjectSeq = 4;
  if (created) await store.save();
  return created;
}

export const demoRouter = Router();

demoRouter.post('/seed', async (_req, res) => {
  const created = await seedDemoProjects();
  res.json({ created });
});

demoRouter.post('/reset', async (_req, res) => {
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
  const created = await seedDemoProjects();
  res.json({ ok: true, created });
});
