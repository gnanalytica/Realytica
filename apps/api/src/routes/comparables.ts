/**
 * A project's comparables: the register a market rate is drawn from.
 *
 * GET    /             the register, the last search, and whether portal search is set up
 * POST   /search       search 99acres and MagicBricks; what is found lands as proposed
 * POST   /             add a comparable by hand
 * PATCH  /:id          change a comparable's adjustments or weight
 * POST   /decide       accept or set aside comparables by id
 */

import { Router } from 'express';
import { z } from 'zod';
import { actorOf, addComparable, comparableSchedule, decideComparables, noteProjectEdit, updateComparable } from '@realytica/shared';
import { principalOf } from '../auth/middleware';
import { store } from '../store';
import { runComparableSearch, unblockerConfigured } from '../comparables/search';

type ProjectParams = { projectId: string };

function findProject(id: string | undefined) {
  if (!id) return undefined;
  return store.data.projects?.find((p) => p.id === id);
}

const adjustmentsSchema = z
  .object({
    time: z.number().min(-60).max(60).optional(),
    size: z.number().min(-60).max(60).optional(),
    location: z.number().min(-60).max(60).optional(),
    condition: z.number().min(-60).max(60).optional(),
    listing: z.number().min(-60).max(60).optional(),
  })
  .strict();

const addSchema = z.object({
  title: z.string().trim().min(1).max(200),
  price: z.number().positive(),
  areaSqm: z.number().positive(),
  areaBasis: z.enum(['carpet', 'builtup', 'super_builtup', 'plot']).optional(),
  date: z.string().max(40).optional(),
  sourceUrl: z.string().url().max(600).optional(),
  evidenceId: z.string().max(80).optional(),
  distanceKm: z.number().min(0).max(100).optional(),
  kind: z.enum(['listing', 'transaction']).optional(),
  adjustments: adjustmentsSchema.optional(),
  weight: z.number().min(0).max(10).optional(),
  note: z.string().max(1000).optional(),
});

const patchSchema = z.object({ adjustments: adjustmentsSchema.optional(), weight: z.number().min(0).max(10).optional(), note: z.string().max(1000).optional() });
const decideSchema = z.object({ ids: z.array(z.string().min(1).max(80)).min(1).max(60), decision: z.enum(['accept', 'reject']) });

export const projectComparablesRouter = Router({ mergeParams: true });

projectComparablesRouter.get<ProjectParams>('/', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ configured: unblockerConfigured(), comparables: project.comparables ?? [], search: project.comparableSearch ?? null, schedule: comparableSchedule(project) });
});

projectComparablesRouter.post<ProjectParams>('/search', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const outcome = await runComparableSearch(project, actorOf(principalOf(req)));
  if (!outcome.ok) {
    res.status(outcome.notConfigured ? 503 : 422).json({ error: outcome.reason, notConfigured: !!outcome.notConfigured });
    return;
  }
  noteProjectEdit(
    project,
    outcome.search.found
      ? `Searched 99acres and MagicBricks near ${outcome.search.localities[0] ?? project.location}: ${outcome.search.found} comparable${outcome.search.found === 1 ? '' : 's'} within ${outcome.search.radiusKm} km.`
      : `Searched 99acres and MagicBricks near ${outcome.search.localities[0] ?? project.location} and found no comparable.`,
  );
  await store.save();
  res.json({ project, found: outcome.search.found, added: outcome.added.map((c) => c.id), ...(outcome.search.empty ? { empty: outcome.search.empty } : {}) });
});

projectComparablesRouter.post<ProjectParams>('/', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const comparable = addComparable(project, parsed.data, actorOf(principalOf(req)));
    noteProjectEdit(project, `Added a comparable: ${comparable.title}.`);
    await store.save();
    res.status(201).json({ project, comparable });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not add the comparable' });
  }
});

projectComparablesRouter.patch<ProjectParams & { comparableId: string }>('/:comparableId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    updateComparable(project, req.params.comparableId, parsed.data, actorOf(principalOf(req)));
    await store.save();
    res.json({ project });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not change the comparable' });
  }
});

projectComparablesRouter.post<ProjectParams>('/decide', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const n = decideComparables(project, parsed.data.ids, parsed.data.decision, actorOf(principalOf(req)));
  if (n) {
    noteProjectEdit(project, `${parsed.data.decision === 'accept' ? 'Accepted' : 'Set aside'} ${n} comparable${n === 1 ? '' : 's'}.`);
    await store.save();
  }
  res.json({ project, changed: n });
});
