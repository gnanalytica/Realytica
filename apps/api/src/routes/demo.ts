import { Router } from 'express';
import { seedDemoProject } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';

export async function seedDemoProjects(): Promise<number> {
  if (!store.data.projects) store.data.projects = [];
  if (store.data.projects.some((p) => p.reference === 'RYT-0001' || p.name === 'Harohalli Greenfield Township')) {
    return 0;
  }
  const project = seedDemoProject();
  store.data.projects.push(project);
  const seq = store.data.nextProjectSeq ?? 1;
  if (seq < 2) store.data.nextProjectSeq = 2;
  await store.save();
  return 1;
}

export const demoRouter = Router();

demoRouter.post('/seed', async (_req, res) => {
  const projects = await seedDemoProjects();
  res.json({ created: 0, projects });
});

demoRouter.post('/reset', async (_req, res) => {
  store.data.cases = [];
  store.data.nextReferenceSeq = 1;
  store.data.projects = [];
  store.data.nextProjectSeq = 1;
  store.data.intakeSessions = [];
  try {
    await storageAdapter.deleteAllDocuments();
  } catch {
    /* nothing stored yet — reset still succeeds */
  }
  await store.save();
  const projects = await seedDemoProjects();
  res.json({ ok: true, created: 0, projects });
});
