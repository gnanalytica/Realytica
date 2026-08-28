import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { CaseDocument, RecordFetchAttempt, RegisterSearch } from '@realytica/shared';
import { REFERENCE_DATA, buildBoundary, classifyDocument, extractFields, parseBoundary, runScreen } from '@realytica/shared';
import type { BoundarySource } from '@realytica/shared';
import { MANUAL_ROUTES, RECORD_DOCUMENT_KIND, recordProviderFor } from '@realytica/agents';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { boundaryBodySchema, fetchRecordBodySchema } from '../schemas';
import { ensureSiteContext } from '../site-context';
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
/**
 * Record what just happened, whatever it was.
 *
 * Called on BOTH branches. A failure that is not written down is a failure
 * the next reader repeats, and the local state the card kept instead did not
 * survive a reload.
 */
function noteAttempt(found: { recordFetchAttempts?: RecordFetchAttempt[] }, attempt: RecordFetchAttempt): void {
  const others = (found.recordFetchAttempts ?? []).filter((a) => a.kind !== attempt.kind);
  found.recordFetchAttempts = [...others, attempt];
}

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

  const attemptedAt = new Date().toISOString();

  if (!outcome.ok) {
    noteAttempt(found, {
      kind: parsed.data.kind,
      attemptedAt,
      by: provider.id,
      outcome: 'gap',
      // The provider's own reason, kept as it came. Every one of the five is
      // a different next step for the reader, and a "nil result" — the
      // register answered and holds nothing — is not among them: that is a
      // successful search and lands in `registerSearches`.
      reason: outcome.gap.reason,
      leavesUnknown: outcome.gap.leavesUnknown,
      manualRoute: outcome.gap.manualRoute,
      ...(outcome.gap.detail ? { detail: outcome.gap.detail } : {}),
    });
    found.updatedAt = attemptedAt;
    await store.save();
    res.json({ ok: false, gap: outcome.gap });
    return;
  }

  noteAttempt(found, { kind: parsed.data.kind, attemptedAt, by: provider.id, outcome: 'retrieved' });

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

/**
 * Supply the parcel outline.
 *
 * Two ways in, and both are somebody *supplying* it: a KML/GeoJSON export, or
 * a ring traced on a map. There is deliberately no third way where the
 * product derives one — `SiteContext` documents at length why a geocoded pin
 * is not a parcel, and a polygon this product drew for itself would carry the
 * authority of a survey and the accuracy of a guess.
 *
 * Re-screens on success, because the boundary changes real numbers: the
 * setback footprint stops being a square-plot assumption, and the extent it
 * measures is compared against the extent on record. That comparison is the
 * finding a boundary makes possible and nothing else on the case can produce.
 */
recordsRouter.put<{ id: string }>('/boundary', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const parsed = boundaryBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const now = new Date().toISOString();
  let ring;
  let source: BoundarySource;

  if ('fileText' in parsed.data) {
    const outcome = parseBoundary(parsed.data.fileText);
    if (!outcome.ok) {
      // 400 with the parser's own sentence, which is written for a person to
      // act on — "no Polygon in that GeoJSON" rather than a stack trace.
      res.status(400).json({ error: outcome.reason });
      return;
    }
    ring = outcome.ring;
    source = outcome.format === 'uploaded_kml' ? 'uploaded_kml' : 'uploaded_geojson';
  } else {
    ring = parsed.data.ring;
    source = parsed.data.source;
  }

  const boundary = buildBoundary(ring, source, now, parsed.data.note);
  if (!boundary) {
    res.status(400).json({ error: 'That outline encloses no area.' });
    return;
  }

  found.identity = { ...found.identity, boundary };
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
  found.updatedAt = now;
  await store.save();
  res.json(found);
});
