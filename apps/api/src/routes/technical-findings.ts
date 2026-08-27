import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { TechnicalFinding } from '@realytica/shared';
import { technicalDocumentItem } from '@realytica/shared';
import { store } from '../store';
import { findCase } from './cases';
import {
  technicalDocumentsProvidedBodySchema,
  technicalFindingDraftSchema,
  technicalFindingReviewBodySchema,
  updateTechnicalFindingSchema,
} from '../schemas';

/**
 * Technical/construction due diligence: findings about the building's
 * condition, and the discipline-by-discipline document checklist they draw
 * on. Kept as its own router (mounted at `/api/cases/:id/technical-findings`
 * and `/api/cases/:id/technical-documents`) rather than folded into the
 * general case PATCH — a finding is a case-scoped collection with its own
 * accept/reject lifecycle, the same reason risks and documents each have
 * their own router.
 */
export const technicalFindingsRouter = Router({ mergeParams: true });

technicalFindingsRouter.post<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = technicalFindingDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  // A missing evidence document id would silently point a reviewer at a
  // photo that does not exist on this case — the same integrity the
  // documents route already enforces for every other id it accepts.
  const unknownDoc = parsed.data.evidenceDocumentIds.find((docId) => !found.documents.some((d) => d.id === docId));
  if (unknownDoc) {
    res.status(400).json({ error: `Document ${unknownDoc} is not on this case` });
    return;
  }
  const now = new Date().toISOString();
  const finding: TechnicalFinding = {
    ...parsed.data,
    id: randomUUID(),
    caseId: found.id,
    source: 'user',
    // A person authoring their own observation has nothing to review —
    // the proposal step exists for an agent's claim, not a user's own.
    reviewState: 'accepted',
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  found.technicalFindings = [...(found.technicalFindings ?? []), finding];
  found.updatedAt = now;
  await store.save();
  res.status(201).json(finding);
});

technicalFindingsRouter.patch<{ id: string; findingId: string }>('/:findingId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const finding = found.technicalFindings?.find((f) => f.id === req.params.findingId);
  if (!finding) {
    res.status(404).json({ error: 'Finding not found' });
    return;
  }
  const parsed = updateTechnicalFindingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.evidenceDocumentIds) {
    const unknownDoc = parsed.data.evidenceDocumentIds.find((docId) => !found.documents.some((d) => d.id === docId));
    if (unknownDoc) {
      res.status(400).json({ error: `Document ${unknownDoc} is not on this case` });
      return;
    }
  }
  Object.assign(finding, parsed.data);
  finding.updatedAt = new Date().toISOString();
  found.updatedAt = finding.updatedAt;
  await store.save();
  res.json(finding);
});

/**
 * Accept or reject a proposal — the one transition that matters enough to
 * have its own endpoint. Only a `proposed` finding can move; accepting or
 * rejecting an already-decided one is a no-op response naming what it
 * already is, never a silent overwrite of an earlier person's decision.
 */
technicalFindingsRouter.patch<{ id: string; findingId: string }>('/:findingId/review', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const finding = found.technicalFindings?.find((f) => f.id === req.params.findingId);
  if (!finding) {
    res.status(404).json({ error: 'Finding not found' });
    return;
  }
  const parsed = technicalFindingReviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (finding.reviewState !== 'proposed') {
    res.status(409).json({ error: `This finding is already ${finding.reviewState}, not awaiting review`, finding });
    return;
  }
  finding.reviewState = parsed.data.reviewState;
  finding.updatedAt = new Date().toISOString();
  found.updatedAt = finding.updatedAt;
  await store.save();
  res.json(finding);
});

technicalFindingsRouter.delete<{ id: string; findingId: string }>('/:findingId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const idx = found.technicalFindings?.findIndex((f) => f.id === req.params.findingId) ?? -1;
  if (idx === -1) {
    res.status(404).json({ error: 'Finding not found' });
    return;
  }
  found.technicalFindings!.splice(idx, 1);
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.status(204).end();
});

/** The discipline x phase document checklist, and this case's own provided-flags against it. */
export const technicalDocumentsRouter = Router({ mergeParams: true });

technicalDocumentsRouter.patch<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = technicalDocumentsProvidedBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (!technicalDocumentItem(parsed.data.itemId)) {
    res.status(400).json({ error: `${parsed.data.itemId} is not a checklist item` });
    return;
  }
  found.technicalDocumentsProvided = { ...(found.technicalDocumentsProvided ?? {}), [parsed.data.itemId]: parsed.data.provided };
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.json({ technicalDocumentsProvided: found.technicalDocumentsProvided });
});
