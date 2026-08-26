/**
 * Case fixtures the tests build on.
 *
 * Built from the shipped seed data rather than from hand-written literals,
 * for one reason learned the hard way: a hand-rolled `ScreenResult` in an
 * earlier round of this work was missing a required field, and the test that
 * used it was asserting against a shape the engine never produces. Fixtures
 * that go through the real constructors cannot drift from the real contract.
 */

import {
  REFERENCE_DATA,
  SEED_CASES,
  SEED_DOCUMENT_FILENAMES,
  classifyDocument,
  extractFields,
  runScreen,
} from '@realytica/shared';
import type { CaseDocument, ProjectBrief, PropertyCase, PropertyIdentity, ScreenResult, SiteContext } from '@realytica/shared';

/**
 * A fixed instant, so nothing in the suite depends on the day it runs.
 *
 * The engine takes `now` as a parameter precisely so this is possible; a test
 * that used the wall clock would pass today and fail whenever a threshold in
 * `staleness.ts` was crossed.
 */
export const NOW = '2026-08-26T00:00:00.000Z';

export function seedFor(match: string): (typeof SEED_CASES)[number] {
  const seed = SEED_CASES.find(s => s.identity.label.includes(match));
  if (!seed) throw new Error(`No seed case matching "${match}"`);
  return seed;
}

export function documentsFor(identity: PropertyIdentity, label: string, caseId = 'test-case', uploadedAt = NOW): CaseDocument[] {
  const names = SEED_DOCUMENT_FILENAMES[label] ?? [];
  return names.map((fileName, i) => {
    const doc: CaseDocument = {
      id: `doc-${i}`,
      caseId,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedAt,
      kind: classifyDocument(fileName, 'application/pdf').kind,
      classificationConfidence: 0.9,
      kindConfirmedByUser: true,
      pages: 2,
      ocrStatus: 'complete',
      extracted: [],
    };
    doc.extracted = extractFields(doc, identity, caseId);
    return doc;
  });
}

export interface ScreenFixtureOptions {
  /** Merged over the seed's Karnataka attributes. */
  karnataka?: Partial<NonNullable<PropertyIdentity['karnataka']>>;
  /** Merged over the seed identity itself. */
  identity?: Partial<PropertyIdentity>;
  siteContext?: SiteContext;
  documents?: CaseDocument[];
  now?: string;
  /** Pass a stated brief; omitted, the engine infers one as it does in production. */
  project?: ProjectBrief;
}

export function screenSeed(match: string, options: ScreenFixtureOptions = {}): { result: ScreenResult; identity: PropertyIdentity; documents: CaseDocument[] } {
  const seed = seedFor(match);
  const identity: PropertyIdentity = {
    ...seed.identity,
    ...options.identity,
    ...(seed.identity.karnataka ? { karnataka: { ...seed.identity.karnataka, ...options.karnataka } } : {}),
  };
  const documents = options.documents ?? documentsFor(identity, seed.identity.label);
  const result = runScreen({
    caseId: 'test-case',
    reference: 'TEST-0001',
    identity,
    documents,
    refData: REFERENCE_DATA,
    now: options.now ?? NOW,
    siteContext: options.siteContext,
    project: options.project,
  });
  return { result, identity, documents };
}

export function caseFrom(identity: PropertyIdentity, documents: CaseDocument[], result?: ScreenResult, extra: Partial<PropertyCase> = {}): PropertyCase {
  return {
    id: 'test-case',
    reference: 'TEST-0001',
    identity,
    status: result ? 'screened' : 'collecting',
    persona: 'property_investor',
    ownerName: 'Test Owner',
    createdAt: NOW,
    updatedAt: NOW,
    documents,
    result,
    notes: '',
    ...extra,
  };
}

/** A site context with a precise pin, for the paths gated on geocode precision. */
export function preciseSiteContext(overrides: Partial<SiteContext> = {}): SiteContext {
  return {
    caseId: 'test-case',
    location: {
      point: { lat: 13.2437, lng: 77.7126 },
      precision: 'rooftop',
      queried: 'queried address',
      resolvedAddress: 'Site 118, NPKL, Devanahalli, Bengaluru 562110, India',
      provider: 'google',
      resolvedAt: NOW,
      caveat: 'Located from the address on file.',
    },
    amenities: [],
    streetView: null,
    gaps: [],
    provider: 'google',
    builtAt: NOW,
    ...overrides,
  };
}
