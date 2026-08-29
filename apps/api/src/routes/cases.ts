import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { CaseSummary, PropertyCase } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { createCaseSchema, updateCaseSchema } from '../schemas';

export function toCaseSummary(c: PropertyCase): CaseSummary {
  const openCriticalRisks =
    c.result?.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length ?? 0;
  return {
    id: c.id,
    reference: c.reference,
    label: c.identity.label,
    city: c.identity.city,
    locality: c.identity.locality,
    country: c.identity.country,
    propertyType: c.identity.propertyType,
    status: c.status,
    updatedAt: c.updatedAt,
    documentCount: c.documents.length,
    currency: c.identity.currency,
    askingPrice: c.identity.askingPrice,
    indicativeLow: c.result?.indicativeValue.low,
    indicativeMid: c.result?.indicativeValue.mid,
    indicativeHigh: c.result?.indicativeValue.high,
    confidenceScore: c.result?.confidence.score,
    confidenceBand: c.result?.confidence.band,
    completenessScore: c.result?.completeness.score,
    verdict: c.result?.recommendation.verdict,
    openCriticalRisks,
  };
}

export function findCase(caseId: string): PropertyCase | undefined {
  return store.data.cases.find((c) => c.id === caseId);
}

export const casesRouter = Router();

casesRouter.get('/', (_req, res) => {
  const summaries = store.data.cases
    .map(toCaseSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(summaries);
});

casesRouter.post('/', async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const newCase: PropertyCase = {
    id: randomUUID(),
    reference: store.nextReference(),
    identity: parsed.data.identity,
    status: 'draft',
    persona: parsed.data.persona,
    ownerName: parsed.data.ownerName,
    createdAt: now,
    updatedAt: now,
    documents: [],
    notes: parsed.data.notes ?? '',
  };
  store.data.cases.push(newCase);
  await store.save();
  res.status(201).json(newCase);
});

casesRouter.get('/:id', (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json(found);
});

casesRouter.patch('/:id', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = updateCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  if (body.identity) found.identity = { ...found.identity, ...body.identity };
  if (body.status) found.status = body.status;
  if (body.persona) found.persona = body.persona;
  // Widening disclosure changes what may leave the system on the *next*
  // search. It never retroactively re-runs anything: findings already on the
  // case were produced under the level in force when they were found, and
  // each one records which that was.
  if (body.disclosure) found.disclosure = body.disclosure;
  if (body.ownerName !== undefined) found.ownerName = body.ownerName;
  if (body.notes !== undefined) found.notes = body.notes;
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.json(found);
});

casesRouter.delete('/:id', async (req, res) => {
  const idx = store.data.cases.findIndex((c) => c.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const [removed] = store.data.cases.splice(idx, 1);
  try {
    // removed.id is the id of an entity we actually found in the store, never
    // the raw (unvalidated) path param.
    await storageAdapter.deleteCaseDocuments(removed.id);
  } catch {
    /* a case with no stored documents (e.g. demo-seeded) has nothing to remove */
  }
  await store.save();
  res.status(204).end();
});
