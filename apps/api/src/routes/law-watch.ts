/**
 * Law and policy watch, for a firm (`/api/law-watch`).
 *
 * GET    /                          the sources, the changes waiting and lately decided, and what this person may do
 * POST   /sources                   add a source
 * PUT    /sources/:sourceId         change one, or pause it
 * DELETE /sources/:sourceId         take one off the list
 * POST   /sources/:sourceId/look    look at one now
 * GET    /changes/:changeId/pages   the page as it read before the change and after
 * POST   /changes/:changeId/confirm confirm a change, with the summary and the actions as the person leaves them
 * POST   /changes/:changeId/dismiss dismiss it as not relevant
 *
 * For the firm's own people. Somebody working from a grant is refused every
 * route: the list is the firm's, and a change names projects they may not
 * be on. The list is changed, and a look asked for, by a firm admin.
 * A change is confirmed or dismissed by a firm admin or by one of the firm's
 * people who leads a department on a project, where they may change a record
 * at all. A lead decides only for the projects they lead: the change is then
 * decided for those and waits on for the rest, until their leads decide too or
 * a firm admin closes it.
 *
 * Confirming is the only thing here that writes to a project. Until then a
 * change, and whatever a model proposed for it, is on this page alone.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DEPARTMENT_KEYS,
  LAW_ACTIONS_A_PROJECT,
  LAW_ACTION_TITLE,
  LAW_LOOK_DAYS,
  LAW_SUMMARY,
  STAGES,
  addLawSource,
  can,
  confirmLawChange,
  dismissLawChange,
  editLawSource,
  lawBearsOn,
  lawChangesShown,
  lawDepartmentsOn,
  lawProjectsToDecide,
  mayApplyLaw,
  mayReviewLaw,
  reachesEveryProject,
  removeLawSource,
  type DdProject,
  type LawReviewer,
  type LawWatchState,
} from '@realytica/shared';
import { lawWatchModelSetUp } from '@realytica/agents';
import { needs, principalOf } from '../auth/middleware';
import { forgetLawSource, lawChangePages, loadLawWatch, lookAtLawSources, saveLawWatch } from '../law-watch';
import { store } from '../store';

export const lawWatchRouter = Router();

// The firm's own people only. A collaborator holds `read` at the workspace level, so the capability alone would let them in.
lawWatchRouter.use(needs('read'), (req, res, next) => {
  if (!reachesEveryProject(principalOf(req).role)) {
    res.status(403).json({ error: 'The law and policy watch is for the firm’s own people.' });
    return;
  }
  next();
});

const KINDS = ['residential', 'commercial', 'mixed_use', 'industrial', 'logistics', 'hospitality', 'healthcare', 'institutional', 'large_campus', 'specialized'] as const;
const STAGE_KEYS = STAGES.map((stage) => stage.key) as [string, ...string[]];
const department = z.enum(DEPARTMENT_KEYS as unknown as [string, ...string[]]);

const sourceBody = z.object({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().min(8).max(500),
  jurisdiction: z.string().trim().max(60).default(''),
  governs: z.string().trim().max(240).default(''),
  departments: z.array(department).min(1).max(DEPARTMENT_KEYS.length),
  projectKinds: z.array(z.enum(KINDS)).max(KINDS.length).default([]),
  stages: z.array(z.enum(STAGE_KEYS)).max(STAGE_KEYS.length).default([]),
  everyDays: z.number().int().min(LAW_LOOK_DAYS.least).max(LAW_LOOK_DAYS.most),
  paused: z.boolean().optional(),
});

const confirmBody = z.object({
  summary: z.string().trim().min(1).max(LAW_SUMMARY),
  projects: z
    .array(z.object({ projectId: z.string().min(1).max(120), actions: z.array(z.object({ department, title: z.string().trim().min(1).max(LAW_ACTION_TITLE) })).max(LAW_ACTIONS_A_PROJECT) }))
    .max(50)
    .default([]),
});

const id = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);

function reviewer(req: Request): LawReviewer {
  const me = principalOf(req);
  return { email: me.email, role: me.role, ...(me.name ? { name: me.name } : {}) };
}

function firmProjects(tenantId: string): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return (store.data.projects ?? []).filter((project) => (project.tenantId ?? bootstrap) === tenantId);
}

/** The watch as one person is shown it. */
function shown(req: Request, state: LawWatchState) {
  const me = reviewer(req);
  const projects = firmProjects(principalOf(req).tenantId);
  const changes = lawChangesShown(state);
  return {
    sources: state.sources,
    waiting: changes.waiting.map((change) => {
      const source = state.sources.find((held) => held.id === change.sourceId);
      // The projects the source bears on that nobody has decided it for, and for each the departments this person may put an action under.
      const decided = new Set((change.decidedFor ?? []).map((held) => held.projectId));
      const bearsOn = source
        ? projects
            .filter((project) => !decided.has(project.id) && lawBearsOn(source, project))
            .map((project) => ({ id: project.id, name: project.name, departments: lawDepartmentsOn(source, project).filter((key) => mayApplyLaw(me, project, key)) }))
            .filter((project) => project.departments.length)
        : [];
      // A firm admin closes it; a lead decides while a project they lead still waits.
      return { ...change, bearsOn, mayDecide: can(me.role, 'admin') || lawProjectsToDecide(me, change, source, projects).length > 0 };
    }),
    decided: changes.decided,
    model: lawWatchModelSetUp(),
    mayManage: can(me.role, 'admin'),
    mayReview: mayReviewLaw(me, projects),
  };
}

