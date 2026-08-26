import {
  DOCUMENT_KIND_LABEL,
  KARNATAKA_PLAYBOOKS,
  runScreen,
} from '@realytica/shared';
import type {
  CaseDocument,
  DocumentKind,
  IntakeDocumentRequest,
  IntakeField,
  IntakeGap,
  IntakeReadout,
  IntakeStage,
  LocalityReference,
  ReferenceData,
  ScreenResult,
} from '@realytica/shared';
import { INTAKE_FIELDS, draftIdentity, valueOf } from './fields';

/**
 * Everything derived from a draft.
 *
 * Deliberately model-free. Which particular to ask for next, which documents
 * bear on this property and whether a screen can run are all answerable from
 * the field table, the playbooks and the engine — so they are answered there.
 * That has two consequences worth stating plainly:
 *
 *  - The intake still works with no credentials configured. It degrades to a
 *    guided step-by-step form with fixed phrasing, which is a worse experience
 *    and a correct one, rather than to an error.
 *  - A model cannot ask for a document that does not exist, skip one that the
 *    procedure requires, or declare a draft ready when the engine would refuse
 *    it. Those are not things it is trusted with.
 */

/** Locality resolution against the real reference list, never against a model's memory. */
export function resolveLocality(
  name: string,
  refData: ReferenceData,
): { match?: LocalityReference; near: LocalityReference[] } {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return { near: [] };
  const inKarnataka = refData.localities.filter(l => l.country === 'IN');
  const match = inKarnataka.find(l => l.locality.toLowerCase() === wanted);
  if (match) return { match, near: [] };
  const near = inKarnataka.filter(
    l => l.locality.toLowerCase().includes(wanted) || wanted.includes(l.locality.toLowerCase()),
  );
  return { near: near.slice(0, 5) };
}

/**
 * Documents that bear on this property, and what each settles.
 *
 * Assembled from the playbook steps whose `needs` name the kind — so the
 * request traces back to a procedure a Bengaluru title lawyer actually
 * follows, and `settles` is that step's own question rather than a sentence a
 * model wrote. `other` is dropped: several steps use it as a catch-all for
 * "some further instrument", which is not something you can ask a person for.
 */
export function documentRequests(
  fields: IntakeField[],
  received: CaseDocument[],
  preview: ScreenResult | undefined,
): IntakeDocumentRequest[] {
  const settledBy = new Map<DocumentKind, { settles: string; neededBy: string[] }>();
  for (const playbook of KARNATAKA_PLAYBOOKS) {
    for (const step of playbook.steps) {
      for (const kind of step.needs) {
        if (kind === 'other') continue;
        const entry = settledBy.get(kind);
        if (entry) entry.neededBy.push(step.key);
        else settledBy.set(kind, { settles: step.question, neededBy: [step.key] });
      }
    }
  }

  // The engine's own completeness view decides `critical`, so the chat and the
  // Completeness tab cannot disagree about what is essential.
  const criticalLabels = new Set((preview?.completeness.missingCritical ?? []).map(s => s.toLowerCase()));
  const isCritical = (kind: DocumentKind): boolean => {
    const label = DOCUMENT_KIND_LABEL[kind].toLowerCase();
    for (const missing of criticalLabels) {
      if (missing.includes(label) || label.includes(missing.split('(')[0].trim())) return true;
    }
    return false;
  };

  const have = new Set(received.map(d => d.kind));
  const type = valueOf(fields, 'propertyType');
  // A flat has no conversion order of its own and no Form 9/11; asking for one
  // is how a tool teaches people to ignore what it asks for.
  const irrelevant = new Set<DocumentKind>(
    type === 'residential_apartment' || type === 'commercial_office' || type === 'retail_unit'
      ? ['conversion_certificate', 'form_9_11']
      : [],
  );

  return [...settledBy.entries()]
    .filter(([kind]) => !irrelevant.has(kind))
    .map(([kind, { settles, neededBy }]) => ({
      kind,
      label: DOCUMENT_KIND_LABEL[kind],
      settles,
      neededBy,
      critical: isCritical(kind),
      received: have.has(kind),
    }))
    .sort((a, b) => {
      if (a.received !== b.received) return a.received ? 1 : -1;
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      return b.neededBy.length - a.neededBy.length;
    });
}

