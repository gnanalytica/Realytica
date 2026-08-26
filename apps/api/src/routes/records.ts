import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { CaseDocument, RegisterSearch } from '@realytica/shared';
import { classifyDocument, extractFields } from '@realytica/shared';
import { MANUAL_ROUTES, RECORD_DOCUMENT_KIND, recordProviderFor } from '@realytica/agents';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { fetchRecordBodySchema } from '../schemas';
import { findCase } from './cases';

export const recordsRouter = Router({ mergeParams: true });

/**
 * What this deployment can fetch, and what it cannot.
 *
 * Answered even when nothing is configured, because the answer is the same
 * shape either way: which record kinds are reachable by a vendor, and for the
 * rest, what each one would have settled and how to get it by hand. A UI that
 * only rendered the configured case would show an empty panel on the
 * deployment where the manual route is the *only* route.
 */
recordsRouter.get('/', (_req, res) => {
  const provider = recordProviderFor();
  res.json({
    provider: {
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      standing: provider.standing,
      capabilities: provider.capabilities,
    },
    manualRoutes: MANUAL_ROUTES,
  });
});

/**
 * Fetch one statutory record from the configured vendor.
 *
 * Two outcomes are recorded and they are not the same. A document arrives and
 * joins the case like any upload. A *nil result* arrives with no document at
 * all — and that is a finding, not a failure: "the register holds nothing
 * against this parcel as at this date" is often the most valuable answer an
 * encumbrance search returns. Either way a `RegisterSearch` is logged, which
 * is what gives the staleness watch something to watch: a register search
 * ages because somebody may register a charge the morning after it ran.
 *
 * A gap is returned as 200 with `ok: false`, not as an error status. It is a
 * real answer about the case — what is now unknown, and how to get it — and
 * making the client treat it as a transport failure would lose that.
 */
recordsRouter.post<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = fetchRecordBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const provider = recordProviderFor();
  const outcome = await provider.fetch({
    kind: parsed.data.kind,
    identifiers: {
      parcelId: found.identity.parcelId || undefined,
      khataOrPid: found.identity.karnataka?.khataType === 'none' ? undefined : found.identity.parcelId || undefined,
      state: found.identity.state,
      locality: found.identity.locality,
    },
    period: parsed.data.period,
  });

  if (!outcome.ok) {
    res.json({ ok: false, gap: outcome.gap });
    return;
  }

  const record = outcome.record;
  const now = new Date().toISOString();
  const route = MANUAL_ROUTES[record.kind];

  const search: RegisterSearch = {
    kind: record.kind,
    label: route.label,
    by: record.providerId,
    authority: record.authority,
    retrievedAt: record.retrievedAt,
    nilResult: record.nilResult,
    period: parsed.data.period,
    refresh: `Re-run the search through ${provider.label}, or ${route.manualRoute}`,
  };
  found.registerSearches = [
    // One entry per record kind: a fresher search supersedes an older one
    // rather than accumulating beside it, because the question the staleness
    // watch asks is "how old is the most recent search", not "how many".
    ...(found.registerSearches ?? []).filter(s => s.kind !== record.kind),
    search,
  ];

  let created: CaseDocument | undefined;
  if (record.content) {
    const docId = randomUUID();
    const classification = classifyDocument(record.content.fileName, record.content.contentType);
    const doc: CaseDocument = {
      id: docId,
      caseId: found.id,
      fileName: record.content.fileName,
      mimeType: record.content.contentType,
      sizeBytes: record.content.bytes.byteLength,
      uploadedAt: now,
      // The record kind the vendor was asked for beats the filename
      // classifier: we asked for an encumbrance certificate and got one, which
      // is a stronger signal than whatever the vendor named the file.
      kind: RECORD_DOCUMENT_KIND[record.kind],
      classificationConfidence: Math.max(classification.confidence, 0.9),
      kindConfirmedByUser: false,
      pages: 1,
      ocrStatus: 'complete',
      extracted: [],
    };
    doc.extracted = extractFields(doc, found.identity, found.id);
    await storageAdapter.putDocument(found.id, documentKey(doc), Buffer.from(record.content.bytes), record.content.contentType);
    found.documents.push(doc);
    created = doc;
    if (found.status === 'draft') found.status = 'collecting';
  }

  found.updatedAt = now;
  await store.save();
  res.json({ ok: true, record: { ...record, content: undefined }, document: created, case: found });
});
