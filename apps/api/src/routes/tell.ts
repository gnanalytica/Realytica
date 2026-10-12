import { Router, type Request } from 'express';
import { z } from 'zod';
import { markTellRead, reachesEveryProject, setTellQuiet, tellQuieted, tellSaid, type DdProject, type TellLine } from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';
import { accessTo, liveGrant, projectFor } from '../auth/access';
import { tellChannels } from '../tell';

/**
 * What I have been told, across every project I can reach.
 *
 * GET  /                    my notices, newest first, and the projects I have quieted
 * POST /read                mark my notices read
 * PUT  /quiet/:projectId    quiet a project for me, or stop
 *
 * Every route is the caller's own: a notice is somebody's by its address,
 * and nothing here reads, marks or quiets for anybody else, whatever role
 * asks. A notice is worded from the caller's own copy of its project
 * (`projectFor`), so somebody working from a grant is shown nothing of a
 * paper their copy does not hold, and a project they hold no grant on is
 * not there: 404, as everywhere.
 */
export const tellRouter = Router();

const TELL_SHOWN = 200;

function reachable(req: Request): DdProject[] {
  const me = principalOf(req);
  const bootstrap = store.data.tenants?.[0]?.id;
  const mine = (store.data.projects ?? []).filter((project) => (project.tenantId ?? bootstrap) === me.tenantId);
  return reachesEveryProject(me.role) ? mine : mine.filter((project) => liveGrant(me.tenantId, project.id, me.email));
}

function linesFor(req: Request, project: DdProject): TellLine[] {
  const me = principalOf(req).email.trim().toLowerCase();
  const notices = (project.tell?.notices ?? []).filter((notice) => notice.to === me);
  if (!notices.length) return [];
  const copy = projectFor(req, project);
  return notices.flatMap((notice) => tellSaid(copy, notice) ?? []);
}

tellRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const projects = reachable(req);
  const lines = projects.flatMap((project) => linesFor(req, project)).sort((a, b) => b.at.localeCompare(a.at));
  res.json({
    notices: lines.slice(0, TELL_SHOWN),
    unread: lines.filter((line) => !line.read).length,
    quiet: projects.filter((project) => tellQuieted(project, me.email)).map((project) => ({ projectId: project.id, projectName: project.name, projectReference: project.reference })),
    // Whether anything can leave the app for this person: mail needs a key on the deployment, push a paired phone.
    channels: tellChannels(me.email),
    asOf: new Date().toISOString(),
  });
});

const readSchema = z.object({ ids: z.union([z.literal('all'), z.array(z.string().min(1).max(160)).min(1).max(500)]) });

tellRouter.post('/read', needs('read'), async (req, res) => {
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const me = principalOf(req);
  let read = 0;
  for (const project of reachable(req)) {
    // Only what the caller is shown: a notice their copy no longer words is not theirs to mark.
    const shown = new Set(linesFor(req, project).map((line) => line.id));
    const ids = parsed.data.ids === 'all' ? [...shown] : parsed.data.ids.filter((id) => shown.has(id));
    const n = ids.length ? markTellRead(project, ids, me.email) : 0;
    if (n) project.updatedAt = new Date().toISOString();
    read += n;
  }
  if (parsed.data.ids !== 'all' && read === 0) {
    res.status(404).json({ error: 'Nothing told to you by that record.' });
    return;
  }
  if (read) await store.save();
  res.json({ read });
});

const quietSchema = z.object({ quiet: z.boolean() });

tellRouter.put('/quiet/:projectId', needs('read'), async (req, res) => {
  const parsed = quietSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const project = (store.data.projects ?? []).find((held) => held.id === req.params.projectId);
  if (!project || !accessTo(req, project).ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const me = principalOf(req);
  if (tellQuieted(project, me.email) !== parsed.data.quiet) {
    setTellQuiet(project, me.email, parsed.data.quiet);
    project.updatedAt = new Date().toISOString();
    await store.save();
  }
  res.json({ projectId: project.id, quiet: parsed.data.quiet });
});
