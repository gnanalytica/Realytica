import { Router } from 'express';
import { runScreen, REFERENCE_DATA, inferProjectKind, assessmentFitCaution } from '@realytica/shared';
import { store } from '../store';
import { riskStatusBodySchema, actionDoneBodySchema, projectBriefBodySchema } from '../schemas';
import { findCase } from './cases';
import { ensureSiteContext } from '../site-context';

export const screenRouter = Router({ mergeParams: true });
export const projectRouter = Router({ mergeParams: true });

// mergeParams sub-routers only get the parent :id typed when we say so
// explicitly — Express infers req.params purely from this route's own path.
/**
 * Set the project kind by hand and re-screen against it.
 *
 * This is the correction half of the inference: the engine concludes what
 * kind of project this is and says so, and this is how a person who knows
 * better overrules it. The brief is stored with `source: 'user'`, which
 * `resolveProjectBrief` treats as final — no later document, and no later
 * run, silently reverts it.
 *
 * The screen re-runs immediately rather than leaving the case showing
 * numbers produced under the previous method. A stated kind that has not
 * changed the figures on screen is worse than not asking.
 */
projectRouter.put<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = projectBriefBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid project brief', details: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const { kind, intent, unitsPlanned } = parsed.data;
  // The inference is kept alongside the user's choice rather than discarded,
  // so the case still records what the evidence pointed at and how far the
  // person's answer moved it.
  const inference = inferProjectKind(found.identity, {
    documentKinds: found.documents.map(d => d.kind),
    intent,
  });
  found.project = {
    kind,
    source: 'user',
    intent: intent ?? found.project?.intent ?? 'unknown',
    inference,
    unitsPlanned: unitsPlanned ?? found.project?.unitsPlanned,
    fitCaution: assessmentFitCaution(found.identity, kind),
    decidedAt: now,
  };

  const siteContext = await ensureSiteContext(found, now);
  found.result = runScreen({
    caseId: found.id,
    reference: found.reference,
    identity: found.identity,
    documents: found.documents,
    refData: REFERENCE_DATA,
    now,
    previousResult: found.result,
    siteContext,
    project: found.project,
  });
  found.status = 'screened';
  found.updatedAt = now;
  await store.save();
  res.json(found.result);
});

screenRouter.post<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const now = new Date().toISOString();
  // Built before the screen rather than after, because the screen prices a
  // transit driver off it. Cached against the address, so this is free unless
  // the address changed; never throws, so a mapping outage cannot stop a
  // screen.
  const siteContext = await ensureSiteContext(found, now);
  const result = runScreen({
    caseId: found.id,
    reference: found.reference,
    identity: found.identity,
    documents: found.documents,
    refData: REFERENCE_DATA,
    now,
    previousResult: found.result,
    siteContext,
    project: found.project,
  });
  found.result = result;
  // Persist the brief the engine settled on, so the next run starts from it
  // and the case carries a project kind even if it was never stated. An
  // inferred brief is stored as inferred — it is a working assumption until
  // someone confirms it, and overwriting a user-set one is what
  // `resolveProjectBrief` refuses to do.
  found.project = result.project;
  found.status = 'screened';
  found.updatedAt = now;
  await store.save();
  res.json(result);
});

export const risksRouter = Router({ mergeParams: true });

risksRouter.patch<{ id: string; riskId: string }>('/:riskId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  if (!found.result) {
    res.status(400).json({ error: 'Case has no screen result yet' });
    return;
  }
  const risk = found.result.risks.find((r) => r.id === req.params.riskId);
  if (!risk) {
    res.status(404).json({ error: 'Risk not found' });
    return;
  }
  const parsed = riskStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  risk.status = parsed.data.status;
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.json(found.result);
});

export const actionsRouter = Router({ mergeParams: true });

actionsRouter.patch<{ id: string; actionId: string }>('/:actionId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  if (!found.result) {
    res.status(400).json({ error: 'Case has no screen result yet' });
    return;
  }
  const action = found.result.actions.find((a) => a.id === req.params.actionId);
  if (!action) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  const parsed = actionDoneBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  action.done = parsed.data.done;
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.json(found.result);
});
