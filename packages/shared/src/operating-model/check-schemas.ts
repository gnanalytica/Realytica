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
import { areaBasisIsUndefined } from './standards';

/**
 * The bases the Indian market actually quotes in, and which of them mean
 * anything.
 *
 * The undefined list is DERIVED from `standards.ts` rather than typed out
 * again here. Two hand-maintained lists of the same fact drift, and the one
 * that drifts is always the one guarding the warning.
 */
const AREA_BASIS_OPTIONS = ['carpet', 'built-up', 'super built-up'];
const UNDEFINED_AREA_BASES = AREA_BASIS_OPTIONS.filter(areaBasisIsUndefined);

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
    // The chain is a table because that is what it is. Everybody keeps this
    // in a spreadsheet beside the system; keeping it here is the difference
    // between the chain being data and being an attachment.
    {
      key: 'chain',
      label: 'Chain of title',
      kind: 'table',
      from: 'Registered instruments',
      proof: 'expected',
      columns: [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'instrument', label: 'Instrument', kind: 'enum', options: ['sale deed', 'gift deed', 'partition', 'grant', 'release', 'JDA', 'will', 'decree'] },
        { key: 'from_party', label: 'From', kind: 'text' },
        { key: 'to_party', label: 'To', kind: 'text' },
        { key: 'extent', label: 'Extent', kind: 'area', unit: 'sqm', required: false },
        { key: 'registered', label: 'Registered', kind: 'boolean', control: 'checkbox' },
        { key: 'doc_no', label: 'Document no.', kind: 'text', required: false },
      ],
    },
    { key: 'root_year', label: 'Root of title', kind: 'date', from: 'Mother deed', hint: 'Date of the earliest instrument on file' },
    { key: 'years_required', label: 'Years of chain required', kind: 'duration', unit: 'years', hint: 'Usually 30 in Karnataka' },
    { key: 'instrument_count', label: 'Instruments on file', kind: 'computed', formula: { op: 'count', table: 'chain' } },
    { key: 'years_established', label: 'Years established', kind: 'computed', unit: 'years', formula: { op: 'divide', left: { op: 'days_between', left: 'as_at', right: 'root_year' }, right: { op: 'const', value: 365.25 } } },
    { key: 'as_at', label: 'Chain established as at', kind: 'date', hint: 'Usually today, or the valuation date' },
    { key: 'unregistered_links', label: 'Links with no registered instrument', kind: 'number', required: false },
  ],
  'legal.encumbrances': [
    { key: 'ec_from', label: 'EC searched from', kind: 'date', from: 'Encumbrance certificate' },
    { key: 'ec_to', label: 'EC searched to', kind: 'date', from: 'Encumbrance certificate' },
    { key: 'ec_nil', label: 'Nil result', kind: 'boolean', from: 'Encumbrance certificate' },
    { key: 'subsisting_charges', label: 'Charges still subsisting', kind: 'number', required: false },
  ],
  'legal.litigation': [
    {
      key: 'searched_courts',
      label: 'Registries searched',
      kind: 'multi_enum',
      options: ['District court', 'High Court', 'NCLT', 'DRT', 'Consumer forum', 'Revenue tribunal', 'Lok Adalat'],
      from: 'Court search report',
      proof: 'expected',
    },
    { key: 'matters_found', label: 'Matters naming the parcel or a party', kind: 'number' },
    { key: 'lis_pendens', label: 'Lis pendens registered', kind: 'boolean', required: false },
  ],

  /* --- Approvals ---------------------------------------------------- */
  'regulatory.land_use': [
    { key: 'zoning', label: 'Zoning in the plan in force', kind: 'text', from: 'Zoning certificate' },
    { key: 'conversion_status', label: 'DC conversion', kind: 'enum', options: ['converted', 'agricultural', 'not applicable', 'unknown'], from: 'DC conversion order' },
    { key: 'conversion_date', label: 'Date of the conversion order', kind: 'date', from: 'DC conversion order', required: false },
  ],
  'regulatory.sanction': [
    { key: 'sanctioned_far', label: 'FAR sanctioned', kind: 'number', from: 'Sanctioned plan' },
    { key: 'permissible_far', label: 'FAR permissible', kind: 'number', from: 'Zoning certificate' },
    { key: 'sanctioned_area', label: 'Built-up area sanctioned', kind: 'area', unit: 'sqm', from: 'Sanctioned plan' },
    { key: 'proposed_area', label: 'Built-up area proposed or built', kind: 'area', unit: 'sqm', from: 'Drawings' },
    { key: 'sanction_date', label: 'Date of sanction', kind: 'date', from: 'Sanctioned plan' },
    { key: 'sanction_valid_to', label: 'Sanction valid to', kind: 'date', required: false },
  ],
  'regulatory.occupancy': [
    { key: 'oc_issued', label: 'Occupancy certificate issued', kind: 'boolean', from: 'Occupancy certificate' },
    { key: 'oc_date', label: 'Date of the OC', kind: 'date', required: false },
    { key: 'oc_partial', label: 'Partial OC only', kind: 'boolean', required: false },
  ],

  /* --- Financial ---------------------------------------------------- */
  'cost_quantity.budget_current': [
    { key: 'sanctioned_budget', label: 'Sanctioned budget', kind: 'money', unit: 'INR', from: 'Approved budget' },
    { key: 'current_forecast', label: 'Current forecast at completion', kind: 'money', unit: 'INR', from: 'Cost report' },
    { key: 'spent_to_date', label: 'Spent to date', kind: 'money', unit: 'INR', from: 'Cost report' },
  ],
  'cost_quantity.commitments': [
    { key: 'committed', label: 'Committed to date', kind: 'money', unit: 'INR', from: 'Contract register' },
    { key: 'certified', label: 'Certified to date', kind: 'money', unit: 'INR', from: 'Payment certificates' },
  ],

  /* --- Schedule ------------------------------------------------------ */
  'schedule_progress.planned_vs_actual': [
    { key: 'planned_percent', label: 'Planned progress', kind: 'percent', from: 'Baseline programme' },
    { key: 'actual_percent', label: 'Actual progress', kind: 'percent', from: 'Progress report' },
  ],
  'schedule_progress.forecast_completion': [
    { key: 'baseline_completion', label: 'Baseline completion', kind: 'date', from: 'Baseline programme' },
    { key: 'forecast_completion', label: 'Forecast completion', kind: 'date', from: 'Progress report' },
    { key: 'contractual_completion', label: 'Contractual completion', kind: 'date', from: 'Contract', required: false },
  ],

  /* --- Regulatory: the rest ---------------------------------------- */
  'regulatory.conditions': [
    {
      key: 'conditions',
      label: 'Approval conditions',
      kind: 'table',
      from: 'Sanction letter',
      proof: 'expected',
      columns: [
        { key: 'ref', label: 'Condition', kind: 'text' },
        { key: 'what', label: 'What it requires', kind: 'text' },
        { key: 'due', label: 'Due by', kind: 'date', required: false },
        { key: 'status', label: 'Status', kind: 'enum', options: ['met', 'outstanding', 'waived', 'disputed'] },
      ],
    },
    { key: 'total_conditions', label: 'Conditions in total', kind: 'computed', formula: { op: 'count', table: 'conditions' } },
  ],
  'regulatory.nocs': [
    {
      key: 'nocs',
      label: 'Statutory NOCs',
      kind: 'multi_enum',
      options: ['Fire', 'Airport height', 'Pollution control', 'Lake / SWD', 'Forest', 'Ancient monuments', 'Defence', 'Railways', 'Highways'],
      from: 'NOC file',
    },
    { key: 'fire_noc_valid_to', label: 'Fire NOC valid to', kind: 'date', from: 'Fire NOC', required: false, proof: 'required' },
    { key: 'all_in_hand', label: 'All NOCs required at this stage are in hand', kind: 'boolean', control: 'switch' },
  ],

  /* --- Technical ---------------------------------------------------- */
  'technical.drawing_register': [
    { key: 'revision', label: 'Current drawing revision', kind: 'text', from: 'Drawing register', proof: 'required' },
    { key: 'issued_on', label: 'Issued on', kind: 'date', from: 'Drawing register' },
    { key: 'coordinated', label: 'Disciplines coordinated', kind: 'boolean', control: 'switch' },
    { key: 'register', label: 'Drawing register', kind: 'evidence', accepts: 'document', required: false },
  ],
  'technical.structural': [
    { key: 'design_stage', label: 'Design stage reached', kind: 'enum', control: 'segmented', options: ['concept', 'scheme', 'detailed', 'GFC'], from: 'Structural drawings' },
    { key: 'seismic_zone', label: 'Seismic zone', kind: 'enum', options: ['II', 'III', 'IV', 'V'], from: 'Structural report' },
    { key: 'proof_checked', label: 'Proof-checked by a third party', kind: 'boolean' },
    { key: 'peer_review', label: 'Peer review report', kind: 'evidence', accepts: 'document', required: false },
  ],
  'technical.mep_capacity': [
    { key: 'connected_load_kw', label: 'Connected load', kind: 'number', unit: 'kW', from: 'Load schedule' },
    { key: 'sanctioned_load_kw', label: 'Sanctioned load', kind: 'number', unit: 'kW', from: 'Sanction letter', proof: 'required' },
    { key: 'load_headroom_pct', label: 'Headroom', kind: 'computed', unit: '%', formula: { op: 'variance_pct', left: { op: 'field', key: 'sanctioned_load_kw' }, right: { op: 'field', key: 'connected_load_kw' } } },
    { key: 'water_demand_kld', label: 'Water demand', kind: 'number', unit: 'KLD', required: false },
    { key: 'stp_capacity_kld', label: 'STP capacity', kind: 'number', unit: 'KLD', required: false },
  ],
  'technical.fire_life_safety': [
    { key: 'refuge_area_required', label: 'Refuge area required', kind: 'area', unit: 'sqm', from: 'NBC calculation' },
    { key: 'refuge_area_provided', label: 'Refuge area provided', kind: 'area', unit: 'sqm', from: 'Sanctioned plan' },
    { key: 'staircases', label: 'Escape staircases', kind: 'number' },
    { key: 'site_photos', label: 'Site photographs', kind: 'evidence', accepts: 'image', required: false },
  ],

  /* --- Cost & quantity: the rest ------------------------------------ */
  'cost_quantity.boq_alignment': [
    { key: 'boq_value', label: 'BOQ value', kind: 'money', unit: 'INR', from: 'BOQ', proof: 'required' },
    { key: 'measured_value', label: 'Re-measured value', kind: 'money', unit: 'INR', from: 'Quantity check' },
    { key: 'variance_pct', label: 'Variance', kind: 'computed', unit: '%', formula: { op: 'variance_pct', left: { op: 'field', key: 'measured_value' }, right: { op: 'field', key: 'boq_value' } } },
  ],
  'cost_quantity.variations': [
    {
      key: 'variations',
      label: 'Variations',
      kind: 'table',
      from: 'Variation register',
      proof: 'expected',
      columns: [
        { key: 'ref', label: 'Ref', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'money', unit: 'INR' },
        { key: 'approved_on', label: 'Approved on', kind: 'date', required: false },
        { key: 'built', label: 'Already built', kind: 'boolean', control: 'checkbox' },
      ],
    },
    { key: 'variation_total', label: 'Variations in total', kind: 'computed', unit: 'INR', formula: { op: 'sum', table: 'variations', column: 'value' } },
  ],
  'cost_quantity.forecast': [
    { key: 'forecast_at_completion', label: 'Forecast at completion', kind: 'money', unit: 'INR', from: 'Cost report', proof: 'required' },
    { key: 'forecast_dated', label: 'Forecast dated', kind: 'date', from: 'Cost report' },
    { key: 'contingency_left', label: 'Contingency remaining', kind: 'money', unit: 'INR', required: false },
  ],

  /* --- Schedule: the rest -------------------------------------------- */
  'schedule_progress.baseline': [
    { key: 'baseline_approved', label: 'Baseline approved', kind: 'boolean', control: 'switch' },
    { key: 'baseline_date', label: 'Baseline dated', kind: 'date', from: 'Baseline programme', proof: 'required' },
    { key: 'programme', label: 'Programme file', kind: 'evidence', accepts: 'document', required: false },
  ],
  'schedule_progress.milestones': [
    {
      key: 'milestones',
      label: 'Contract milestones',
      kind: 'table',
      from: 'Contract',
      columns: [
        { key: 'name', label: 'Milestone', kind: 'text' },
        { key: 'contractual', label: 'Contractual', kind: 'date' },
        { key: 'forecast', label: 'Forecast', kind: 'date', required: false },
        { key: 'met', label: 'Met', kind: 'boolean', control: 'checkbox' },
      ],
    },
  ],
  'schedule_progress.delays': [
    {
      key: 'delays',
      label: 'Delay events',
      kind: 'table',
      from: 'Delay register',
      columns: [
        { key: 'event', label: 'Event', kind: 'text' },
        { key: 'days', label: 'Days', kind: 'duration', unit: 'days' },
        { key: 'cause', label: 'Cause', kind: 'enum', options: ['employer', 'contractor', 'neutral', 'unresolved'] },
        { key: 'notified', label: 'Notified in time', kind: 'boolean', control: 'checkbox' },
      ],
    },
    { key: 'total_delay_days', label: 'Delay claimed in total', kind: 'computed', unit: 'days', formula: { op: 'sum', table: 'delays', column: 'days' } },
  ],

  /* --- Commercial & market ------------------------------------------- */
  'commercial_market.comps': [
    {
      key: 'comparables',
      label: 'Comparables',
      kind: 'table',
      from: 'Market evidence',
      proof: 'expected',
      columns: [
        { key: 'address', label: 'Address', kind: 'text' },
        { key: 'date', label: 'Transacted', kind: 'date' },
        { key: 'area', label: 'Area', kind: 'area', unit: 'sqm' },
        { key: 'price', label: 'Price', kind: 'money', unit: 'INR' },
        { key: 'source', label: 'Source', kind: 'enum', options: ['registered', 'listing', 'agent', 'valuer'] },
      ],
    },
    { key: 'comparable_count', label: 'Comparables on file', kind: 'computed', formula: { op: 'count', table: 'comparables' } },
    { key: 'evidence_cutoff', label: 'Evidence cut-off', kind: 'date' },
  ],
  'commercial_market.absorption': [
    { key: 'units_total', label: 'Units in the scheme', kind: 'number' },
    { key: 'units_sold', label: 'Units sold', kind: 'number', from: 'Sales MIS', proof: 'required' },
    { key: 'sold_pct', label: 'Sold', kind: 'computed', unit: '%', formula: { op: 'multiply', left: { op: 'divide', left: { op: 'field', key: 'units_sold' }, right: { op: 'field', key: 'units_total' } }, right: { op: 'const', value: 100 } } },
    { key: 'velocity_per_month', label: 'Assumed velocity', kind: 'number', unit: 'units/month' },
  ],

  /* --- Financial appraisal -------------------------------------------- */
  'financial_appraisal.revenue_assumptions': [
    { key: 'rate_per_sqm', label: 'Assumed rate', kind: 'money', unit: 'INR/sqm', from: 'Appraisal', proof: 'required' },
    { key: 'saleable_area', label: 'Saleable area', kind: 'area', unit: 'sqm' },
    { key: 'gross_revenue', label: 'Gross revenue', kind: 'computed', unit: 'INR', formula: { op: 'multiply', left: { op: 'field', key: 'rate_per_sqm' }, right: { op: 'field', key: 'saleable_area' } } },
    { key: 'assumption_dated', label: 'Assumptions dated', kind: 'date' },
  ],
  'financial_appraisal.margin': [
    { key: 'gross_revenue', label: 'Gross revenue', kind: 'money', unit: 'INR', from: 'Appraisal' },
    { key: 'total_cost', label: 'Total cost', kind: 'money', unit: 'INR', from: 'Cost plan' },
    { key: 'margin_pct', label: 'Margin', kind: 'computed', unit: '%', formula: { op: 'variance_pct', left: { op: 'field', key: 'gross_revenue' }, right: { op: 'field', key: 'total_cost' } } },
    { key: 'hurdle_pct', label: 'Stated hurdle', kind: 'percent', unit: '%' },
  ],

  /* --- Procurement ----------------------------------------------------- */
  'procurement.award_completeness': [
    { key: 'packages_awarded', label: 'Packages awarded', kind: 'number' },
    { key: 'contracts_executed', label: 'Contracts executed', kind: 'number', from: 'Contract register', proof: 'required' },
    { key: 'unexecuted', label: 'Awarded but unexecuted', kind: 'computed', formula: { op: 'subtract', left: { op: 'field', key: 'packages_awarded' }, right: { op: 'field', key: 'contracts_executed' } } },
  ],
  'procurement.security': [
    { key: 'pbg_required', label: 'Performance security required', kind: 'money', unit: 'INR', from: 'Contract' },
    { key: 'pbg_held', label: 'Performance security held', kind: 'money', unit: 'INR', from: 'Bank guarantee', proof: 'required' },
    { key: 'pbg_valid_to', label: 'Valid to', kind: 'date', required: false },
    { key: 'insurance_in_force', label: 'Insurance in force', kind: 'boolean', control: 'switch' },
  ],

  /* --- Quality ---------------------------------------------------------- */
  'quality.ncrs': [
    { key: 'ncrs_raised', label: 'NCRs raised', kind: 'number', from: 'NCR register' },
    { key: 'ncrs_closed', label: 'NCRs closed with evidence', kind: 'number', from: 'NCR register', proof: 'required' },
    { key: 'ncrs_open', label: 'Still open', kind: 'computed', formula: { op: 'subtract', left: { op: 'field', key: 'ncrs_raised' }, right: { op: 'field', key: 'ncrs_closed' } } },
  ],
  'quality.testing': [
    {
      key: 'tests',
      label: 'Specified tests',
      kind: 'table',
      from: 'Test reports',
      proof: 'expected',
      columns: [
        { key: 'test', label: 'Test', kind: 'text' },
        { key: 'required', label: 'Required', kind: 'number' },
        { key: 'done', label: 'Results on file', kind: 'number' },
        { key: 'passed', label: 'All passed', kind: 'boolean', control: 'checkbox' },
      ],
    },
  ],

  /* --- HSE ---------------------------------------------------------------- */
  'hse.incidents': [
    { key: 'lti_count', label: 'Lost-time injuries', kind: 'number', from: 'HSE register' },
    { key: 'near_misses', label: 'Near misses logged', kind: 'number', required: false },
    { key: 'manhours', label: 'Man-hours worked', kind: 'number', required: false },
    { key: 'ltifr', label: 'LTIFR (per million hours)', kind: 'computed', formula: { op: 'divide', left: { op: 'multiply', left: { op: 'field', key: 'lti_count' }, right: { op: 'const', value: 1000000 } }, right: { op: 'field', key: 'manhours' } } },
  ],
  'hse.training': [
    { key: 'workforce', label: 'Workforce on site', kind: 'number' },
    { key: 'inducted', label: 'Inducted', kind: 'number', from: 'Induction register', proof: 'required' },
    { key: 'inducted_pct', label: 'Inducted', kind: 'computed', unit: '%', formula: { op: 'multiply', left: { op: 'divide', left: { op: 'field', key: 'inducted' }, right: { op: 'field', key: 'workforce' } }, right: { op: 'const', value: 100 } } },
  ],

  /* --- ESG ------------------------------------------------------------------ */
  'esg.clearance': [
    { key: 'ec_required', label: 'Environmental clearance required', kind: 'boolean', control: 'switch' },
    { key: 'ec_granted_on', label: 'Clearance granted on', kind: 'date', from: 'EC order', required: false, proof: 'required' },
    { key: 'compliance_reports_due', label: 'Half-yearly reports due', kind: 'number', required: false },
    { key: 'compliance_reports_filed', label: 'Filed', kind: 'number', required: false },
  ],

  /* --- Condition & operations ------------------------------------------------ */
  'condition_operations.survey': [
    { key: 'survey_date', label: 'Condition survey dated', kind: 'date', from: 'Condition survey', proof: 'required' },
    { key: 'overall_condition', label: 'Overall condition', kind: 'enum', control: 'segmented', options: ['good', 'fair', 'poor', 'dilapidated'] },
    { key: 'photographs', label: 'Photographs', kind: 'evidence', accepts: 'image', required: false },
    { key: 'observations', label: 'Observations', kind: 'longtext', required: false },
  ],
  'condition_operations.maintenance': [
    { key: 'backlog_value', label: 'Maintenance backlog', kind: 'money', unit: 'INR', from: 'Asset register' },
    { key: 'annual_budget', label: 'Annual maintenance budget', kind: 'money', unit: 'INR', required: false },
    { key: 'backlog_years', label: 'Backlog in budget-years', kind: 'computed', unit: 'years', formula: { op: 'divide', left: { op: 'field', key: 'backlog_value' }, right: { op: 'field', key: 'annual_budget' } } },
  ],

  /* --- Indicative valuation --------------------------------------------------- */
  'indicative_valuation.instruction': [
    { key: 'purpose', label: 'Purpose', kind: 'enum', options: ['acquisition', 'lending', 'financial reporting', 'insolvency', 'internal'] },
    { key: 'intended_user', label: 'Intended user', kind: 'text' },
    { key: 'reliance_permitted', label: 'Reliance permitted by third parties', kind: 'boolean', control: 'switch' },
  ],
  // Three bases were offered here as if they were equivalent. Only carpet has
  // a statutory definition — RERA s.2(k) — and super built-up has none at all,
  // which is why RERA stopped apartments being sold on it. So the quoted basis
  // is recorded as what it is (what the market said), and the figure that can
  // actually be checked is recorded beside it.
  'indicative_valuation.subject': [
    {
      key: 'quoted_basis',
      label: 'Area basis as quoted',
      kind: 'enum',
      control: 'radio',
      options: AREA_BASIS_OPTIONS,
      hint: 'What the seller or the brochure states. Only carpet is defined in law.',
    },
    { key: 'quoted_area', label: 'Area on the quoted basis', kind: 'area', unit: 'sqm', proof: 'required', from: 'Approved drawings' },
    {
      key: 'rera_carpet_area',
      label: 'RERA carpet area',
      kind: 'area',
      unit: 'sqm',
      required: false,
      proof: 'expected',
      from: 'RERA registration or approved drawings',
      hint: 'RERA s.2(k). The only figure two parties can arrive at independently — record it whenever the quote is on anything else.',
    },
    {
      key: 'ipms_basis',
      label: 'IPMS basis measured to',
      kind: 'enum',
      required: false,
      options: ['IPMS 1', 'IPMS 2', 'IPMS 3', 'IPMS 4'],
      from: 'Measured survey',
      hint: '1 whole building to the outer face · 2 whole building internally · 3 exclusive occupant area · 4 component areas.',
    },
    { key: 'ipms_area', label: 'Area on that IPMS basis', kind: 'area', unit: 'sqm', required: false },
    { key: 'interest', label: 'Interest valued', kind: 'enum', options: ['freehold', 'leasehold', 'development rights'] },
  ],
  'indicative_valuation.dates': [
    { key: 'valuation_date', label: 'Valuation date', kind: 'date' },
    { key: 'inspection_date', label: 'Inspection date', kind: 'date' },
    { key: 'evidence_cutoff', label: 'Evidence cut-off', kind: 'date' },
    { key: 'inspection_gap_days', label: 'Days between inspection and valuation', kind: 'computed', unit: 'days', formula: { op: 'days_between', left: 'valuation_date', right: 'inspection_date' } },
  ],
  'indicative_valuation.basis': [
    { key: 'basis', label: 'Basis of value', kind: 'enum', options: ['market value', 'investment value', 'liquidation', 'replacement cost'] },
    { key: 'premise', label: 'Premise', kind: 'enum', options: ['as is', 'as completed', 'residual', 'forced sale'] },
    { key: 'special_assumptions', label: 'Special assumptions', kind: 'longtext', required: false },
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
  'regulatory.sanction': [
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
  'cost_quantity.budget_current': [
    {
      kind: 'compare',
      fields: ['sanctioned_budget', 'current_forecast'],
      tolerance: 0.05,
      severity: 'high',
      say: 'The sanctioned budget is {a} and the forecast at completion is {b} — {divergence} apart, past the {tolerance} threshold this check treats as material.',
    },
  ],
  'cost_quantity.commitments': [
    {
      kind: 'compare',
      fields: ['committed', 'certified'],
      tolerance: 0.15,
      severity: 'medium',
      say: '{a} committed against {b} certified — {divergence} apart. A wide gap is either work done and unbilled or commitments running ahead of delivery.',
    },
  ],
  'schedule_progress.planned_vs_actual': [
    {
      kind: 'compare',
      fields: ['planned_percent', 'actual_percent'],
      tolerance: 0.05,
      severity: 'medium',
      say: 'Planned {a} against actual {b} — {divergence} apart. Slippage at this scale moves the completion date, not just the curve.',
    },
  ],
  'schedule_progress.forecast_completion': [
    { kind: 'before', fields: ['contractual_completion', 'forecast_completion'], severity: 'high', say: 'Contractual completion is {a} and the forecast is {b} — the forecast is later, so liquidated damages are already in play.' },
  ],
  'indicative_valuation.subject': [
    {
      kind: 'require_if',
      fields: ['quoted_basis', 'rera_carpet_area'],
      whenIn: UNDEFINED_AREA_BASES,
      severity: 'high',
      say: 'The area is quoted on {a}, which has no statutory definition — the loading behind it is at the seller’s discretion. Record the RERA carpet area beside it, or the stated area cannot be checked against anything.',
    },
    {
      kind: 'require_if',
      fields: ['ipms_basis', 'ipms_area'],
      severity: 'low',
      say: 'An IPMS basis is stated with no area measured on it.',
    },
  ],
};