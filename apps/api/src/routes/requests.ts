import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { CaseRequest } from '@realytica/shared';
import { store } from '../store';
import { createRequestSchema, updateRequestSchema } from '../schemas';
import { findCase } from './cases';

/**
 * Requests (RFIs) — their own router, for the same reason findings and risks
 * have theirs: a request is a case-scoped collection with a lifecycle of its
 * own, and folding it into the case PATCH would make every status change a
 * whole-case write.
 *
 * The route mints ids and stamps the clock; the shared package stays pure.
 */
export const requestsRouter = Router({ mergeParams: true });

requestsRouter.post<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const created: CaseRequest[] = parsed.data.items.map((item) => ({
    id: randomUUID(),
    caseId: found.id,
    domain: item.domain,
    what: item.what,
    why: item.why,
    recipient: item.recipient,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...(item.dueAt ? { dueAt: item.dueAt } : {}),
    ...(item.originGapId ? { originGapId: item.originGapId } : {}),
  }));
  found.requests = [...(found.requests ?? []), ...created];
  found.updatedAt = now;
  await store.save();
  res.status(201).json(created);
});

requestsRouter.patch<{ id: string; requestId: string }>('/:requestId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const request = found.requests?.find((r) => r.id === req.params.requestId);
  if (!request) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }
  const parsed = updateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  // A document named as the answer has to be a document on this case — the
  // same integrity every other id-accepting route enforces.
  if (parsed.data.answeredWithDocumentId && !found.documents.some((d) => d.id === parsed.data.answeredWithDocumentId)) {
    res.status(400).json({ error: `Document ${parsed.data.answeredWithDocumentId} is not on this case` });
    return;
  }

  const now = new Date().toISOString();
  if (parsed.data.status) {
    request.status = parsed.data.status;
    // The two transitions that carry a date stamp it here rather than trusting
    // a client clock, so "sent 9 days ago" is measured against the server.
    if (parsed.data.status === 'sent' && !request.sentAt) request.sentAt = now;
    if (parsed.data.status === 'answered') request.answeredAt = now;
  }
  if (parsed.data.dueAt !== undefined) {
    if (parsed.data.dueAt === null) delete request.dueAt;
    else request.dueAt = parsed.data.dueAt;
  }
  if (parsed.data.recipient) request.recipient = parsed.data.recipient;
  if (parsed.data.answeredWithDocumentId !== undefined) {
    if (parsed.data.answeredWithDocumentId === null) delete request.answeredWithDocumentId;
    else request.answeredWithDocumentId = parsed.data.answeredWithDocumentId;
  }
  request.updatedAt = now;
  found.updatedAt = now;
  await store.save();
  res.json(request);
});

requestsRouter.delete<{ id: string; requestId: string }>('/:requestId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const before = found.requests?.length ?? 0;
  found.requests = (found.requests ?? []).filter((r) => r.id !== req.params.requestId);
  if ((found.requests?.length ?? 0) === before) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.status(204).end();
});
