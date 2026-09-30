/**
 * Retire what the illustrative reference tables wrote onto stored projects.
 *
 * Until 2026-09-30 the project screen and the indicative valuation read a
 * locality table and a comparable pool that were written to exercise the
 * engine, not taken from any market. Projects screened or valued before then
 * still carry the results: a value range, anchors and comparables on the
 * stored screen, valuation runs priced on locality medians, findings such as
 * "asking price above the indicative mid", and locality packs filed as
 * evidence. New code no longer produces any of it; this removes what old code
 * left behind.
 *
 * Idempotent and recorded. A project is cleaned once, the audit trail says
 * what was removed, and nothing a person wrote is deleted: findings, risks,
 * actions and decisions the screen raised from those tables are closed or
 * withdrawn with the reason, not erased. Valuation runs that relied on the
 * tables are removed unless they were issued, because a computed figure that
 * nobody signed is output, not record, and leaving it would keep showing it.
 */

import { MARKET_ACTIONS, MARKET_RISK_CODES, withoutMarketData } from './project-screen';
import type { DdProject, ValuationRun } from './types';

export const REFERENCE_DATA_CLEANUP = 'reference-data-removed-2026-09';

const REASON = 'Raised from illustrative reference data, not from this site.';

/** The two engagements the old boot seed created, by reference and name. */
const LEGACY_SAMPLES: Array<{ reference: string; name: string; scope: string; stage: 'documents' | 'analysis' | 'review' }> = [
  { reference: 'RYT-0001', name: 'Harohalli Greenfield Township', scope: 'Construction-stage technical DD and progress', stage: 'review' },
  { reference: 'RYT-0003', name: 'Koramangala 4th Block infill', scope: 'Land acquisition screening', stage: 'documents' },
];

/**
 * A labelled sample: flagged as one, or one of the two the old boot seed
 * created before samples were flagged.
 */
export function isSampleProject(project: DdProject): boolean {
  if (project.sample) return true;
  return LEGACY_SAMPLES.some((s) => s.reference === project.reference && s.name === project.name);
}

export interface CleanupReport {
  changed: boolean;
  notes: string[];
}

function usedReferenceTables(run: ValuationRun): boolean {
  if (run.localityId) return true;
  // Written straight from the old screen's value blend.
  if (/^Property screen of /.test(run.ibbi?.instruction ?? '')) return true;
  return (run.working?.runs ?? []).some((approach) => approach.inputs.some((input) => input.source.kind === 'locality'));
}

function actionFromMarket(screenCode: string | undefined): boolean {
  return Boolean(screenCode && MARKET_ACTIONS.some((key) => screenCode.endsWith(`-${key}`)));
}

export function cleanReferenceData(project: DdProject, at = new Date().toISOString(), actor = 'system'): CleanupReport {
  if (project.migrations?.includes(REFERENCE_DATA_CLEANUP)) return { changed: false, notes: [] };
  const notes: string[] = [];

  // The stored screen: everything built on the tables comes off it.
  const screen = project.lastScreenResult;
  if (screen && (screen.anchors.length > 0 || screen.comparables.length > 0 || screen.drivers.length > 0 || screen.indicativeValue.mid > 0)) {
    const clean = withoutMarketData(screen);
    project.lastScreenResult = clean;
    if (project.lastScreen) {
      project.lastScreen = {
        ...project.lastScreen,
        verdict: clean.recommendation.verdict,
        headline: clean.recommendation.headline,
        reasoning: clean.recommendation.reasoning,
        indicatedMid: undefined,
        indicatedLow: undefined,
        indicatedHigh: undefined,
        confidenceScore: clean.confidence.score,
        openCriticalRisks: clean.risks.filter((r) => r.status === 'open' && r.severity === 'critical').length,
      };
    }
    notes.push('the value range, comparables and market drivers on the last screen');
  }

  // Valuation runs priced on the tables, unless somebody issued one.
  const runs = project.valuationRuns ?? [];
  const kept = runs.filter((run) => run.status === 'issued' || !usedReferenceTables(run));
  if (kept.length < runs.length) {
    notes.push(`${runs.length - kept.length} valuation run${runs.length - kept.length === 1 ? '' : 's'} priced on locality medians`);
    project.valuationRuns = kept;
  }

  // Locality packs filed as evidence, and any still offered as a card.
  let packs = 0;
  for (const row of project.evidence ?? []) {
    if (row.source !== 'locality_pack' || row.status === 'rejected') continue;
    row.status = 'rejected';
    row.rejectionReason = `${REASON} The locality table was illustrative.`;
    row.used = false;
    row.considered = false;
    row.updatedAt = at;
    packs += 1;
  }
  for (const card of project.chatProposals ?? []) {
    if (card.status === 'proposed' && (card.payload as { source?: unknown })?.source === 'locality_pack') card.status = 'rejected';
  }
  if (packs) notes.push(`${packs} locality pack${packs === 1 ? '' : 's'} filed as evidence`);

  // What the screen raised from the tables: closed with the reason, not erased.
  let raised = 0;
  for (const f of project.findings ?? []) {
    if (!f.screenCode || !MARKET_RISK_CODES.has(f.screenCode) || f.status === 'rejected' || f.status === 'closed') continue;
    f.status = 'rejected';
    f.confidenceNote = REASON;
    f.updatedAt = at;
    raised += 1;
  }
  for (const r of project.risks ?? []) {
    if (!r.screenCode || !MARKET_RISK_CODES.has(r.screenCode) || r.status === 'closed') continue;
    r.status = 'closed';
    r.residualNote = REASON;
    r.updatedAt = at;
    raised += 1;
  }
  for (const a of project.actions ?? []) {
    if (!actionFromMarket(a.screenCode) || a.status === 'closed') continue;
    a.status = 'closed';
    a.updatedAt = at;
    raised += 1;
  }
  // The old screen's verdict weighed a value range from the tables.
  for (const d of project.decisions ?? []) {
    if (!d.screenCode?.startsWith('verdict:') || (d.status !== 'proposed' && d.status !== 'pending')) continue;
    d.status = 'rejected';
    d.rationale = `${d.rationale}\n\nWithdrawn: this verdict weighed a value range built from illustrative reference data. Run the screen again for one from the documents.`;
    d.updatedAt = at;
    raised += 1;
  }
  if (raised) notes.push(`${raised} finding${raised === 1 ? '' : 's'}, risk${raised === 1 ? '' : 's'}, action${raised === 1 ? '' : 's'} or decision${raised === 1 ? '' : 's'} raised from those tables`);

  // The two engagements the old boot seed created are samples; say so.
  const legacy = LEGACY_SAMPLES.find((s) => s.reference === project.reference && s.name === project.name);
  if (legacy && !project.sample) {
    project.sample = true;
    project.engagement ??= { stage: legacy.stage, client: 'Sample client', scope: legacy.scope };
    notes.push('marked as a labelled sample');
  }

  project.migrations = [...(project.migrations ?? []), REFERENCE_DATA_CLEANUP];
  if (notes.length === 0) return { changed: false, notes };

  project.audit.push({
    id: `aud_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at,
    actor,
    action: 'cleanup',
    entityType: 'project',
    entityId: project.id,
    reason: REFERENCE_DATA_CLEANUP,
    newValue: `Removed ${notes.join('; ')}.`,
  });
  // The store writes only projects whose `updatedAt` moved.
  project.updatedAt = at;
  return { changed: true, notes };
}