function refuse(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  res.status(/^No (source|change|project) by that id/.test(message) ? 404 : /already\.$/.test(message) ? 409 : / needs a firm admin /.test(message) ? 403 : 400).json({ error: message });
}

lawWatchRouter.get('/', async (req, res) => {
  res.json(shown(req, await loadLawWatch(principalOf(req).tenantId)));
});

lawWatchRouter.post('/sources', needs('admin'), async (req, res) => {
  const parsed = sourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A source needs a title, an https address, at least one department, and how often to look.' });
    return;
  }
  const me = principalOf(req);
  const state = await loadLawWatch(me.tenantId);
  if (state.sources.length >= 60) {
    res.status(400).json({ error: 'The list holds 60 sources at most.' });
    return;
  }
  try {
    addLawSource(state, parsed.data as Parameters<typeof addLawSource>[1], randomUUID(), me.email, new Date().toISOString());
  } catch (err) {
    refuse(res, err);
    return;
  }
  await saveLawWatch(me.tenantId, state);
  res.status(201).json(shown(req, state));
});

lawWatchRouter.put('/sources/:sourceId', needs('admin'), async (req, res) => {
  const parsed = sourceBody.safeParse(req.body);
  const sourceId = id.safeParse(req.params.sourceId);
  if (!parsed.success || !sourceId.success) {
    res.status(400).json({ error: 'A source needs a title, an https address, at least one department, and how often to look.' });
    return;
  }
  const me = principalOf(req);
  const state = await loadLawWatch(me.tenantId);
  try {
    editLawSource(state, sourceId.data, parsed.data as Parameters<typeof editLawSource>[2]);
  } catch (err) {
    refuse(res, err);
    return;
  }
  await saveLawWatch(me.tenantId, state);
  res.json(shown(req, state));
});

lawWatchRouter.delete('/sources/:sourceId', needs('admin'), async (req, res) => {
  const sourceId = id.safeParse(req.params.sourceId);
  const me = principalOf(req);
  const state = await loadLawWatch(me.tenantId);
  try {
    removeLawSource(state, sourceId.success ? sourceId.data : '');
  } catch (err) {
    refuse(res, err);
    return;
  }
  await saveLawWatch(me.tenantId, state);
  if (sourceId.success) await forgetLawSource(me.tenantId, sourceId.data);
  res.json(shown(req, state));
});

lawWatchRouter.post('/sources/:sourceId/look', needs('admin'), async (req, res) => {
  const sourceId = id.safeParse(req.params.sourceId);
  const me = principalOf(req);
  const held = await loadLawWatch(me.tenantId);
  if (!sourceId.success || !held.sources.some((source) => source.id === sourceId.data)) {
    res.status(404).json({ error: 'No source by that id.' });
    return;
  }
  const readBefore = Boolean(held.sources.find((source) => source.id === sourceId.data)?.hash);
  const run = await lookAtLawSources(me.tenantId, new Date(), { only: sourceId.data });
  const source = run.state.sources.find((one) => one.id === sourceId.data);
  res.json({ ...shown(req, run.state), said: source?.lastError ?? (run.changed ? 'The page has changed. The change waits above.' : readBefore ? 'Read. Nothing has changed.' : 'Read. Watching starts from these words.') });
});

lawWatchRouter.get('/changes/:changeId/pages', async (req, res) => {
  const changeId = id.safeParse(req.params.changeId);
  const me = principalOf(req);
  const state = await loadLawWatch(me.tenantId);
  if (!changeId.success || !state.changes.some((change) => change.id === changeId.data)) {
    res.status(404).json({ error: 'No change by that id.' });
    return;
  }
  res.json(await lawChangePages(me.tenantId, changeId.data));
});

lawWatchRouter.post('/changes/:changeId/confirm', needs('write'), async (req, res) => {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send the summary, and for each project the actions that apply.' });
    return;
  }
  const me = principalOf(req);
  const projects = firmProjects(me.tenantId);
  if (!mayReviewLaw(reviewer(req), projects)) {
    res.status(403).json({ error: 'A firm admin or a department’s lead confirms a change.' });
    return;
  }
  // Each project named is read afresh first: another instance may have written it since this one last did.
  for (const row of parsed.data.projects) if (projects.some((project) => project.id === row.projectId)) await store.pullFresh(row.projectId).catch(() => undefined);
  const state = await loadLawWatch(me.tenantId);
  try {
    confirmLawChange(state, req.params.changeId ?? '', parsed.data as Parameters<typeof confirmLawChange>[2], reviewer(req), firmProjects(me.tenantId), new Date().toISOString());
  } catch (err) {
    refuse(res, err);
    return;
  }
  // The projects first: an action on a project with the change still shown as waiting can be seen and put right, the other way round cannot.
  await store.save();
  await saveLawWatch(me.tenantId, state);
  res.json(shown(req, state));
});

lawWatchRouter.post('/changes/:changeId/dismiss', needs('write'), async (req, res) => {
  const parsed = z.object({ why: z.string().trim().max(240).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say why in a line, or send nothing.' });
    return;
  }
  const me = principalOf(req);
  if (!mayReviewLaw(reviewer(req), firmProjects(me.tenantId))) {
    res.status(403).json({ error: 'A firm admin or a department’s lead dismisses a change.' });
    return;
  }
  const state = await loadLawWatch(me.tenantId);
  try {
    dismissLawChange(state, req.params.changeId ?? '', reviewer(req), parsed.data.why, new Date().toISOString(), firmProjects(me.tenantId));
  } catch (err) {
    refuse(res, err);
    return;
  }
  await saveLawWatch(me.tenantId, state);
  res.json(shown(req, state));
});