/**
 * Particulars still wanted, blocking ones first, then by how much they buy.
 *
 * Named for particulars rather than the shorter `gapsFor`, which the provider
 * layer already uses for capability gaps. Two different kinds of gap in one
 * namespace is a name worth spending four extra characters on.
 */
export function particularGaps(fields: IntakeField[]): IntakeGap[] {
  const known = new Set(
    fields.filter(f => f.value !== null && f.value !== '' && f.value !== 'unknown').map(f => f.path),
  );
  const type = valueOf(fields, 'propertyType');
  const isLand = type === 'residential_plot' || type === 'land_parcel';

  return INTAKE_FIELDS.filter(spec => {
    if (known.has(spec.path)) return false;
    // Built-up area is meaningless for a bare site, and plot area is the thing
    // that matters; for a flat it is the other way round. Asking for both
    // every time is the form's habit, not a conversation's.
    if (isLand && spec.path === 'builtUpAreaSqm') return false;
    if (!isLand && spec.path === 'plotAreaSqm') return false;
    if (isLand && spec.path === 'yearBuilt') return false;
    return true;
  }).map(spec => ({
    path: spec.path,
    label: spec.label,
    consequence: spec.consequence,
    // For a site the blocking area field is the plot, not the built-up.
    blocking: spec.blocking === true || (isLand && spec.path === 'plotAreaSqm'),
    options: spec.options,
  }));
}

/**
 * Can the engine screen this draft?
 *
 * Answered by asking the engine, not by counting fields. The floor was
 * measured: locality, property type and an area produce an indicative range,
 * risks and the critical-document list. `runScreen` throws when it cannot find
 * a country pack, so this catches — a draft that cannot be screened is a
 * conversation that continues, never a crash.
 */
export function previewScreen(
  fields: IntakeField[],
  documents: CaseDocument[],
  refData: ReferenceData,
  now: string,
): ScreenResult | undefined {
  const identity = draftIdentity(fields);
  const hasArea = identity.builtUpAreaSqm > 0 || identity.plotAreaSqm > 0;
  if (!identity.locality || !hasArea) return undefined;
  // A locality the reference data does not carry has no comparables, so the
  // range would be zeros presented as an answer. Better to keep asking.
  if (!resolveLocality(identity.locality, refData).match) return undefined;
  try {
    return runScreen({
      caseId: 'intake-preview',
      reference: 'PREVIEW',
      identity,
      documents,
      refData,
      now,
    });
  } catch {
    return undefined;
  }
}

/**
 * Which stage the conversation is in.
 *
 * `orienting` means nothing has been captured yet — stated as "no fields"
 * rather than derived from a gap count, which was the first version and was
 * wrong: `particularGaps` already drops the area field that does not apply to the
 * property type, so an untouched draft never had as many gaps as the table has
 * rows and the branch could not fire.
 */
function stageFor(
  captured: number,
  screenable: boolean,
  docs: IntakeDocumentRequest[],
  built: boolean,
): IntakeStage {
  if (built) return 'built';
  if (captured === 0) return 'orienting';
  if (!screenable) return 'particulars';
  return docs.some(d => d.critical && !d.received) ? 'documents' : 'ready';
}

export function readDraft(
  session: { fields: IntakeField[]; documents: CaseDocument[]; caseId?: string },
  refData: ReferenceData,
  now: string,
): IntakeReadout {
  const preview = previewScreen(session.fields, session.documents, refData, now);
  const gaps = particularGaps(session.fields);
  const documents = documentRequests(session.fields, session.documents, preview);
  const screenable = preview !== undefined;
  return {
    stage: stageFor(session.fields.length, screenable, documents, session.caseId !== undefined),
    gaps,
    documents,
    screenable,
    preview,
    // Blocking gaps first; the list is already in ask-order, so the head of it
    // is the next thing a person should be asked.
    nextQuestion: gaps.find(g => g.blocking) ?? gaps[0],
  };
}
