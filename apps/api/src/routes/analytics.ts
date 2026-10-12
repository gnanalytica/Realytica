import { Router } from 'express';
import { z } from 'zod';
import { acrossProjects, departmentAnalytics, peopleAnalytics, readsAnalytics, type AnalyticsMember, type DdProject } from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';
import { projectFor } from '../auth/access';

/**
 * Numbers that say where to look: across the firm's projects, by department
 * inside one, and by person.
 *
 * All three are the firm's own. Somebody working from a grant is refused on
 * the router, before any handler, so a route added here later is refused to
 * them as well. The figures about a person are narrowed further by
 * `peopleAnalytics`: a person reads their own, a department lead reads those
 * of the projects they lead on, and a viewer reads nobody's.
 */
export const analyticsRouter = Router();

analyticsRouter.use(needs('read'), (req, res, next) => {
  if (!readsAnalytics(principalOf(req).role)) {
    res.status(403).json({ error: 'Analytics are for the firm’s own people.' });
    return;
  }
  next();
});

function firmProjects(tenantId: string): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return (store.data.projects ?? []).filter((p) => (p.tenantId ?? bootstrap) === tenantId);
}

analyticsRouter.get('/portfolio', (req, res) => {
  const me = principalOf(req);
  res.json(acrossProjects(firmProjects(me.tenantId).map((p) => projectFor(req, p)), new Date()));
});

const departmentsQuery = z.object({ project: z.string().trim().min(1).max(120) });

analyticsRouter.get('/departments', (req, res) => {
  const me = principalOf(req);
  const asked = departmentsQuery.safeParse(req.query);
  if (!asked.success) {
    res.status(400).json({ error: 'Validation failed', details: asked.error.flatten() });
    return;
  }
  const project = firmProjects(me.tenantId).find((p) => p.id === asked.data.project);
  // A project of another firm is not there, as everywhere else.
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(departmentAnalytics(projectFor(req, project), new Date()));
});

analyticsRouter.get('/people', (req, res) => {
  const me = principalOf(req);
  const members: AnalyticsMember[] = (store.data.memberships ?? [])
    .filter((m) => m.tenantId === me.tenantId)
    .map((m) => ({ email: m.email, role: m.role, ...(m.name ? { name: m.name } : {}) }));
  const people = peopleAnalytics(firmProjects(me.tenantId).map((p) => projectFor(req, p)), members, { email: me.email, role: me.role }, new Date());
  res.json({ generatedAt: new Date().toISOString(), people });
});
