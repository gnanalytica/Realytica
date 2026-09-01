/**
 * What the file says under the standards' own headings.
 *
 * Three readings that a technical DD report is read for, and one property they
 * share: none of them is stored. The cost table is summed from the actions,
 * the traffic light is derived from severity, and the escalation list is a
 * filter. A stored copy of any of the three is a second version of a fact the
 * registers already hold, and the copy is always the one a client ends up
 * reading after it has drifted.
 *
 * They live in their own module rather than in `operations.ts` because both
 * the operations and the report resolver need them, and the report resolver
 * cannot import the operations without a cycle.
 */

import { REMEDIAL_BANDS, REMEDIAL_BAND_LABEL, RICS_RATING_LABEL, ricsConditionRating, type RemedialBand, type RicsConditionRating } from './standards';
import type { DdProject, FindingRecord } from './types';

/* ==================================================================== */
/* What the remedies cost, and when                                      */
/* ==================================================================== */

export interface RemedialBandRow {
  band: RemedialBand;
  label: string;
  count: number;
  /** How many of those carry a figure. The rest are in the count and not the total. */
  costed: number;
  total: number;
  actionIds: string[];
}

/**
 * The table a technical DD report is actually read for.
 *
 * `uncosted` and `unbanded` are returned beside the total on purpose. A cost
 * summary that quietly omits the actions nobody has priced yet reads as a
 * complete answer to "what will this cost me", and it is the one number in a
 * report a buyer will act on without checking. So the shortfall travels with
 * the figure and every renderer has to decide what to do about it.
 */
export interface RemedialCostSummary {
  currency: string;
  rows: RemedialBandRow[];
  total: number;
  /** Actions carrying no band — the table cannot speak for these at all. */
  unbanded: number;
  /** Banded, but with no figure. The total is only as good as this is small. */
  uncosted: number;
}

export function remedialCostSummary(project: DdProject, opts: { openOnly?: boolean } = {}): RemedialCostSummary {
  const open = opts.openOnly !== false;
  const actions = project.actions.filter((a) => (open ? a.status !== 'closed' : true));
  const rows: RemedialBandRow[] = REMEDIAL_BANDS.map((band) => {
    const inBand = actions.filter((a) => a.costBand === band);
    const costed = inBand.filter((a) => typeof a.costEstimate === 'number');
    return {
      band,
      label: REMEDIAL_BAND_LABEL[band],
      count: inBand.length,
      costed: costed.length,
      total: costed.reduce((sum, a) => sum + (a.costEstimate ?? 0), 0),
      actionIds: inBand.map((a) => a.id),
    };
  });
  return {
    currency: project.currency,
    rows,
    total: rows.reduce((sum, r) => sum + r.total, 0),
    unbanded: actions.filter((a) => !a.costBand).length,
    uncosted: actions.filter((a) => a.costBand && typeof a.costEstimate !== 'number').length,
  };
}

/* ==================================================================== */
/* The traffic light, derived                                            */
/* ==================================================================== */

export interface ConditionRatingRow {
  rating: RicsConditionRating;
  label: string;
  count: number;
  findingIds: string[];
}

/**
 * Findings under the three-way grading a TDD reader expects.
 *
 * Computed from severity every time it is asked for, never stored. A second
 * recorded grading of the same defect is a second thing to keep in step, and
 * the one a client reads is exactly the one you cannot afford to have drifted.
 */
export function conditionRatings(project: DdProject, opts: { openOnly?: boolean } = {}): ConditionRatingRow[] {
  const open = opts.openOnly !== false;
  const findings = project.findings.filter((f) => (open ? f.status !== 'closed' : true));
  return ([3, 2, 1] as RicsConditionRating[]).map((rating) => {
    const hit = findings.filter((f) => ricsConditionRating(f.severity) === rating);
    return { rating, label: RICS_RATING_LABEL[rating], count: hit.length, findingIds: hit.map((f) => f.id) };
  });
}

/** Findings somebody had to be told about before the report was written. */
export function escalatedFindings(project: DdProject): FindingRecord[] {
  return project.findings.filter((f) => f.escalation?.immediateAction);
}
