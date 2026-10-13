/**
 * The rule rows Valuation, Feasibility and Budget read.
 *
 * None of these is a figure a statute sets. Three are a lender's to set, and
 * are kept by lender so that a lender's own policy is a new row, not a
 * change to a formula: what a sale in the ordinary course realises, what a
 * forced sale fetches, and how far a value may sit from the guidance value
 * before the report has to say why. The rest are the product's own
 * thresholds, which the research marks as guesses to be made a firm's
 * setting.
 *
 * Every row is unverified, and the screen says so beside each value worked
 * out from one. A lender's row is marked verified only by a person who has
 * read that lender's policy or panel terms, with their name.
 */

import type { RuleRow } from '../../types';

const SINCE = '2026-01-01';
const CONVENTION = 'Product convention; no lender’s policy read';
const DEFAULT = 'Product default, not a rule from any source';

/** The lender whose policy a row is. `general` is no lender's own: the figure used where the lender's is not on file. */
const GENERAL = { lender: 'general' };

export const VALUATION_FEASIBILITY_BUDGET_RULE_ROWS: RuleRow[] = [
  { key: 'valuation_realisable_share', label: 'Realisable value as a share of fair market value', jurisdiction: {}, when: GENERAL, value: 90, unit: '%', from: SINCE, source: { regulation: CONVENTION }, verified: false },
  { key: 'valuation_distress_share', label: 'Distress sale value as a share of fair market value', jurisdiction: {}, when: GENERAL, value: 75, unit: '%', from: SINCE, source: { regulation: CONVENTION }, verified: false },
  {
    key: 'valuation_guideline_variance_limit',
    label: 'How far a value may sit from the guidance value before the report says why',
    jurisdiction: {},
    when: GENERAL,
    value: 20,
    unit: '%',
    from: SINCE,
    source: { regulation: 'Seen in one bank’s report format; each lender sets its own' },
    verified: false,
  },
  { key: 'valuation_inspection_gap_days', label: 'Most days between the inspection and the valuation date', jurisdiction: {}, value: 30, unit: 'days', from: SINCE, source: { regulation: DEFAULT }, verified: false },
  { key: 'feasibility_rate_over_comparables', label: 'How far the selling rate may sit above the comparables', jurisdiction: {}, value: 15, unit: '%', from: SINCE, source: { regulation: DEFAULT }, verified: false },
  { key: 'feasibility_assumption_age_days', label: 'Age past which an appraisal’s assumptions are old', jurisdiction: {}, value: 180, unit: 'days', from: SINCE, source: { regulation: DEFAULT }, verified: false },
  { key: 'budget_contingency_floor', label: 'Least contingency as a share of the work left', jurisdiction: {}, value: 3, unit: '%', from: SINCE, source: { regulation: DEFAULT }, verified: false },
  { key: 'budget_forecast_age_days', label: 'Age past which a cost forecast is old', jurisdiction: {}, value: 45, unit: 'days', from: SINCE, source: { regulation: DEFAULT }, verified: false },
  { key: 'budget_progress_gap_points', label: 'Most points between cost progress and physical progress', jurisdiction: {}, value: 10, unit: 'points', from: SINCE, source: { regulation: DEFAULT }, verified: false },
];
