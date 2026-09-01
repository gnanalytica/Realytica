/**
 * What each check records, and what the numbers mean once it has.
 *
 * A table rather than prose, deliberately: `libraries.ts` is the catalogue of
 * WHAT to check and reads as one; this is the catalogue of what each check
 * writes down, and reads as one too. Keeping them apart is what stops either
 * file becoming unreadable as it grows.
 *
 * Not every check gets fields, and that is the design rather than a gap. A
 * check whose acceptance criteria are a judgement ("constructability is
 * reasonable for the site") records a result and a comment, because there is
 * no number in it and inventing two would be worse than nothing. A check whose
 * criteria are literally a comparison — extents, dates, budgets, areas — gets
 * the two numbers, because that comparison is the check.
 *
 * The rule for adding one: if a competent reviewer would write a figure in the
 * comment box, it should be a field. If they would write a sentence, leave it
 * a sentence.
 */

import type { CheckFieldDef, CheckInsightRule } from './types';

/** Field declarations, keyed by the check definition id. */
export const CHECK_FIELDS: Record<string, CheckFieldDef[]> = {
  /* --- Land & site ------------------------------------------------- */
  'land_site.parcel_identification': [
    { key: 'survey_numbers', label: 'Survey numbers on the title', kind: 'text', from: 'Title extract', hint: 'As recited, e.g. Sy. No. 41/1, 41/2 & 42' },
    { key: 'extent_title', label: 'Extent per title', kind: 'area', unit: 'sqm', from: 'Title extract' },
    { key: 'extent_survey', label: 'Extent per survey sketch', kind: 'area', unit: 'sqm', from: 'Survey plan' },
    { key: 'extent_khata', label: 'Extent per khata', kind: 'area', unit: 'sqm', from: 'Khata extract', required: false },
  ],
  'land_site.boundary_match': [
    { key: 'measured_extent', label: 'Measured extent on the ground', kind: 'area', unit: 'sqm', from: 'Boundary survey' },
    { key: 'sanctioned_extent', label: 'Extent per sanctioned layout', kind: 'area', unit: 'sqm', from: 'Sanctioned layout' },
    { key: 'demarcated', label: 'Fenced and demarcated', kind: 'boolean', from: 'Site photographs' },
    { key: 'encroachment_note', label: 'Where the lines disagree', kind: 'text', required: false },
  ],
  'land_site.access': [
    { key: 'road_width_ft', label: 'Abutting road width', kind: 'number', unit: 'ft', from: 'Survey plan' },
    { key: 'access_type', label: 'Access', kind: 'enum', options: ['public road', 'private road', 'right of way', 'landlocked'], from: 'Title extract' },
    { key: 'row_registered', label: 'Right of way registered', kind: 'boolean', required: false },
  ],
  'land_site.flood_drainage': [
    { key: 'near_rajakaluve', label: 'Within a rajakaluve buffer', kind: 'boolean', from: 'Storm-water drain map' },
    { key: 'buffer_required_m', label: 'Buffer required', kind: 'number', unit: 'm', required: false },
    { key: 'buffer_available_m', label: 'Buffer available on the ground', kind: 'number', unit: 'm', required: false },
  ],

  /* --- Legal & title ----------------------------------------------- */
  'legal.title_chain': [
    { key: 'root_year', label: 'Root of title', kind: 'date', from: 'Mother deed', hint: 'Date of the earliest instrument on file' },
    { key: 'years_required', label: 'Years of chain required', kind: 'number', unit: 'years', hint: 'Usually 30 in Karnataka' },
    { key: 'instrument_count', label: 'Registered instruments on file', kind: 'number' },
    { key: 'unregistered_links', label: 'Links with no registered instrument', kind: 'number', required: false },
  ],
  'legal.encumbrances': [
    { key: 'ec_from', label: 'EC searched from', kind: 'date', from: 'Encumbrance certificate' },
    { key: 'ec_to', label: 'EC searched to', kind: 'date', from: 'Encumbrance certificate' },
    { key: 'ec_nil', label: 'Nil result', kind: 'boolean', from: 'Encumbrance certificate' },
    { key: 'subsisting_charges', label: 'Charges still subsisting', kind: 'number', required: false },
  ],
  'legal.litigation': [
    { key: 'searched_courts', label: 'Registries searched', kind: 'text', from: 'Court search report' },
    { key: 'matters_found', label: 'Matters naming the parcel or a party', kind: 'number' },
    { key: 'lis_pendens', label: 'Lis pendens registered', kind: 'boolean', required: false },
  ],

  /* --- Approvals ---------------------------------------------------- */
  'approvals.land_use': [
    { key: 'zoning', label: 'Zoning in the plan in force', kind: 'text', from: 'Zoning certificate' },
    { key: 'conversion_status', label: 'DC conversion', kind: 'enum', options: ['converted', 'agricultural', 'not applicable', 'unknown'], from: 'DC conversion order' },
    { key: 'conversion_date', label: 'Date of the conversion order', kind: 'date', from: 'DC conversion order', required: false },
  ],
  'approvals.sanction': [
    { key: 'sanctioned_far', label: 'FAR sanctioned', kind: 'number', from: 'Sanctioned plan' },
    { key: 'permissible_far', label: 'FAR permissible', kind: 'number', from: 'Zoning certificate' },
    { key: 'sanctioned_area', label: 'Built-up area sanctioned', kind: 'area', unit: 'sqm', from: 'Sanctioned plan' },
    { key: 'proposed_area', label: 'Built-up area proposed or built', kind: 'area', unit: 'sqm', from: 'Drawings' },
    { key: 'sanction_date', label: 'Date of sanction', kind: 'date', from: 'Sanctioned plan' },
    { key: 'sanction_valid_to', label: 'Sanction valid to', kind: 'date', required: false },
  ],
  'approvals.occupancy': [
    { key: 'oc_issued', label: 'Occupancy certificate issued', kind: 'boolean', from: 'Occupancy certificate' },
    { key: 'oc_date', label: 'Date of the OC', kind: 'date', required: false },
    { key: 'oc_partial', label: 'Partial OC only', kind: 'boolean', required: false },
  ],

  /* --- Financial ---------------------------------------------------- */
  'financial.budget_current': [
    { key: 'sanctioned_budget', label: 'Sanctioned budget', kind: 'money', unit: 'INR', from: 'Approved budget' },
    { key: 'current_forecast', label: 'Current forecast at completion', kind: 'money', unit: 'INR', from: 'Cost report' },
    { key: 'spent_to_date', label: 'Spent to date', kind: 'money', unit: 'INR', from: 'Cost report' },
  ],
  'financial.commitments': [
    { key: 'committed', label: 'Committed to date', kind: 'money', unit: 'INR', from: 'Contract register' },
    { key: 'certified', label: 'Certified to date', kind: 'money', unit: 'INR', from: 'Payment certificates' },
  ],

  /* --- Schedule ------------------------------------------------------ */
  'schedule.planned_vs_actual': [
    { key: 'planned_percent', label: 'Planned progress', kind: 'percent', from: 'Baseline programme' },
    { key: 'actual_percent', label: 'Actual progress', kind: 'percent', from: 'Progress report' },
  ],
  'schedule.forecast_completion': [
    { key: 'baseline_completion', label: 'Baseline completion', kind: 'date', from: 'Baseline programme' },
    { key: 'forecast_completion', label: 'Forecast completion', kind: 'date', from: 'Progress report' },
    { key: 'contractual_completion', label: 'Contractual completion', kind: 'date', from: 'Contract', required: false },
  ],
};

