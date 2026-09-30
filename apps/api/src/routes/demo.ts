import { Router } from 'express';
import { seedBdaReferenceProject, seedDemoProject } from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';

/**
 * The labelled sample engagements, on request only.
 *
 * Nothing seeds at boot and nothing resets: a workspace holds client files,
 * and a route that deleted every project in it to put the samples back was
 * one click from losing a firm's real work. The samples are marked `sample`
 * so every surface can say what they are.
 *
 * `tenantId` is passed in rather than looked up: a seeded project has to land
 * in the workspace of whoever asked for it.
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
