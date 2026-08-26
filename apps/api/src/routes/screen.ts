import { Router } from 'express';
import { runScreen, REFERENCE_DATA } from '@valytica/shared';
import { store } from '../store';
import { riskStatusBodySchema, actionDoneBodySchema } from '../schemas';
import { findCase } from './cases';

export const screenRouter = Router({ mergeParams: true });

// mergeParams sub-routers only get the parent :id typed when we say so
// explicitly — Express infers req.params purely from this route's own path.
screenRouter.post<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const now = new Date().toISOString();
  const result = runScreen({
    caseId: found.id,
    reference: found.reference,
    identity: found.identity,
    documents: found.documents,
    refData: REFERENCE_DATA,
    now,
    previousResult: found.result,
  });
  found.result = result;
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