/**
 * What a divergence means, per check.
 *
 * Tolerances are the load-bearing numbers here and each one is a judgement
 * somebody should be able to argue with, which is why they are written down
 * rather than left at a default. A survey tolerance of 1% is ordinary; a
 * budget 5% adrift is a conversation, not an error.
 */
export const CHECK_INSIGHT_RULES: Record<string, CheckInsightRule[]> = {
  'land_site.parcel_identification': [
    {
      kind: 'compare',
      fields: ['extent_title', 'extent_survey'],
      tolerance: 0.01,
      severity: 'high',
      say: 'The title recites {a} and the survey sketch shows {b} — {divergence} apart, outside the {tolerance} survey tolerance. The remainder is unexplained until one of them is corrected.',
    },
    {
      kind: 'compare',
      fields: ['extent_title', 'extent_khata'],
      tolerance: 0.01,
      severity: 'medium',
      say: 'The title recites {a} and the khata records {b} — {divergence} apart. A khata that does not match the deed is refused at registration.',
    },
  ],
  'land_site.boundary_match': [
    {
      kind: 'compare',
      fields: ['measured_extent', 'sanctioned_extent'],
      tolerance: 0.02,
      severity: 'high',
      say: 'Measured {a} against a sanctioned {b} — {divergence} apart. Either the site is encroached or the layout was not built as approved.',
    },
  ],
  'land_site.flood_drainage': [
    {
      kind: 'compare',
      fields: ['buffer_required_m', 'buffer_available_m'],
      tolerance: 0,
      severity: 'critical',
      say: 'The buffer required is {a} and only {b} is available on the ground. A rajakaluve encroachment is a demolition risk, not a paperwork one.',
    },
  ],
  'legal.encumbrances': [
    { kind: 'before', fields: ['ec_from', 'ec_to'], severity: 'medium', say: 'The EC window runs from {a} to {b} — the start is after the end, so the search does not cover what it claims to.' },
  ],
  'approvals.sanction': [
    {
      kind: 'compare',
      fields: ['sanctioned_far', 'permissible_far'],
      tolerance: 0,
      severity: 'critical',
      say: 'Sanctioned FAR is {a} against a permissible {b}. An FAR above what the plan allows is a regularisation exposure on every unit built under it.',
    },
    {
      kind: 'compare',
      fields: ['sanctioned_area', 'proposed_area'],
      tolerance: 0.02,
      severity: 'high',
      say: '{a} is sanctioned and {b} is proposed or built — {divergence} apart. Deviation beyond the sanctioned envelope is what an OC is refused for.',
    },
    { kind: 'before', fields: ['sanction_date', 'sanction_valid_to'], severity: 'high', say: 'The sanction is dated {a} and shown as valid to {b}, which is earlier. One of the two is wrong.' },
  ],
  'financial.budget_current': [
    {
      kind: 'compare',
      fields: ['sanctioned_budget', 'current_forecast'],
      tolerance: 0.05,
      severity: 'high',
      say: 'The sanctioned budget is {a} and the forecast at completion is {b} — {divergence} apart, past the {tolerance} threshold this check treats as material.',
    },
  ],
  'financial.commitments': [
    {
      kind: 'compare',
      fields: ['committed', 'certified'],
      tolerance: 0.15,
      severity: 'medium',
      say: '{a} committed against {b} certified — {divergence} apart. A wide gap is either work done and unbilled or commitments running ahead of delivery.',
    },
  ],
  'schedule.planned_vs_actual': [
    {
      kind: 'compare',
      fields: ['planned_percent', 'actual_percent'],
      tolerance: 0.05,
      severity: 'medium',
      say: 'Planned {a} against actual {b} — {divergence} apart. Slippage at this scale moves the completion date, not just the curve.',
    },
  ],
  'schedule.forecast_completion': [
    { kind: 'before', fields: ['contractual_completion', 'forecast_completion'], severity: 'high', say: 'Contractual completion is {a} and the forecast is {b} — the forecast is later, so liquidated damages are already in play.' },
  ],
};
