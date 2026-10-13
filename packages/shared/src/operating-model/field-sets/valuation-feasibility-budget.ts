/**
 * Finance: the sheets of Valuation, Feasibility and Budget.
 *
 * Much of these three functions is kept already, by the checks (the
 * valuation's inputs, the appraisal's assumptions, the cost checks) and by
 * modules of their own (the comparable schedule, the valuation's approaches,
 * the cost register, the monthly cost report). Nothing here keeps any of it
 * a second time: a field that exists is a mirror of it (`sameAs`), a figure
 * a module works out is read from the module (`{ op: 'figure' }`, see
 * `field-figures.ts`), and what is declared new is what none of them holds.
 *
 * What a sheet always shows is small. A valuation's inputs open by approach,
 * a lender's values when the valuation is for lending, a landowner's share
 * under a joint development, an overrun's causes when the forecast is over
 * the budget. Every threshold is a row of the rule table
 * (`rules/valuation-feasibility-budget.ts`), shown as unverified.
 *
 * Left to their owners, and read from them once their sheets exist: the unit
 * and the area statement (Architect), variations and extensions of time
 * (Procurement), milestones (Construction), the agreement's terms (Legal),
 * stamp value and tax (Tax), the loan (Lenders).
 */

import type { CheckFieldDef, CheckFormula, CheckInsightRule, FieldAddress, FieldSet, FormulaCondition, Situation } from '../types';
import { statedBySeveral, withLinks, type SetLinks } from './builders';

const VAL = 'finance.valuation';
const FEA = 'finance.feasibility';
const BUD = 'finance.budget';

/* --- Addresses of what exists ------------------------------------------ */

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
const instruction = (field: string) => at(VAL, 'indicative_valuation.instruction', field);
const subject = (field: string) => at(VAL, 'indicative_valuation.subject', field);
const dates = (field: string) => at(VAL, 'indicative_valuation.dates', field);
const basisOf = (field: string) => at(VAL, 'indicative_valuation.basis', field);
const comparableInput = (field: string) => at(VAL, 'indicative_valuation.comparable_inputs', field);
const costInput = (field: string) => at(VAL, 'indicative_valuation.cost_inputs', field);
const incomeInput = (field: string) => at(VAL, 'indicative_valuation.income_inputs', field);
const residualInput = (field: string) => at(VAL, 'indicative_valuation.residual_inputs', field);
const parcelCheck = (field: string) => at('legal.title', 'land_site.parcel_identification', field);
const sanction = (field: string) => at('legal.approvals', 'regulatory.sanction', field);
const revenueCheck = (field: string) => at(FEA, 'financial_appraisal.revenue_assumptions', field);
const marginCheck = (field: string) => at(FEA, 'financial_appraisal.margin', field);
const absorption = (field: string) => at('commercial.market', 'commercial_market.absorption', field);
const forecastCheck = (field: string) => at(BUD, 'cost_quantity.forecast', field);
// Progress is Construction's, worked out from the milestones it keeps: the stage a valuation takes and the progress a budget is held to are read from there.
const PROGRESS = at('construction.progress', 'construction.progress.programme', 'actual_percent');
const CONVERSION = at('legal.approvals', 'regulatory.land_use', 'conversion_status');

/* --- The sets of this file --------------------------------------------- */

const V_INSTRUCTION = 'finance.valuation.instruction';
const V_LAND = 'finance.valuation.land';
const V_APPROACHES = 'finance.valuation.approaches';
const V_LEASES = 'finance.valuation.leases';
const V_CONCLUSION = 'finance.valuation.conclusion';
const V_REPORTS = 'finance.valuation.reports';
const V_REGISTER = 'finance.valuation.register';
const F_AREAS = 'finance.feasibility.areas';
const F_REVENUE = 'finance.feasibility.revenue';
const F_COSTS = 'finance.feasibility.costs';
const F_APPROVAL_COSTS = 'finance.feasibility.approval_costs';
const F_PERIODS = 'finance.feasibility.periods';
const F_RETURNS = 'finance.feasibility.returns';
const F_SENSITIVITY = 'finance.feasibility.sensitivity';
const F_DECISION = 'finance.feasibility.decision';
const F_CONDITIONS = 'finance.feasibility.conditions';
const B_APPROVED = 'finance.budget.approved';
const B_CONTINGENCY = 'finance.budget.contingency';
const B_TRANSFERS = 'finance.budget.transfers';
const B_COMMITMENTS = 'finance.budget.commitments';
const B_REPORT = 'finance.budget.cost_report';
const B_TO_COMPLETE = 'finance.budget.to_complete';

/* --- Formulas, written short ------------------------------------------- */

const own = (key: string): CheckFormula => ({ op: 'field', key });
const there = (address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address });
const figure = (key: string): CheckFormula => ({ op: 'figure', key });
const n = (value: number): CheckFormula => ({ op: 'const', value });
const add = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'add', left, right });
const sub = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
const mul = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'multiply', left, right });
const div = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'divide', left, right });
const sum = (...parts: CheckFormula[]): CheckFormula => parts.reduce(add);
/** A percentage of an amount. */
const pctOf = (amount: CheckFormula, pct: CheckFormula): CheckFormula => mul(amount, div(pct, n(100)));
/** One amount as a percentage of another. */
const share = (part: CheckFormula, whole: CheckFormula): CheckFormula => mul(div(part, whole), n(100));
const variance = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'variance_pct', left, right });
/** A figure, or nothing counted where it is not recorded: for a head of cost a scheme may not have. */
const orNone = (formula: CheckFormula): CheckFormula => ({ op: 'max', of: [{ op: 'min', of: [formula, n(0)] }, formula] });
const when = (condition: FormulaCondition, then: CheckFormula, otherwise: CheckFormula): CheckFormula => ({ op: 'if', when: condition, then, else: otherwise });
const today: CheckFormula = { op: 'today' };
const dateAt = (address: FieldAddress): CheckFormula => ({ op: 'date', key: address.field, at: address });
const countOf = (set: string): CheckFormula => ({ op: 'records', set, reduce: 'count' });
const sumOf = (set: string, field: string): CheckFormula => ({ op: 'records', set, reduce: 'sum', field });
const rate = (table: string, where?: Record<string, { field: string } | { value: string | number }>): CheckFormula => ({ op: 'rate', table, ...(where ? { where } : {}) });

/* --- Fields, written short --------------------------------------------- */

type More = Partial<CheckFieldDef>;
const INR = { dimension: 'money', currency: 'INR' } as const;
const PER_SQM = { unit: 'INR/sqm' } as const;
const SQM = { unit: 'sqm' } as const;

/** A field entered elsewhere, read here. */
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: More = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });
const worked = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, ...more });
const money = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'money', ...INR, ...more });
const percent = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'percent', unit: '%', ...more });
const paper = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, ...more });
const optional = { required: false } as const;
const expert = { tier: 'expert', required: false } as const;

const rule = (kind: CheckInsightRule['kind'], fields: string[], say: string, severity: CheckInsightRule['severity'], more: Partial<CheckInsightRule> = {}): CheckInsightRule => ({ kind, fields, say, severity, ...more });

/* --- Situations more than one of these functions answers to ------------ */

// joint_development is Law's to declare (the agreement is its paper), lender_funded is Lenders' (a facility recorded), tdr_or_premium_far is the
// Architect's and agricultural_needs_conversion is Liaison's. They are named here and declared once, in their owners' files.
const FOR_LENDING: Situation = { key: 'valuation_for_lending', label: 'For lending', scope: 'function', hint: 'The valuation is for a lender.', derive: { field: instruction('purpose'), is: 'equals', value: 'lending' } };
const FOR_INSOLVENCY: Situation = { key: 'valuation_for_insolvency', label: 'For insolvency', scope: 'function', hint: 'The valuation is for an insolvency process.', derive: { field: instruction('purpose'), is: 'equals', value: 'insolvency' } };

const COST_HEADS = ['Land', 'Approvals', 'Structure', 'Finishes', 'MEP', 'Facade', 'External works', 'Amenities', 'Preliminaries', 'Consultants', 'Marketing', 'Finance', 'Overheads', 'Contingency', 'Taxes'];

/* ==================================================================== */
/* Valuation                                                             */
/* ==================================================================== */

const VALUATION: FieldSet[] = [
  /* --- Instruction, basis and dates ---------------------------------- */
  {
    id: V_INSTRUCTION,
    fn: VAL,
    title: 'Instruction',
    v: 1,
    situations: [FOR_LENDING, FOR_INSOLVENCY],
    optionSets: [
      {
        id: 'valuation_report_format',
        label: 'Report format',
        options: [
          { key: 'lender_format', label: 'Lender’s format', tone: 'info' },
          { key: 'ibbi_land_building', label: 'IBBI format', tone: 'info' },
          { key: 'registered_valuer_general', label: 'Valuer’s report', tone: 'neutral' },
          { key: 'internal_note', label: 'Internal note', tone: 'neutral' },
        ],
      },
      {
        id: 'valuation_conflict_interest',
        label: 'Interest declared',
        options: ['Financial', 'Family', 'Prior engagement', 'Fee contingent on the value'].map((label) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label })),
      },
      {
        id: 'valuation_standard',
        label: 'Standard',
        options: ['International Valuation Standards', 'RICS Red Book', 'IBBI valuation standards', 'The lender’s own policy'].map((label, i) => ({ key: ['ivs', 'rics_red_book', 'ibbi', 'lender_policy'][i]!, label })),
      },
      {
        id: 'valuation_restriction',
        label: 'Restriction on use',
        options: ['Named user only', 'Stated purpose only', 'Not for use in court', 'Valid for a stated period'].map((label) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label })),
      },
    ],
    sections: [
      { key: 'instruction', label: 'Instruction' },
      { key: 'valuer', label: 'Valuer' },
      { key: 'dates', label: 'Dates' },
      { key: 'lending', label: 'For the lender', showWhen: { situation: 'valuation_for_lending' } },
      { key: 'insolvency', label: 'For the insolvency process', showWhen: { situation: 'valuation_for_insolvency' } },
      { key: 'more', label: 'Standards and limits', tier: 'expert' },
    ],
    fields: [
      mirror('purpose', 'Purpose', 'text', instruction('purpose'), { section: 'instruction' }),
      mirror('intended_user', 'Intended user', 'text', instruction('intended_user'), { section: 'instruction' }),
      { key: 'report_format', label: 'Report format', kind: 'enum', control: 'tiles', optionSet: 'valuation_report_format', section: 'instruction', from: 'Engagement letter or the lender’s request' },
      { key: 'appointing_party', label: 'Appointed by', kind: 'ref', target: 'party', section: 'instruction', from: 'Engagement letter' },
      mirror('basis', 'Basis of value', 'text', basisOf('basis'), { section: 'instruction' }),
      mirror('premise', 'Premise', 'text', basisOf('premise'), { section: 'instruction' }),
      { key: 'valuer', label: 'Valuer', kind: 'ref', target: 'party', section: 'valuer', from: 'Registration certificate' },
      { key: 'conflict_declared', label: 'Conflict or interest declared', kind: 'boolean', control: 'switch', section: 'valuer', from: 'Valuer’s declaration' },
      {
        key: 'conflict_interests',
        label: 'Interests declared',
        kind: 'multi_enum',
        optionSet: 'valuation_conflict_interest',
        section: 'valuer',
        tier: 'situational',
        showWhen: { field: at(VAL, V_INSTRUCTION, 'conflict_declared'), is: 'true' },
      },
      { key: 'appointed_on', label: 'Appointed on', kind: 'date', section: 'dates', from: 'Engagement letter' },
      mirror('valuation_date', 'Valuation date', 'date', dates('valuation_date'), { section: 'dates' }),
      { key: 'report_date', label: 'Report date', kind: 'date', section: 'dates', from: 'Valuation report' },
      {
        key: 'instruction_standing',
        label: 'Instruction',
        kind: 'status',
        section: 'dates',
        cases: [
          { when: rule('before', ['valuation_date', 'report_date'], 'The report is dated {b}, before the valuation date {a}.', 'high'), label: 'Report dated before the valuation date', tone: 'critical' },
          { when: rule('before', ['appointed_on', 'report_date'], 'The report is dated {b}, before the appointment on {a}.', 'high'), label: 'Report dated before the appointment', tone: 'critical' },
          { when: rule('require', ['valuer'], 'No valuer is named.', 'medium'), label: 'Valuer not named', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'lender', label: 'Lender the report is for', kind: 'ref', target: 'party', section: 'lending', tier: 'situational', from: 'Lender’s valuation request' },
      { key: 'valuer_on_panel', label: 'Valuer is on the lender’s panel', kind: 'boolean', control: 'switch', section: 'lending', tier: 'situational', from: 'Lender’s panel list' },
      { key: 'validity_months', label: 'Report valid for', kind: 'duration', unit: 'months', section: 'lending', tier: 'situational', from: 'Lender’s policy', required: false },
      { key: 'report_id_number', label: 'Valuation report identification number', kind: 'text', section: 'insolvency', tier: 'situational', from: 'The authority’s register', hint: 'As generated on the authority’s site.' },
      mirror('inspection_date', 'Inspection date', 'date', dates('inspection_date'), { section: 'more', tier: 'expert' }),
      worked('inspection_gap_days', 'Days between inspection and valuation', there(dates('inspection_gap_days')), { unit: 'days', section: 'more', tier: 'expert' }),
      worked('inspection_gap_limit', 'Most days allowed between them', rate('valuation_inspection_gap_days'), { unit: 'days', section: 'more', tier: 'expert' }),
      { key: 'standards_followed', label: 'Standards followed', kind: 'multi_enum', optionSet: 'valuation_standard', section: 'more', ...expert },
      { key: 'restrictions_on_use', label: 'Restrictions on use', kind: 'multi_enum', optionSet: 'valuation_restriction', section: 'more', ...expert },
      {
        key: 'other_experts',
        label: 'Other experts relied on',
        kind: 'table',
        section: 'more',
        ...expert,
        columns: [
          { key: 'expert', label: 'Expert', kind: 'ref', target: 'party' },
          { key: 'contribution', label: 'Relied on for', kind: 'enum', options: ['Structure', 'Title', 'Market', 'Cost', 'Environment'] },
        ],
      },
    ],
    rules: [
      rule('before', ['valuation_date', 'report_date'], 'The report is dated {b}, before the valuation date {a}.', 'high'),
      rule('at_most', ['inspection_gap_days', 'inspection_gap_limit'], 'The inspection and the valuation date are {a} apart; {b} at most.', 'medium'),
      rule('require', ['lender'], 'The valuation is for lending and no lender is named.', 'medium', { when: { situation: 'valuation_for_lending' } }),
      rule('require_if', ['conflict_declared', 'conflict_interests'], 'A conflict is declared and the interests are not said.', 'medium', { whenIn: ['true'] }),
    ],
  },
  {
    id: 'finance.valuation.valuer',
    fn: VAL,
    title: 'Valuer',
    v: 1,
    extends: 'shared.parties',
    fields: [
      { key: 'valuer_registration_no', label: 'Valuer’s registration number', kind: 'text', ...expert, from: 'Registration certificate', hint: 'As on the IBBI register of valuers.' },
      { key: 'valuer_registered_for', label: 'Registered to value', kind: 'enum', options: ['Land and building', 'Plant and machinery', 'Securities or financial assets'], ...expert, from: 'Registration certificate' },
      { key: 'valuer_practice_status', label: 'Certificate of practice', kind: 'enum', control: 'segmented', options: ['Active', 'Inactive'], ...expert, from: 'IBBI register of valuers' },
    ],
    rules: [],
  },

  /* --- Subject land and land value ----------------------------------- */
  {
    id: V_LAND,
    fn: VAL,
    title: 'Land and its value',
    v: 1,
    situations: [
      {
        key: 'partial_or_limited_interest',
        label: 'Less than the freehold',
        scope: 'function',
        hint: 'A lease, development rights or one owner’s share is valued, not the whole freehold.',
        derive: { field: subject('interest'), is: 'in', value: ['leasehold', 'development rights'] },
      },
    ],
    optionSets: [
      {
        id: 'land_possession',
        label: 'Possession',
        options: [
          { key: 'owner', label: 'With the owner', tone: 'good' },
          { key: 'vacant', label: 'Vacant', tone: 'good' },
          { key: 'tenant', label: 'With a tenant', tone: 'info' },
          { key: 'encroached', label: 'Encroached', tone: 'critical' },
          { key: 'disputed', label: 'Disputed', tone: 'critical' },
        ],
      },
    ],
    sections: [
      { key: 'land', label: 'The land' },
      { key: 'guidance', label: 'Guidance value' },
      { key: 'value', label: 'Land value' },
      { key: 'interest', label: 'Interest valued', showWhen: { situation: 'partial_or_limited_interest' } },
      { key: 'site', label: 'Shape and boundaries', tier: 'expert' },
    ],
    fields: [
      worked('plot_area', 'Plot area valued', figure('project.land_area'), { ...SQM, section: 'land' }),
      mirror('extent_title', 'Extent per title', 'area', parcelCheck('extent_title'), { ...SQM, section: 'land' }),
      mirror('survey_numbers', 'Survey numbers', 'text', parcelCheck('survey_numbers'), { section: 'land' }),
      mirror('access_type', 'Access', 'text', at('legal.title', 'land_site.access', 'access_type'), { section: 'land' }),
      { key: 'possession', label: 'Possession', kind: 'enum', control: 'tiles', optionSet: 'land_possession', section: 'land', from: 'Site visit' },
      mirror('guideline_rate', 'Guidance rate', 'money', subject('guideline_rate_per_sqm'), { ...PER_SQM, section: 'guidance' }),
      { key: 'guideline_read_on', label: 'Guidance rate read on', kind: 'date', section: 'guidance', from: 'The registration department’s guidance value, on the day it was read' },
      worked('guideline_value', 'Guidance value of the land', mul(there(subject('guideline_rate_per_sqm')), own('plot_area')), { ...INR, section: 'guidance' }),
      mirror('land_rate', 'Land rate adopted', 'money', costInput('land_rate_per_sqm'), { ...PER_SQM, section: 'value' }),
      worked('land_value', 'Land value', mul(there(costInput('land_rate_per_sqm')), own('plot_area')), { ...INR, section: 'value' }),
      worked('vs_guideline', 'Land value against guidance value', variance(own('land_value'), own('guideline_value')), { unit: '%', precision: 1, section: 'value' }),
      {
        key: 'land_standing',
        label: 'Land',
        kind: 'status',
        section: 'value',
        cases: [
          { when: rule('compare', ['plot_area', 'extent_title'], 'The plot valued is {a} and the title gives {b}: {divergence} apart.', 'high'), label: 'Plot area differs from the title', tone: 'critical' },
          { when: rule('require', ['land_value'], 'No land value is worked out yet.', 'low'), label: 'No land value yet', tone: 'neutral' },
          { when: rule('at_least', ['land_value', 'guideline_value'], 'The land value {a} is below its guidance value {b}.', 'medium'), label: 'Below the guidance value', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      mirror('interest', 'Interest valued', 'text', subject('interest'), { section: 'interest', tier: 'situational' }),
      percent('share_valued_pct', 'Share of the land valued', { section: 'interest', tier: 'situational', max: 100, from: 'Title deed' }),
      percent('undivided_share_discount_pct', 'Discount for an undivided share', { section: 'interest', tier: 'situational', max: 100, required: false }),
      { key: 'frontage', label: 'Frontage', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'site', ...expert, from: 'Survey sketch', fromTypes: ['Survey sketch'] },
      { key: 'depth', label: 'Depth', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'site', ...expert, from: 'Survey sketch', fromTypes: ['Survey sketch'] },
      worked('frontage_to_depth', 'Frontage to depth', div(own('frontage'), own('depth')), { section: 'site', tier: 'expert' }),
      { key: 'shape', label: 'Shape', kind: 'enum', options: ['Regular', 'Irregular', 'L-shaped', 'Triangular', 'Flag'], section: 'site', ...expert, from: 'Survey sketch' },
      { key: 'level', label: 'Level', kind: 'enum', options: ['Level', 'Sloping', 'Low-lying', 'Filled'], section: 'site', ...expert, from: 'Site visit' },
      { key: 'corner_plot', label: 'Corner plot', kind: 'boolean', control: 'tick', section: 'site', ...expert, from: 'Survey sketch' },
      { key: 'boundaries_walked', label: 'Boundaries walked on site', kind: 'boolean', control: 'tick', section: 'site', ...expert, from: 'Site visit' },
      {
        key: 'boundaries',
        label: 'Boundaries',
        kind: 'table',
        section: 'site',
        ...expert,
        from: 'Sale deed schedule and the site visit',
        columns: [
          { key: 'side', label: 'Side', kind: 'enum', options: ['North', 'South', 'East', 'West'] },
          { key: 'per_deed', label: 'Per the deed', kind: 'text' },
          { key: 'on_ground', label: 'On the ground', kind: 'text' },
          { key: 'agrees', label: 'Agrees', kind: 'boolean', control: 'checkbox' },
        ],
      },
      { key: 'title_deed', label: 'Title deed', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'site', ...expert },
    ],
    rules: [
      rule('compare', ['plot_area', 'extent_title'], 'The plot valued is {a} and the title gives {b}: {divergence} apart, outside {tolerance}.', 'high'),
      rule('require', ['share_valued_pct'], 'Less than the freehold is valued and the share is not recorded.', 'medium', { when: { situation: 'partial_or_limited_interest' } }),
    ],
  },
  {
    id: 'finance.valuation.parcel',
    fn: VAL,
    title: 'Guidance value of a parcel',
    v: 1,
    extends: 'shared.parcels',
    fields: [
      { key: 'guidance_rate', label: 'Guidance rate of this parcel', kind: 'money', ...PER_SQM, ...expert, from: 'The registration department’s guidance value' },
      { key: 'guidance_read_on', label: 'Guidance rate read on', kind: 'date', ...expert },
    ],
    rules: [],
  },

  /* --- Inputs, by approach ------------------------------------------- */
  {
    id: V_APPROACHES,
    fn: VAL,
    title: 'Inputs by approach',
    v: 1,
    situations: [
      // The four approaches are declared with the valuation checks whose inputs they bring into play (check-conditions.ts): one key each, in play as soon as an input is recorded.
      { key: 'asset_under_construction', label: 'Under construction', scope: 'function', hint: 'What is valued is part built.' },
    ],
    sections: [
      { key: 'market', label: 'Market comparison', showWhen: { situation: 'comparable_approach' } },
      { key: 'cost', label: 'Cost', showWhen: { situation: 'cost_approach' } },
      { key: 'income', label: 'Income', showWhen: { situation: 'income_approach' } },
      { key: 'residual', label: 'Residual', showWhen: { situation: 'residual_approach' } },
      { key: 'in_progress', label: 'Work in progress', showWhen: { situation: 'asset_under_construction' } },
    ],
    fields: [
      worked('comparables_count', 'Comparables in the schedule', figure('comparables.count'), { section: 'market', tier: 'situational' }),
      worked('comparables_short', 'Comparables still needed', figure('comparables.short'), { section: 'market', tier: 'situational' }),
      worked('adjusted_rate', 'Adjusted comparable rate', figure('comparables.adjusted_rate'), { ...PER_SQM, precision: 0, section: 'market', tier: 'situational' }),
      worked('net_adjustment_pct', 'Net adjustment', figure('comparables.net_adjustment_pct'), { unit: '%', precision: 1, section: 'market', tier: 'situational' }),
      mirror('rate_applied', 'Rate applied', 'money', comparableInput('rate_per_sqm'), { ...PER_SQM, section: 'market', tier: 'situational' }),
      mirror('rate_basis', 'What the rate rests on', 'text', comparableInput('rate_basis'), { section: 'market', tier: 'situational' }),
      mirror('evidence_cutoff', 'Evidence cut-off', 'date', dates('evidence_cutoff'), { section: 'market', tier: 'situational' }),
      {
        key: 'market_standing',
        label: 'Market comparison',
        kind: 'status',
        section: 'market',
        tier: 'situational',
        cases: [
          { when: rule('at_most', ['comparables_short'], '{a} more comparables are needed for a schedule.', 'medium', { against: 0 }), label: 'Too few comparables', tone: 'warning' },
          { when: rule('compare', ['adjusted_rate', 'rate_applied'], 'The schedule gives {a} and the rate applied is {b}: {divergence} apart.', 'medium', { tolerance: 0.05 }), label: 'Rate differs from the schedule', tone: 'warning' },
        ],
        otherwise: { label: 'Rate follows the schedule', tone: 'good' },
      },

      worked('buildings_count', 'Buildings', countOf('shared.buildings'), { section: 'cost', tier: 'situational' }),
      worked('built_up_total', 'Built-up area in total', sumOf('shared.buildings', 'built_up_area'), { ...SQM, section: 'cost', tier: 'situational' }),
      mirror('sanctioned_area', 'Built-up area sanctioned', 'area', sanction('sanctioned_area'), { ...SQM, section: 'cost', tier: 'situational' }),
      worked('unsanctioned_area', 'Built beyond sanction', when({ left: own('built_up_total'), is: 'gt', right: there(sanction('sanctioned_area')) }, sub(own('built_up_total'), there(sanction('sanctioned_area'))), n(0)), { ...SQM, section: 'cost', tier: 'situational' }),
      mirror('replacement_rate', 'Replacement cost rate', 'money', costInput('replacement_rate'), { ...PER_SQM, section: 'cost', tier: 'situational' }),
      {
        key: 'replacement_rate_source',
        label: 'Rate taken from',
        kind: 'enum',
        options: ['Project cost plan', 'CPWD plinth area rates', 'State PWD schedule', 'Quantity surveyor’s estimate', 'Valuer’s benchmark'],
        section: 'cost',
        tier: 'situational',
        from: 'Cost plan or schedule of rates',
      },
      worked('schedule_rate', 'Rate the building schedule works out at', div(own('replacement_cost_new'), own('built_up_total')), { ...PER_SQM, precision: 0, section: 'cost', tier: 'situational' }),
      worked('depreciation_pct', 'Depreciation', there(costInput('depreciation_pct')), { unit: '%', section: 'cost', tier: 'situational' }),
      worked('replacement_cost_new', 'Replacement cost new', sumOf('shared.buildings', 'replacement_cost_new'), { ...INR, section: 'cost', tier: 'situational' }),
      worked('building_value', 'Depreciated building value', sumOf('shared.buildings', 'depreciated_value'), { ...INR, section: 'cost', tier: 'situational' }),
      {
        key: 'extras',
        label: 'Amenities and extra items',
        kind: 'table',
        section: 'cost',
        tier: 'situational',
        required: false,
        columns: [
          { key: 'item', label: 'Item', kind: 'enum', options: ['Compound wall', 'Lift', 'Generator', 'Sewage treatment plant', 'Fire system', 'Solar', 'Landscaping', 'Other'] },
          { key: 'basis', label: 'Basis', kind: 'enum', options: ['Cost plan', 'Invoice', 'Quotation', 'Valuer’s estimate'] },
          { key: 'amount', label: 'Amount', kind: 'money', ...INR },
        ],
      },
      {
        key: 'cost_standing',
        label: 'Cost approach',
        kind: 'status',
        section: 'cost',
        tier: 'situational',
        cases: [
          { when: rule('at_least', ['buildings_count'], 'No building is recorded.', 'low', { against: 1 }), label: 'No building recorded', tone: 'neutral' },
          { when: rule('at_most', ['unsanctioned_area'], '{a} is built beyond the sanction.', 'high', { against: 0 }), label: 'Built beyond sanction', tone: 'critical' },
          { when: rule('compare', ['schedule_rate', 'replacement_rate'], 'The building schedule works out at {a} and the cost approach uses {b}: {divergence} apart.', 'medium', { tolerance: 0.05 }), label: 'Rate differs from the building schedule', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },

      { key: 'occupancy', label: 'Occupied by', kind: 'enum', control: 'segmented', options: ['Owner', 'Let', 'Part let', 'Vacant'], section: 'income', tier: 'situational', from: 'Site visit and the leases' },
      mirror('let_area', 'Lettable area', 'area', incomeInput('let_area'), { ...SQM, section: 'income', tier: 'situational' }),
      mirror('achievable_rent', 'Achievable rent', 'money', incomeInput('achievable_rent'), { unit: 'INR/sqm/month', section: 'income', tier: 'situational' }),
      mirror('vacancy_pct', 'Vacancy allowance', 'percent', incomeInput('vacancy_pct'), { unit: '%', section: 'income', tier: 'situational' }),
      mirror('opex_pct', 'Operating expenses', 'percent', incomeInput('opex_pct'), { unit: '%', section: 'income', tier: 'situational' }),
      mirror('cap_rate_pct', 'Capitalisation rate', 'percent', incomeInput('cap_rate_pct'), { unit: '%', section: 'income', tier: 'situational' }),
      worked('income_value', 'Capitalised value', there(incomeInput('inc_capitalised')), { ...INR, section: 'income', tier: 'situational' }),
      worked('leases_count', 'Leases on file', countOf(V_LEASES), { section: 'income', tier: 'situational' }),
      worked('rent_roll_monthly', 'Rent on the leases, a month', sumOf(V_LEASES, 'monthly_rent'), { ...INR, section: 'income', tier: 'situational' }),
      worked('rent_on_leases', 'Rent the leases work out at', div(own('rent_roll_monthly'), sumOf(V_LEASES, 'area_let')), { unit: 'INR/sqm/month', section: 'income', tier: 'situational' }),
      {
        key: 'income_standing',
        label: 'Income approach',
        kind: 'status',
        section: 'income',
        tier: 'situational',
        cases: [
          { when: rule('require', ['achievable_rent'], 'No rent is assumed yet.', 'low'), label: 'No rent assumed yet', tone: 'neutral' },
          { when: rule('compare', ['rent_on_leases', 'achievable_rent'], 'The leases work out at {a} and the rent assumed is {b}: {divergence} apart.', 'medium', { tolerance: 0.1 }), label: 'Rent assumed differs from the leases', tone: 'warning' },
        ],
        otherwise: { label: 'Rent follows the leases', tone: 'good' },
      },

      mirror('gdv', 'Gross development value', 'money', residualInput('gdv'), { ...INR, section: 'residual', tier: 'situational' }),
      mirror('construction_cost', 'Construction cost', 'money', residualInput('construction_cost'), { ...INR, section: 'residual', tier: 'situational' }),
      mirror('developer_profit_pct', 'Developer’s required profit', 'percent', residualInput('developer_profit_pct'), { unit: '%', section: 'residual', tier: 'situational' }),
      worked('residual_land_value', 'Residual land value', there(residualInput('resid_land_value')), { ...INR, section: 'residual', tier: 'situational' }),
      worked('residual_vs_land_value', 'Residual against the land value adopted', variance(own('residual_land_value'), there(at(VAL, V_LAND, 'land_value'))), { unit: '%', precision: 1, section: 'residual', tier: 'situational' }),

      mirror('stage_percent', 'Stage of construction', 'percent', PROGRESS, { unit: '%', section: 'in_progress', tier: 'situational' }),
      worked('work_done_value', 'Value of work done', pctOf(own('replacement_cost_new'), there(PROGRESS)), { ...INR, section: 'in_progress', tier: 'situational' }),
      money('value_on_completion', 'Value on completion', { section: 'in_progress', tier: 'situational', from: 'Valuer' }),
      worked('cost_to_complete', 'Cost to complete', there(at(BUD, B_TO_COMPLETE, 'cost_to_complete')), { ...INR, section: 'in_progress', tier: 'situational' }),
      worked('value_as_is', 'Value as it stands', sub(own('value_on_completion'), own('cost_to_complete')), { ...INR, section: 'in_progress', tier: 'situational' }),
    ],
    rules: [
      rule('at_most', ['unsanctioned_area'], '{a} is built beyond the sanction, and is left out of the value.', 'high', { against: 0 }),
      rule('compare', ['adjusted_rate', 'rate_applied'], 'The schedule gives {a} and the rate applied is {b}: {divergence} apart, outside {tolerance}.', 'medium', { tolerance: 0.05 }),
      rule('compare', ['rent_on_leases', 'achievable_rent'], 'The leases work out at {a} and the rent assumed is {b}: {divergence} apart, outside {tolerance}.', 'medium', { tolerance: 0.1 }),
      rule('require', ['value_on_completion'], 'What is valued is part built and its value on completion is not recorded.', 'medium', { when: { situation: 'asset_under_construction' } }),
    ],
  },
  {
    id: 'finance.valuation.building',
    fn: VAL,
    title: 'Building, as valued',
    v: 1,
    extends: 'shared.buildings',
    fields: [
      { key: 'use', label: 'Use', kind: 'enum', control: 'segmented', options: ['Residential', 'Commercial', 'Mixed', 'Industrial'], required: false },
      { key: 'structure', label: 'Structure', kind: 'enum', options: ['RCC framed', 'Load bearing', 'Steel'], required: false },
      { key: 'year_built', label: 'Year built', kind: 'number', min: 1800, max: 2100, required: false, from: 'Completion record' },
      { key: 'replacement_rate', label: 'Replacement cost rate', kind: 'money', ...PER_SQM, required: false, from: 'Cost plan or schedule of rates', proof: 'expected' },
      { key: 'effective_age_years', label: 'Effective age', kind: 'duration', unit: 'years', required: false },
      {
        key: 'expected_life_years',
        label: 'Expected total life',
        kind: 'duration',
        unit: 'years',
        required: false,
        defaults: [{ value: 60, from: 'catalog', cite: 'Convention for an RCC framed building, as the Value tab offers it' }],
      },
      worked('replacement_cost_new', 'Replacement cost new', mul(own('built_up_area'), own('replacement_rate')), { ...INR }),
      worked(
        'depreciated_value',
        'Depreciated value',
        mul(own('replacement_cost_new'), sub(n(1), { op: 'min', of: [div(own('effective_age_years'), own('expected_life_years')), n(1)] })),
        { ...INR },
      ),
    ],
    rules: [rule('at_most', ['effective_age_years', 'expected_life_years'], 'Effective age {a} is more than the expected life {b}.', 'medium')],
  },
  {
    id: V_LEASES,
    fn: VAL,
    title: 'Leases',
    v: 1,
    records: { of: 'lease', titleField: 'tenant', summaryFields: ['area_let', 'monthly_rent', 'expires_on'] },
    fields: [
      { key: 'tenant', label: 'Tenant', kind: 'ref', target: 'party' },
      { key: 'area_let', label: 'Area let', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], from: 'Lease deed', fromTypes: ['Lease deed'], factKey: 'leased_area' },
      money('monthly_rent', 'Monthly rent', { from: 'Lease deed', fromTypes: ['Lease deed'], proof: 'expected' }),
      { key: 'lease_start', label: 'Lease starts', kind: 'date', from: 'Lease deed', fromTypes: ['Lease deed'] },
      percent('escalation_pct', 'Escalation', { required: false, from: 'Lease deed' }),
      { key: 'lock_in_ends', label: 'Lock-in ends', kind: 'date', required: false, from: 'Lease deed' },
      { key: 'expires_on', label: 'Lease expires', kind: 'date', expires: { leadDays: 180 }, from: 'Lease deed' },
      { key: 'lease_deed', label: 'Lease deed', kind: 'evidence', accepts: 'document', viewer: 'deed', required: false },
    ],
    rules: [rule('before', ['lease_start', 'expires_on'], 'The lease expires on {b}, before it starts on {a}.', 'medium')],
  },

  /* --- Value conclusion and the lender's summary --------------------- */
  {
    id: V_CONCLUSION,
    fn: VAL,
    title: 'Value conclusion',
    v: 1,
    situations: [
      FOR_LENDING,
      FOR_INSOLVENCY,
      { key: 'title_qualification', label: 'Value rests on an assumption', scope: 'function', hint: 'A defect on the file is assumed cured for the value given.' },
    ],
    optionSets: [
      {
        id: 'lender_policy',
        label: 'Shares taken from',
        options: [
          { key: 'general', label: 'General practice', tone: 'neutral' },
          { key: 'lender_stated', label: 'As the lender states', tone: 'info' },
        ],
      },
      {
        id: 'valuation_major_factor',
        label: 'Factor',
        options: ['Location', 'Access', 'Title', 'Zoning', 'Surroundings', 'Market', 'Condition', 'Approvals', 'Litigation'].map((label) => ({ key: label.toLowerCase(), label })),
      },
      {
        id: 'valuation_assumption',
        label: 'Assumption',
        options: ['Clear title', 'Conversion obtained', 'Sanction obtained', 'Vacant possession', 'Completion as planned', 'No litigation'].map((label) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label })),
      },
      {
        id: 'valuation_caveat',
        label: 'Caveat',
        options: ['Title not verified by the valuer', 'Measurements taken from documents', 'No structural survey made', 'Market may move after the valuation date', 'Information supplied is relied on'].map((label, i) => ({
          key: ['title_not_verified', 'measurements_from_documents', 'no_structural_survey', 'market_may_move', 'information_relied_on'][i]!,
          label,
        })),
      },
    ],
    sections: [
      { key: 'value', label: 'Value' },
      { key: 'judgement', label: 'Judgement' },
      { key: 'lending', label: 'For the lender', showWhen: { situation: 'valuation_for_lending' } },
      { key: 'insolvency', label: 'For the insolvency process', showWhen: { situation: 'valuation_for_insolvency' } },
      { key: 'qualified', label: 'Assumptions the value rests on', showWhen: { situation: 'title_qualification' } },
      { key: 'more', label: 'Other values', tier: 'expert' },
    ],
    fields: [
      worked('approaches_run', 'Approaches that ran', figure('value.approaches_run'), { section: 'value' }),
      worked('fair_market_value', 'Fair market value', figure('value.fair_market'), { ...INR, section: 'value' }),
      worked('value_low', 'Range, lower end', figure('value.low'), { ...INR, section: 'value' }),
      worked('value_high', 'Range, upper end', figure('value.high'), { ...INR, section: 'value' }),
      worked('rate_per_sqm', 'Value per sqm', figure('value.rate_per_sqm'), { ...PER_SQM, precision: 0, section: 'value' }),
      worked('guideline_value', 'Guidance value', there(at(VAL, V_LAND, 'guideline_value')), { ...INR, section: 'value' }),
      worked('vs_guideline', 'Against guidance value', variance(own('fair_market_value'), own('guideline_value')), { unit: '%', precision: 1, section: 'value' }),
      {
        key: 'outcome',
        label: 'Outcome',
        kind: 'status',
        section: 'value',
        cases: [
          { when: rule('at_least', ['approaches_run'], 'No approach has the inputs it needs.', 'medium', { against: 1 }), label: 'No approach ran', tone: 'neutral' },
          { when: rule('require', ['fair_market_value'], 'The approaches that ran are too far apart to give one figure.', 'high'), label: 'No figure: the approaches disagree', tone: 'critical' },
        ],
        otherwise: { label: 'Indicated', tone: 'good' },
      },
      { key: 'major_factors', label: 'Major factors', kind: 'multi_enum', optionSet: 'valuation_major_factor', section: 'judgement' },
      { key: 'marketability', label: 'Marketability', kind: 'number', control: 'scale', min: 1, max: 5, section: 'judgement', hint: 'From hard to sell to readily sold.' },
      { key: 'caveats', label: 'Caveats', kind: 'multi_enum', optionSet: 'valuation_caveat', section: 'judgement' },
      { key: 'reconciliation_note', label: 'Why the approaches, or the guidance value, differ', kind: 'longtext', maxLength: 400, section: 'judgement', required: false },

      {
        key: 'lender_policy',
        label: 'Realisable and distress shares',
        kind: 'enum',
        control: 'segmented',
        optionSet: 'lender_policy',
        section: 'lending',
        tier: 'situational',
        defaults: [{ value: 'general', from: 'catalog', cite: 'Used until the lender’s own shares are on file' }],
      },
      percent('realisable_share_stated', 'Realisable share the lender states', {
        section: 'lending',
        tier: 'situational',
        max: 100,
        from: 'Sanction letter or the lender’s panel terms',
        proof: 'expected',
        showWhen: { field: at(VAL, V_CONCLUSION, 'lender_policy'), is: 'equals', value: 'lender_stated' },
      }),
      percent('distress_share_stated', 'Distress share the lender states', {
        section: 'lending',
        tier: 'situational',
        max: 100,
        from: 'Sanction letter or the lender’s panel terms',
        proof: 'expected',
        showWhen: { field: at(VAL, V_CONCLUSION, 'lender_policy'), is: 'equals', value: 'lender_stated' },
      }),
      worked(
        'realisable_share',
        'Realisable share',
        when({ field: 'lender_policy', is: 'equals', value: 'lender_stated' }, own('realisable_share_stated'), rate('valuation_realisable_share', { lender: { field: 'lender_policy' } })),
        { unit: '%', section: 'lending', tier: 'situational' },
      ),
      worked('realisable_value', 'Realisable value', pctOf(own('fair_market_value'), own('realisable_share')), { ...INR, section: 'lending', tier: 'situational' }),
      worked(
        'distress_share',
        'Distress share',
        when({ field: 'lender_policy', is: 'equals', value: 'lender_stated' }, own('distress_share_stated'), rate('valuation_distress_share', { lender: { field: 'lender_policy' } })),
        { unit: '%', section: 'lending', tier: 'situational' },
      ),
      worked('distress_value', 'Distress sale value', pctOf(own('fair_market_value'), own('distress_share')), { ...INR, section: 'lending', tier: 'situational' }),
      worked('guideline_gap', 'Distance from guidance value', { op: 'max', of: [own('vs_guideline'), mul(own('vs_guideline'), n(-1))] }, { unit: '%', precision: 1, section: 'lending', tier: 'situational' }),
      worked('guideline_gap_limit', 'Distance allowed before the report says why', rate('valuation_guideline_variance_limit', { lender: { field: 'lender_policy' } }), { unit: '%', section: 'lending', tier: 'situational' }),
      {
        key: 'guideline_standing',
        label: 'Against guidance value',
        kind: 'status',
        section: 'lending',
        tier: 'situational',
        cases: [
          { when: rule('require', ['guideline_gap'], 'There is no value to hold against the guidance value yet.', 'low'), label: 'No value to compare yet', tone: 'neutral' },
          { when: rule('require', ['guideline_gap_limit'], 'No limit is on file for this lender.', 'low'), label: 'No limit on file for this lender', tone: 'neutral' },
          { when: rule('at_most', ['guideline_gap', 'guideline_gap_limit'], 'The value is {a} from the guidance value; past {b} the report says why.', 'medium'), label: 'Past the limit: say why', tone: 'warning' },
        ],
        otherwise: { label: 'Within the limit', tone: 'good' },
      },
      money('liquidation_value', 'Liquidation value', { section: 'insolvency', tier: 'situational', from: 'Valuer' }),
      { key: 'assumptions_made', label: 'Assumptions made', kind: 'multi_enum', optionSet: 'valuation_assumption', section: 'qualified', tier: 'situational' },
      money('value_without_assumption', 'Value without the assumptions', { section: 'qualified', tier: 'situational', from: 'Valuer' }),
      percent('marketability_discount_pct', 'Discount for marketability', { section: 'qualified', tier: 'situational', max: 100, required: false }),
      money('book_value', 'Book value', { section: 'more', ...expert, from: 'Fixed asset register or the balance sheet' }),
    ],
    rules: [
      rule('at_most', ['guideline_gap', 'guideline_gap_limit'], 'The value is {a} from the guidance value; past {b} the report says why.', 'medium', { when: { situation: 'valuation_for_lending' } }),
      rule('at_most', ['distress_value', 'realisable_value'], 'Distress value {a} is above realisable value {b}.', 'high', { when: { situation: 'valuation_for_lending' } }),
      rule('at_most', ['value_without_assumption', 'fair_market_value'], 'The value without the assumptions, {a}, is above the value with them, {b}.', 'medium', { when: { situation: 'title_qualification' } }),
      rule('require', ['assumptions_made'], 'The value rests on an assumption and none is named.', 'high', { when: { situation: 'title_qualification' } }),
      rule('require', ['liquidation_value'], 'The valuation is for insolvency and no liquidation value is given.', 'medium', { when: { situation: 'valuation_for_insolvency' } }),
    ],
  },

  /* --- Valuation register -------------------------------------------- */
  {
    id: V_REPORTS,
    fn: VAL,
    title: 'Valuations on file',
    v: 1,
    records: { of: 'valuation report', titleField: 'reference', summaryFields: ['valued_on', 'fair_market_value'] },
    fields: [
      { key: 'reference', label: 'Report reference', kind: 'text', from: 'Valuation report' },
      { key: 'valued_on', label: 'Valuation date', kind: 'date', from: 'Valuation report' },
      { key: 'valuer', label: 'Valuer', kind: 'ref', target: 'party' },
      { key: 'prepared_for', label: 'Prepared for', kind: 'enum', control: 'segmented', options: ['Lender', 'Internal', 'Insolvency', 'Acquisition'] },
      money('fair_market_value', 'Fair market value', { from: 'Valuation report', proof: 'expected' }),
      money('realisable_value', 'Realisable value', { required: false, from: 'Valuation report' }),
      money('distress_value', 'Distress sale value', { required: false, from: 'Valuation report' }),
      paper('report', 'Report'),
    ],
    rules: [
      rule('at_most', ['realisable_value', 'fair_market_value'], 'Realisable value {a} is above fair market value {b}.', 'medium'),
      rule('at_most', ['distress_value', 'realisable_value'], 'Distress value {a} is above realisable value {b}.', 'medium'),
    ],
  },
  {
    id: V_REGISTER,
    fn: VAL,
    title: 'Valuation register',
    v: 1,
    situations: [FOR_LENDING],
    sections: [
      { key: 'register', label: 'On file' },
      { key: 'revaluation', label: 'Revaluation', showWhen: { situation: 'valuation_for_lending' } },
    ],
    fields: [
      worked('reports_count', 'Valuations on file', countOf(V_REPORTS), { section: 'register' }),
      worked('lowest_on_file', 'Lowest fair market value on file', { op: 'records', set: V_REPORTS, reduce: 'min', field: 'fair_market_value' }, { ...INR, section: 'register' }),
      worked('highest_on_file', 'Highest fair market value on file', { op: 'records', set: V_REPORTS, reduce: 'max', field: 'fair_market_value' }, { ...INR, section: 'register' }),
      worked('spread_on_file', 'Valuers apart by', { op: 'records', set: V_REPORTS, reduce: 'spread_pct', field: 'fair_market_value' }, { unit: '%', precision: 1, section: 'register' }),
      worked('value_now', 'Fair market value worked out here', figure('value.fair_market'), { ...INR, section: 'register' }),
      worked('now_against_file', 'Against the highest on file', variance(own('value_now'), own('highest_on_file')), { unit: '%', precision: 1, section: 'register' }),
      mirror('valuation_date', 'Valuation date', 'date', dates('valuation_date'), { section: 'register' }),
      worked('valuation_age_days', 'Age of the valuation', sub(today, dateAt(dates('valuation_date'))), { unit: 'days', section: 'register' }),
      {
        key: 'register_standing',
        label: 'Valuations on file',
        kind: 'status',
        section: 'register',
        cases: [{ when: rule('compare', ['lowest_on_file', 'highest_on_file'], 'The valuations on file run from {a} to {b}: {divergence} apart.', 'medium', { tolerance: 0.15 }), label: 'Valuers differ', tone: 'warning' }],
        otherwise: { label: 'Valuers agree', tone: 'good' },
      },
      mirror('validity_months', 'Report valid for', 'duration', at(VAL, V_INSTRUCTION, 'validity_months'), { unit: 'months', section: 'revaluation', tier: 'situational' }),
      worked('revaluation_due', 'Revaluation due', { op: 'add_months', date: dateAt(dates('valuation_date')), months: there(at(VAL, V_INSTRUCTION, 'validity_months')) }, { yields: 'date', section: 'revaluation', tier: 'situational' }),
      worked('days_to_revaluation', 'Days until it is due', sub({ op: 'date', key: 'revaluation_due' }, today), { unit: 'days', section: 'revaluation', tier: 'situational' }),
      {
        key: 'revaluation_standing',
        label: 'Revaluation',
        kind: 'status',
        section: 'revaluation',
        tier: 'situational',
        cases: [
          { when: rule('at_least', ['days_to_revaluation'], 'The valuation ran out of date {a} ago.', 'high', { against: 0 }), label: 'Overdue', tone: 'critical' },
          { when: rule('at_least', ['days_to_revaluation'], 'A revaluation is due in {a}.', 'medium', { against: 60 }), label: 'Due soon', tone: 'warning' },
        ],
        otherwise: { label: 'In date', tone: 'good' },
      },
    ],
    rules: [
      rule('compare', ['lowest_on_file', 'highest_on_file'], 'The valuations on file run from {a} to {b}: {divergence} apart, outside {tolerance}.', 'medium', { tolerance: 0.15 }),
      rule('at_least', ['days_to_revaluation'], 'The valuation ran out of date {a} ago.', 'high', { against: 0, when: { situation: 'valuation_for_lending' } }),
    ],
  },
];

/* ==================================================================== */
/* Feasibility                                                           */
/* ==================================================================== */

const revenue = (field: string) => at(FEA, F_REVENUE, field);
const costs = (field: string) => at(FEA, F_COSTS, field);

/** A step of `price` and of `cost` away from the appraisal, as a share: one step down in price is `-1 × step ÷ 100`. */
const stepped = (steps: number): CheckFormula => mul(n(steps), div(own('step_pct'), n(100)));

/**
 * The margin on cost with the selling price and the construction cost each
 * moved a number of steps. Revenue moves with the price, and so does what
 * is spent on marketing, which is a share of it; what is built, and all that
 * is charged on it, moves with the construction cost.
 */
function marginAt(priceSteps: number, costSteps: number): CheckFormula {
  const revenueThen = mul(there(revenue('developer_revenue')), add(n(1), stepped(priceSteps)));
  const costThen = sum(there(costs('total_cost')), mul(there(costs('marketing_cost')), stepped(priceSteps)), mul(there(costs('construction_loaded')), stepped(costSteps)));
  return share(sub(revenueThen, costThen), costThen);
}

const marginField = (key: string, label: string, priceSteps: number, costSteps: number, section: string): CheckFieldDef => worked(key, label, marginAt(priceSteps, costSteps), { unit: '%', precision: 1, section });

const FEASIBILITY: FieldSet[] = [
  /* --- Area statement, as the appraisal reads it --------------------- */
  {
    id: F_AREAS,
    fn: FEA,
    title: 'Areas the appraisal rests on',
    v: 1,
    sections: [
      { key: 'areas', label: 'Areas' },
      { key: 'far', label: 'Floor area ratio' },
      { key: 'rights', label: 'Rights bought', showWhen: { situation: 'tdr_or_premium_far' } },
    ],
    fields: [
      worked('plot_area', 'Plot area', figure('project.land_area'), { ...SQM, section: 'areas' }),
      mirror('proposed_built_up', 'Built-up area proposed', 'area', sanction('proposed_area'), { ...SQM, section: 'areas' }),
      mirror('saleable_area', 'Saleable area', 'area', revenueCheck('saleable_area'), { ...SQM, section: 'areas' }),
      mirror('units_total', 'Units', 'number', absorption('units_total'), { section: 'areas' }),
      worked('saleable_share_pct', 'Saleable as a share of built-up', share(there(revenueCheck('saleable_area')), there(sanction('proposed_area'))), { unit: '%', precision: 1, section: 'areas' }),
      mirror('base_far', 'FAR permissible', 'number', sanction('permissible_far'), { section: 'far' }),
      worked('far_allowed', 'FAR with rights bought', add(there(sanction('permissible_far')), add(orNone(own('premium_far')), orNone(div(own('tdr_area'), own('plot_area'))))), { precision: 2, section: 'far' }),
      worked('max_built_up', 'Built-up area the FAR allows', mul(own('plot_area'), own('far_allowed')), { ...SQM, section: 'far' }),
      worked('far_proposed', 'FAR proposed', div(there(sanction('proposed_area')), own('plot_area')), { precision: 2, section: 'far' }),
      worked('far_used_pct', 'FAR used', share(there(sanction('proposed_area')), own('max_built_up')), { unit: '%', precision: 1, section: 'far' }),
      {
        key: 'area_standing',
        label: 'Areas',
        kind: 'status',
        section: 'far',
        cases: [{ when: rule('at_most', ['far_proposed', 'far_allowed'], 'The scheme uses a FAR of {a} and {b} is allowed.', 'high'), label: 'Over the FAR allowed', tone: 'critical' }],
        otherwise: { label: 'Within the FAR allowed', tone: 'good' },
      },
      { key: 'premium_far', label: 'Premium FAR bought', kind: 'number', precision: 2, min: 0, section: 'rights', tier: 'situational', required: false, from: 'Fee order' },
      money('premium_fee', 'Fee for the premium FAR', { section: 'rights', tier: 'situational', required: false, from: 'Fee order' }),
      { key: 'tdr_area', label: 'Development rights loaded', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'rights', tier: 'situational', required: false, from: 'Development rights certificate' },
      money('tdr_cost', 'Cost of the development rights', { section: 'rights', tier: 'situational', required: false, from: 'Purchase agreement for the rights' }),
      { key: 'rights_certificate_no', label: 'Development rights certificate number', kind: 'text', section: 'rights', tier: 'situational', required: false, from: 'Development rights certificate' },
      { key: 'rights_utilised_on', label: 'Rights utilised on', kind: 'date', section: 'rights', tier: 'situational', required: false },
      paper('rights_paper', 'Certificate or fee order', { section: 'rights', tier: 'situational' }),
      worked('rights_cost', 'Rights bought, in total', add(orNone(own('premium_fee')), orNone(own('tdr_cost'))), { ...INR, section: 'rights', tier: 'situational' }),
    ],
    rules: [
      rule('at_most', ['far_proposed', 'far_allowed'], 'The scheme uses a FAR of {a} and {b} is allowed.', 'high'),
      rule('require_if', ['tdr_area', 'rights_certificate_no'], 'Development rights of {a} are loaded and no certificate number is recorded.', 'medium'),
      rule('require_if', ['premium_far', 'premium_fee'], 'A premium FAR of {a} is bought and its fee is not recorded.', 'medium'),
    ],
  },

  /* --- Revenue assumptions ------------------------------------------- */
  {
    id: F_REVENUE,
    fn: FEA,
    title: 'Revenue',
    v: 1,
    sections: [
      { key: 'price', label: 'Price' },
      { key: 'pace', label: 'Pace of sales' },
      { key: 'joint', label: 'Landowner’s share', showWhen: { situation: 'joint_development' } },
      { key: 'limits', label: 'Limits applied', tier: 'expert' },
      { key: 'more', label: 'Other assumptions', tier: 'expert' },
    ],
    fields: [
      mirror('assumption_dated', 'Assumptions dated', 'date', revenueCheck('assumption_dated'), { section: 'price' }),
      mirror('base_rate', 'Selling rate', 'money', revenueCheck('rate_per_sqm'), { ...PER_SQM, section: 'price' }),
      worked('comparable_rate', 'Adjusted comparable rate', figure('comparables.adjusted_rate'), { ...PER_SQM, precision: 0, section: 'price' }),
      worked('rate_over_comparables', 'Selling rate against the comparables', variance(there(revenueCheck('rate_per_sqm')), own('comparable_rate')), { unit: '%', precision: 1, section: 'price' }),
      mirror('saleable_area', 'Saleable area', 'area', revenueCheck('saleable_area'), { ...SQM, section: 'price' }),
      worked('gdv', 'Gross development value', there(revenueCheck('gross_revenue')), { ...INR, section: 'price' }),
      worked('developer_revenue', 'Developer’s revenue', sub(own('gdv'), orNone(own('owner_share_revenue'))), { ...INR, section: 'price' }),
      { key: 'launch_date', label: 'Launch', kind: 'date', section: 'pace', from: 'Launch plan' },
      mirror('velocity_per_month', 'Sales velocity', 'number', absorption('velocity_per_month'), { unit: 'units/month', section: 'pace' }),
      worked('units_left', 'Units still to sell', sub(there(absorption('units_total')), there(absorption('units_sold'))), { section: 'pace' }),
      worked('sell_out_months', 'Months to sell out', div(own('units_left'), there(absorption('velocity_per_month'))), { unit: 'months', precision: 1, section: 'pace' }),
      {
        key: 'revenue_standing',
        label: 'Revenue',
        kind: 'status',
        section: 'pace',
        cases: [
          { when: rule('require', ['gdv'], 'No revenue is worked out yet.', 'low'), label: 'No revenue worked out yet', tone: 'neutral' },
          { when: rule('at_most', ['rate_over_comparables', 'rate_over_comparables_limit'], 'The selling rate is {a} above the comparables; {b} at most.', 'medium'), label: 'Rate above the comparables', tone: 'warning' },
          { when: rule('at_most', ['assumption_age_days', 'assumption_age_limit'], 'The assumptions are {a} old; {b} at most.', 'medium'), label: 'Assumptions are old', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      percent('owner_share_assumed_pct', 'Landowner’s share assumed', { section: 'joint', tier: 'situational', max: 100, from: 'Joint development agreement', fromTypes: ['Joint development agreement'], factKey: 'owner_share_pct' }),
      { key: 'owner_share_of', label: 'Share is of', kind: 'enum', control: 'segmented', options: ['Area', 'Revenue'], section: 'joint', tier: 'situational', from: 'Joint development agreement' },
      worked('owner_share_revenue', 'Landowner’s share of the value', pctOf(own('gdv'), own('owner_share_assumed_pct')), { ...INR, section: 'joint', tier: 'situational' }),
      worked('assumption_age_days', 'Age of the assumptions', sub(today, dateAt(revenueCheck('assumption_dated'))), { unit: 'days', section: 'limits', tier: 'expert' }),
      worked('assumption_age_limit', 'Age past which they are old', rate('feasibility_assumption_age_days'), { unit: 'days', section: 'limits', tier: 'expert' }),
      worked('rate_over_comparables_limit', 'Most the rate may sit above the comparables', rate('feasibility_rate_over_comparables'), { unit: '%', section: 'limits', tier: 'expert' }),
      percent('escalation_pct', 'Price escalation a year', { section: 'more', ...expert }),
      percent('brokerage_pct', 'Brokerage on sale value', { section: 'more', ...expert, from: 'Channel partner agreements' }),
      { key: 'collection_lag_days', label: 'Collection lag', kind: 'duration', unit: 'days', section: 'more', ...expert, from: 'Sales MIS' },
      percent('cancellation_pct', 'Cancellations', { section: 'more', ...expert, from: 'Sales MIS' }),
    ],
    rules: [
      rule('compare', ['gdv', 'gdv_on_residual'], 'The appraisal works out a value of {a} and the residual uses {b}: {divergence} apart, outside {tolerance}.', 'medium', { at: { gdv_on_residual: residualInput('gdv') } }),
      rule('at_most', ['rate_over_comparables', 'rate_over_comparables_limit'], 'The selling rate is {a} above the comparables; {b} at most.', 'medium'),
      rule('require', ['owner_share_assumed_pct'], 'The land is under joint development and the landowner’s share is not in the appraisal.', 'high', { when: { situation: 'joint_development' } }),
    ],
  },

  /* --- Cost assumptions ---------------------------------------------- */
  {
    id: F_COSTS,
    fn: FEA,
    title: 'Costs',
    v: 1,
    sections: [
      { key: 'land', label: 'Land' },
      { key: 'build', label: 'Construction' },
      { key: 'on_costs', label: 'On top of construction' },
      { key: 'total', label: 'In total' },
      { key: 'conversion', label: 'Conversion', showWhen: { situation: 'agricultural_needs_conversion' } },
      { key: 'debt', label: 'Debt assumed', showWhen: { situation: 'lender_funded' } },
      { key: 'heads', label: 'Construction by head', tier: 'expert' },
      { key: 'working', label: 'Working', tier: 'expert' },
    ],
    fields: [
      money('land_cost', 'Land cost', { section: 'land', from: 'Sale agreement or the joint development agreement', proof: 'expected' }),
      mirror('land_acquisition_pct', 'Acquisition costs on land', 'percent', residualInput('land_acquisition_pct'), { unit: '%', section: 'land' }),
      worked('approval_costs', 'Approval fees and charges', sumOf(F_APPROVAL_COSTS, 'amount'), { ...INR, section: 'land' }),
      mirror('construction_cost', 'Construction cost', 'money', residualInput('construction_cost'), { ...INR, section: 'build' }),
      worked('construction_rate', 'Construction cost per sqm built-up', div(there(residualInput('construction_cost')), there(sanction('proposed_area'))), { ...PER_SQM, precision: 0, section: 'build' }),
      mirror('professional_fees_pct', 'Professional fees', 'percent', residualInput('professional_fees_pct'), { unit: '%', section: 'on_costs' }),
      percent('contingency_pct', 'Contingency', { section: 'on_costs', max: 100, from: 'Cost plan' }),
      percent('gst_cost_pct', 'GST carried as cost', { section: 'on_costs', max: 100, from: 'Tax working' }),
      mirror('marketing_pct', 'Marketing and brokerage', 'percent', residualInput('marketing_pct'), { unit: '%', section: 'on_costs' }),
      worked('finance_charge', 'Finance charge', there(residualInput('resid_finance')), { ...INR, section: 'total' }),
      worked(
        'total_cost',
        'Total development cost',
        sum(
          mul(own('land_cost'), add(n(1), div(orNone(there(residualInput('land_acquisition_pct'))), n(100)))),
          own('approval_costs'),
          own('construction_loaded'),
          own('marketing_cost'),
          orNone(own('finance_charge')),
          orNone(own('conversion_fee')),
          orNone(own('betterment_charges')),
          orNone(there(at(FEA, F_AREAS, 'rights_cost'))),
        ),
        { ...INR, section: 'total' },
      ),
      {
        key: 'cost_standing',
        label: 'Costs',
        kind: 'status',
        section: 'total',
        cases: [
          { when: rule('require', ['land_cost'], 'Land cost is not recorded.', 'medium'), label: 'Land cost not recorded', tone: 'warning' },
          { when: rule('require', ['contingency_pct'], 'No contingency is carried.', 'medium'), label: 'No contingency carried', tone: 'warning' },
          { when: rule('compare', ['total_cost', 'total_on_check'], 'The costs here come to {a} and the appraisal check records {b}: {divergence} apart.', 'medium'), label: 'Differs from the appraisal check', tone: 'warning' },
        ],
        otherwise: { label: 'Worked out', tone: 'good' },
      },
      money('conversion_fee', 'Conversion fee', { section: 'conversion', tier: 'situational', from: 'Conversion order or the demand note' }),
      money('betterment_charges', 'Betterment charges', { section: 'conversion', tier: 'situational', required: false, from: 'Demand note' }),
      { key: 'conversion_months', label: 'Months to convert', kind: 'duration', unit: 'months', section: 'conversion', tier: 'situational', required: false },
      money('debt_assumed', 'Debt assumed', { section: 'debt', tier: 'situational', from: 'Term sheet' }),
      percent('interest_rate_assumed_pct', 'Interest rate assumed', { section: 'debt', tier: 'situational', from: 'Term sheet' }),
      { key: 'moratorium_months', label: 'Moratorium', kind: 'duration', unit: 'months', section: 'debt', tier: 'situational', required: false, from: 'Term sheet' },
      worked('debt_to_cost_pct', 'Debt as a share of cost', share(own('debt_assumed'), own('total_cost')), { unit: '%', precision: 1, section: 'debt', tier: 'situational' }),
      {
        key: 'cost_by_head',
        label: 'Construction by head',
        kind: 'table',
        display: 'chart',
        chart: { x: 'head', y: 'amount', mark: 'bar' },
        section: 'heads',
        ...expert,
        from: 'Cost plan',
        columns: [
          { key: 'head', label: 'Head', kind: 'enum', options: COST_HEADS },
          { key: 'amount', label: 'Amount', kind: 'money', ...INR },
          { key: 'basis', label: 'Basis', kind: 'enum', options: ['Cost plan', 'Priced BOQ', 'Benchmark', 'Estimate'] },
        ],
      },
      worked('heads_total', 'Heads in total', { op: 'sum', table: 'cost_by_head', column: 'amount' }, { ...INR, section: 'heads', tier: 'expert' }),
      percent('admin_pct', 'Administration and overheads, on construction', { section: 'working', ...expert }),
      worked(
        'construction_loaded',
        'Construction with all charged on it',
        mul(there(residualInput('construction_cost')), add(n(1), div(sum(orNone(there(residualInput('professional_fees_pct'))), orNone(own('contingency_pct')), orNone(own('gst_cost_pct')), orNone(own('admin_pct'))), n(100)))),
        { ...INR, section: 'working', tier: 'expert' },
      ),
      worked('marketing_cost', 'Marketing on the value', pctOf(there(revenue('gdv')), there(residualInput('marketing_pct'))), { ...INR, section: 'working', tier: 'expert' }),
      mirror('total_on_check', 'Total cost on the appraisal check', 'money', marginCheck('total_cost'), { ...INR, section: 'working', tier: 'expert' }),
      worked('cost_per_saleable', 'Cost per saleable sqm', div(own('total_cost'), there(revenueCheck('saleable_area'))), { ...PER_SQM, precision: 0, section: 'working', tier: 'expert' }),
    ],
    rules: [
      rule('compare', ['total_cost', 'total_on_check'], 'The costs here come to {a} and the appraisal check records {b}: {divergence} apart, outside {tolerance}.', 'medium'),
      rule('compare', ['heads_total', 'construction_cost'], 'The heads add to {a} and construction cost is {b}: {divergence} apart.', 'medium'),
      rule('compare', ['interest_rate_assumed_pct', 'finance_rate'], 'The debt is assumed at {a} and the residual charges finance at {b}.', 'low', { at: { finance_rate: residualInput('finance_pct') }, when: { situation: 'lender_funded' } }),
      rule('require', ['conversion_fee'], 'The land is to be converted and no conversion fee is in the costs.', 'medium', { when: { situation: 'agricultural_needs_conversion' } }),
    ],
  },
  {
    id: F_APPROVAL_COSTS,
    fn: FEA,
    title: 'Approval fees and charges',
    v: 1,
    records: { of: 'fee', titleField: 'head', summaryFields: ['amount', 'basis'] },
    optionSets: [
      {
        id: 'approval_fee_head',
        label: 'Fee or charge',
        options: ['Plan sanction', 'Betterment', 'Premium FAR', 'Development rights', 'Labour cess', 'Conversion', 'Water and sewerage', 'Electricity', 'Fire', 'Environment', 'RERA registration', 'Other'].map((label) => ({
          key: label.toLowerCase().replace(/\s+/g, '_'),
          label,
        })),
      },
    ],
    fields: [
      { key: 'head', label: 'Fee or charge', kind: 'enum', optionSet: 'approval_fee_head' },
      money('amount', 'Amount', { proof: 'expected', from: 'Demand note or fee order' }),
      { key: 'basis', label: 'Basis', kind: 'enum', control: 'segmented', options: ['Demand note', 'Fee schedule', 'Estimate'] },
      { key: 'authority', label: 'Authority', kind: 'ref', target: 'party', required: false },
      { key: 'approval', label: 'Approval it is for', kind: 'ref', target: 'approval', required: false },
      { key: 'paid_on', label: 'Paid on', kind: 'date', required: false },
      paper('demand_note', 'Demand note or order'),
    ],
    rules: [rule('require_if', ['basis', 'demand_note'], 'The basis is a demand note and none is cited.', 'medium', { whenIn: ['Demand note'] })],
  },

  /* --- Cash flow and returns ----------------------------------------- */
  {
    id: F_PERIODS,
    fn: FEA,
    title: 'Cash flow by month',
    v: 1,
    records: { of: 'month', titleField: 'month', summaryFields: ['collections', 'outflow', 'net'] },
    fields: [
      { key: 'month', label: 'Month', kind: 'date', hint: 'The first day of the month.' },
      { key: 'units_sold', label: 'Units sold', kind: 'number', min: 0, required: false },
      money('collections', 'Collections', { required: false }),
      money('land', 'Land', { required: false }),
      money('approvals', 'Approvals', { required: false }),
      money('construction', 'Construction', { required: false }),
      money('fees_overheads', 'Fees and overheads', { required: false }),
      money('marketing', 'Marketing', { required: false }),
      money('taxes', 'Taxes', { required: false }),
      worked('outflow', 'Paid out', sum(orNone(own('land')), orNone(own('approvals')), orNone(own('construction')), orNone(own('fees_overheads')), orNone(own('marketing')), orNone(own('taxes'))), { ...INR }),
      worked('net', 'Net before finance', sub(orNone(own('collections')), own('outflow')), { ...INR }),
      money('loan_drawn', 'Loan drawn', { tier: 'situational', showWhen: { situation: 'lender_funded' }, required: false }),
      money('interest', 'Interest', { tier: 'situational', showWhen: { situation: 'lender_funded' }, required: false }),
      money('loan_repaid', 'Loan repaid', { tier: 'situational', showWhen: { situation: 'lender_funded' }, required: false }),
      worked('net_to_equity', 'Net to equity', sub(add(own('net'), orNone(own('loan_drawn'))), add(orNone(own('interest')), orNone(own('loan_repaid')))), { ...INR, tier: 'situational', showWhen: { situation: 'lender_funded' } }),
    ],
    rules: [],
  },
  {
    id: F_RETURNS,
    fn: FEA,
    title: 'Cash flow and returns',
    v: 1,
    sections: [
      { key: 'cash', label: 'Cash flow' },
      { key: 'returns', label: 'Returns' },
      { key: 'debt', label: 'With the debt', showWhen: { situation: 'lender_funded' } },
      { key: 'more', label: 'Other measures', tier: 'expert' },
    ],
    fields: [
      worked('months', 'Months in the cash flow', countOf(F_PERIODS), { section: 'cash' }),
      worked('collections_total', 'Collections in total', sumOf(F_PERIODS, 'collections'), { ...INR, section: 'cash' }),
      worked('outflow_total', 'Paid out in total', sumOf(F_PERIODS, 'outflow'), { ...INR, section: 'cash' }),
      worked('peak_funding', 'Peak funding need', figure('cash_flow.peak_funding'), { ...INR, section: 'cash' }),
      worked('peak_month', 'Month of the peak', figure('cash_flow.peak_month'), { yields: 'date', section: 'cash' }),
      money('equity', 'Promoter equity', { section: 'cash', from: 'Funding plan' }),
      worked('funds', 'Equity and debt', add(own('equity'), orNone(there(costs('debt_assumed')))), { ...INR, section: 'cash' }),
      worked('profit', 'Profit before tax', sub(there(revenue('developer_revenue')), there(costs('total_cost'))), { ...INR, section: 'returns' }),
      worked('margin_pct', 'Margin on cost', share(own('profit'), there(costs('total_cost'))), { unit: '%', precision: 1, section: 'returns' }),
      worked('project_irr', 'Project IRR', { op: 'irr', over: { records: F_PERIODS }, date: 'month', amount: 'net' }, { unit: '% a year', precision: 1, section: 'returns' }),
      worked('npv', 'Net present value', { op: 'npv', rate: there(residualInput('discount_rate_pct')), over: { records: F_PERIODS }, date: 'month', amount: 'net' }, { ...INR, section: 'returns' }),
      {
        key: 'returns_standing',
        label: 'Returns',
        kind: 'status',
        section: 'returns',
        cases: [
          { when: rule('at_least', ['funds', 'peak_funding'], 'Equity and debt come to {a} and the cash flow needs {b} at its peak.', 'high'), label: 'Funding short of the peak', tone: 'critical' },
          { when: rule('require', ['margin_pct'], 'No margin is worked out yet.', 'low'), label: 'No margin worked out yet', tone: 'neutral' },
          { when: rule('require', ['hurdle_pct'], 'No hurdle is set to hold the margin against.', 'low'), label: 'No hurdle set', tone: 'neutral' },
          { when: rule('at_least', ['margin_pct', 'hurdle_pct'], 'The margin is {a} and the hurdle is {b}.', 'medium'), label: 'Below the hurdle', tone: 'warning' },
        ],
        otherwise: { label: 'Clears the hurdle', tone: 'good' },
      },
      worked('interest_total', 'Interest during construction', sumOf(F_PERIODS, 'interest'), { ...INR, section: 'debt', tier: 'situational' }),
      worked('equity_irr', 'Equity IRR', { op: 'irr', over: { records: F_PERIODS }, date: 'month', amount: 'net_to_equity' }, { unit: '% a year', precision: 1, section: 'debt', tier: 'situational' }),
      mirror('hurdle_pct', 'Hurdle', 'percent', marginCheck('hurdle_pct'), { unit: '%', section: 'more', tier: 'expert' }),
      mirror('discount_rate_pct', 'Discount rate', 'percent', residualInput('discount_rate_pct'), { unit: '% a year', section: 'more', tier: 'expert' }),
      worked('margin_on_revenue_pct', 'Margin on revenue', share(own('profit'), there(revenue('developer_revenue'))), { unit: '%', precision: 1, section: 'more', tier: 'expert' }),
      worked('breakeven_sales_pct', 'Sales needed to break even', share(there(costs('total_cost')), there(revenue('developer_revenue'))), { unit: '%', precision: 1, section: 'more', tier: 'expert' }),
      worked('payback_month', 'Month the money is back', figure('cash_flow.payback_month'), { yields: 'date', section: 'more', tier: 'expert' }),
    ],
    rules: [
      rule('at_least', ['funds', 'peak_funding'], 'Equity and debt come to {a} and the cash flow needs {b} at its peak.', 'high'),
      rule('at_least', ['margin_pct', 'hurdle_pct'], 'The margin is {a} and the hurdle is {b}.', 'medium'),
      rule('compare', ['collections_total', 'developer_revenue'], 'The months collect {a} and the developer’s revenue is {b}: {divergence} apart.', 'medium', { at: { developer_revenue: revenue('developer_revenue') }, tolerance: 0.02 }),
      rule('compare', ['outflow_total', 'total_cost'], 'The months pay out {a} and the costs come to {b}: {divergence} apart.', 'low', { at: { total_cost: costs('total_cost') }, tolerance: 0.05 }),
    ],
  },

  /* --- Residual, sensitivity and the decision ------------------------ */
  {
    id: F_SENSITIVITY,
    fn: FEA,
    title: 'Sensitivity',
    v: 1,
    sections: [
      { key: 'step', label: 'Step tested' },
      { key: 'price', label: 'Margin if the selling price moves' },
      { key: 'cost', label: 'Margin if construction cost moves' },
      { key: 'breakeven', label: 'Break-even' },
    ],
    fields: [
      percent('step_pct', 'One step', { section: 'step', min: 0, max: 50, defaults: [{ value: 5, from: 'firm' }] }),
      marginField('margin_price_down_2', 'Two steps lower', -2, 0, 'price'),
      marginField('margin_price_down_1', 'One step lower', -1, 0, 'price'),
      marginField('margin_price_up_1', 'One step higher', 1, 0, 'price'),
      marginField('margin_price_up_2', 'Two steps higher', 2, 0, 'price'),
      marginField('margin_cost_down_2', 'Two steps lower', 0, -2, 'cost'),
      marginField('margin_cost_down_1', 'One step lower', 0, -1, 'cost'),
      marginField('margin_cost_up_1', 'One step higher', 0, 1, 'cost'),
      marginField('margin_cost_up_2', 'Two steps higher', 0, 2, 'cost'),
      worked(
        'breakeven_price_fall_pct',
        'Fall in price that leaves no profit',
        share(sub(there(revenue('developer_revenue')), there(costs('total_cost'))), sub(there(revenue('developer_revenue')), there(costs('marketing_cost')))),
        { unit: '%', precision: 1, section: 'breakeven' },
      ),
      worked('breakeven_cost_rise_pct', 'Rise in construction cost that leaves no profit', share(sub(there(revenue('developer_revenue')), there(costs('total_cost'))), there(costs('construction_loaded'))), { unit: '%', precision: 1, section: 'breakeven' }),
      {
        key: 'sensitivity_standing',
        label: 'Sensitivity',
        kind: 'status',
        section: 'breakeven',
        cases: [
          { when: rule('at_least', ['margin_price_down_1'], 'One step down in price leaves a margin of {a}.', 'high', { against: 0 }), label: 'One step down in price loses money', tone: 'critical' },
          { when: rule('at_least', ['margin_cost_up_1'], 'One step up in cost leaves a margin of {a}.', 'high', { against: 0 }), label: 'One step up in cost loses money', tone: 'critical' },
          { when: rule('at_least', ['margin_price_down_2'], 'Two steps down in price leave a margin of {a}.', 'medium', { against: 0 }), label: 'Two steps down in price lose money', tone: 'warning' },
          { when: rule('at_least', ['margin_cost_up_2'], 'Two steps up in cost leave a margin of {a}.', 'medium', { against: 0 }), label: 'Two steps up in cost lose money', tone: 'warning' },
        ],
        otherwise: { label: 'Profit holds across the steps', tone: 'good' },
      },
    ],
    rules: [
      rule('at_least', ['margin_price_down_2'], 'Two steps down in price leave a margin of {a}.', 'medium', { against: 0 }),
      rule('at_least', ['margin_cost_up_2'], 'Two steps up in cost leave a margin of {a}.', 'medium', { against: 0 }),
    ],
  },
  {
    id: F_DECISION,
    fn: FEA,
    title: 'Residual land value and decision',
    v: 1,
    optionSets: [
      {
        id: 'land_decision',
        label: 'Decision',
        options: [
          { key: 'proceed', label: 'Proceed', tone: 'good' },
          { key: 'proceed_with_conditions', label: 'Proceed with conditions', tone: 'info' },
          { key: 'renegotiate', label: 'Renegotiate', tone: 'warning' },
          { key: 'drop', label: 'Drop', tone: 'critical' },
        ],
      },
    ],
    sections: [
      { key: 'residual', label: 'Residual land value' },
      { key: 'decision', label: 'Decision' },
      { key: 'conditions', label: 'Conditions', showWhen: { field: at(FEA, F_DECISION, 'decision'), is: 'equals', value: 'proceed_with_conditions' } },
      { key: 'more', label: 'Note', tier: 'expert' },
    ],
    fields: [
      worked('residual_land_value', 'Residual land value', there(residualInput('resid_land_value')), { ...INR, section: 'residual' }),
      worked('residual_per_sqm', 'Residual per sqm of plot', div(own('residual_land_value'), figure('project.land_area')), { ...PER_SQM, precision: 0, section: 'residual' }),
      mirror('developer_profit_pct', 'Developer’s required profit', 'percent', residualInput('developer_profit_pct'), { unit: '%', section: 'residual' }),
      money('asking_price', 'Asking price', { section: 'residual', from: 'Seller’s offer or the memorandum of understanding', proof: 'expected' }),
      worked('headroom', 'Headroom', sub(own('residual_land_value'), own('asking_price')), { ...INR, section: 'residual' }),
      worked('residual_vs_guideline', 'Residual against guidance value', variance(own('residual_land_value'), there(at(VAL, V_LAND, 'guideline_value'))), { unit: '%', precision: 1, section: 'residual' }),
      worked('residual_vs_comparable', 'Residual against the land value adopted', variance(own('residual_land_value'), there(at(VAL, V_LAND, 'land_value'))), { unit: '%', precision: 1, section: 'residual' }),
      {
        key: 'price_standing',
        label: 'Asking price',
        kind: 'status',
        section: 'residual',
        cases: [
          { when: rule('require', ['residual_land_value'], 'The residual is not worked out yet.', 'low'), label: 'No residual yet', tone: 'neutral' },
          { when: rule('at_most', ['asking_price', 'residual_land_value'], 'The asking price is {a} and the scheme leaves {b} for the land.', 'high'), label: 'Asking price above the residual', tone: 'critical' },
        ],
        otherwise: { label: 'Asking price within the residual', tone: 'good' },
      },
      { key: 'decision', label: 'Decision', kind: 'enum', control: 'tiles', optionSet: 'land_decision', section: 'decision' },
      { key: 'decided_by', label: 'Decided by', kind: 'ref', target: 'party', section: 'decision', from: 'Minutes' },
      { key: 'decided_on', label: 'Decided on', kind: 'date', section: 'decision', from: 'Minutes' },
      paper('minutes', 'Minutes', { section: 'decision' }),
      worked('conditions_set', 'Conditions set', countOf(F_CONDITIONS), { section: 'conditions', tier: 'situational' }),
      worked('conditions_met', 'Conditions met', { op: 'count_if', over: { records: F_CONDITIONS }, where: { column: 'met', is: 'true' } }, { section: 'conditions', tier: 'situational' }),
      {
        key: 'conditions_standing',
        label: 'Conditions',
        kind: 'status',
        section: 'conditions',
        tier: 'situational',
        cases: [
          { when: rule('at_least', ['conditions_set'], 'The decision carries conditions and none is recorded.', 'medium', { against: 1 }), label: 'No condition recorded', tone: 'warning' },
          { when: rule('at_least', ['conditions_met', 'conditions_set'], '{a} of {b} conditions are met.', 'medium'), label: 'Conditions open', tone: 'warning' },
        ],
        otherwise: { label: 'Conditions met', tone: 'good' },
      },
      { key: 'decision_note', label: 'Note on the decision', kind: 'longtext', maxLength: 300, section: 'more', ...expert },
    ],
    rules: [
      rule('at_most', ['asking_price', 'residual_land_value'], 'The asking price is {a} and the scheme leaves {b} for the land.', 'high'),
      rule('require_if', ['decision', 'decided_on'], 'The decision is {a} and the day it was taken is not recorded.', 'low'),
      rule('at_least', ['conditions_met', 'conditions_set'], '{a} of {b} conditions are met.', 'medium'),
    ],
  },
  {
    id: F_CONDITIONS,
    fn: FEA,
    title: 'Conditions of the decision',
    v: 1,
    records: { of: 'condition', titleField: 'condition', summaryFields: ['met', 'met_on'] },
    fields: [
      {
        key: 'condition',
        label: 'Condition',
        kind: 'enum',
        options: ['Title cleared', 'Conversion obtained', 'Plan sanctioned', 'Price renegotiated', 'Funding tied up', 'Joint development agreement signed', 'Access secured', 'Litigation closed'],
      },
      { key: 'met', label: 'Met', kind: 'boolean', control: 'tick' },
      { key: 'met_on', label: 'Met on', kind: 'date', required: false },
      paper('proof', 'Paper that shows it'),
    ],
    rules: [rule('require_if', ['met', 'met_on'], 'The condition is ticked as met and the day is not recorded.', 'low', { whenIn: ['true'] })],
  },
];

/* ==================================================================== */
/* Budget                                                                */
/* ==================================================================== */

const projectCost = statedBySeveral({
  id: 'finance.budget.project_cost_stated',
  fn: BUD,
  title: 'Estimated project cost',
  key: 'project_cost',
  figure: { kind: 'money', ...INR },
  section: 'stated',
  tone: 'warning',
});

const costToComplete = statedBySeveral({
  id: 'finance.budget.cost_to_complete_stated',
  fn: BUD,
  title: 'Cost to complete',
  key: 'ctc',
  figure: { kind: 'money', ...INR },
  section: 'stated',
});

const BUDGET: FieldSet[] = [
  /* --- Approved budget ----------------------------------------------- */
  {
    id: B_APPROVED,
    fn: BUD,
    title: 'Approved budget',
    v: 1,
    optionSets: [
      {
        id: 'budget_basis',
        label: 'Basis of the budget',
        options: [
          { key: 'concept_estimate', label: 'Concept estimate', tone: 'warning' },
          { key: 'elemental_cost_plan', label: 'Elemental cost plan', tone: 'info' },
          { key: 'priced_boq', label: 'Priced BOQ', tone: 'info' },
          { key: 'tender_returns', label: 'Tender returns', tone: 'good' },
          { key: 'awarded_contracts', label: 'Awarded contracts', tone: 'good' },
        ],
      },
    ],
    sections: [
      { key: 'budget', label: 'Budget' },
      { key: 'approval', label: 'Approval' },
      { key: 'heads', label: 'Against the appraisal' },
      { key: 'stated', label: 'As others state the project cost', showWhen: { records: projectCost.set.id, is: 'any' } },
      { key: 'history', label: 'Versions', tier: 'expert' },
    ],
    fields: [
      worked('budget_total', 'Budget in total', figure('cost.budget'), { ...INR, section: 'budget' }),
      worked('packages', 'Work packages', figure('cost.packages'), { section: 'budget' }),
      worked('packages_unbudgeted', 'Packages with no budget', figure('cost.packages_unbudgeted'), { section: 'budget' }),
      worked('cost_per_sqm', 'Budget per sqm built-up', div(own('budget_total'), figure('project.built_up_area')), { ...PER_SQM, precision: 0, section: 'budget' }),
      { key: 'basis', label: 'Basis of the budget', kind: 'enum', control: 'tiles', optionSet: 'budget_basis', section: 'budget', from: 'Cost plan' },
      { key: 'gst_basis', label: 'Budget figures are', kind: 'enum', control: 'segmented', options: ['Excluding GST', 'Including GST'], section: 'budget', from: 'Cost plan' },
      {
        key: 'budget_standing',
        label: 'Budget',
        kind: 'status',
        section: 'budget',
        cases: [
          { when: rule('at_least', ['packages'], 'No work package is on the cost register.', 'low', { against: 1 }), label: 'No work package yet', tone: 'neutral' },
          { when: rule('at_most', ['packages_unbudgeted'], '{a} work packages have no budget.', 'medium', { against: 0 }), label: 'Packages without a budget', tone: 'warning' },
          { when: rule('compare', ['budget_total', 'sanctioned_on_check'], 'The packages add to {a} and the budget check records {b}: {divergence} apart.', 'medium'), label: 'Differs from the budget check', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'budget_version', label: 'Budget version', kind: 'text', section: 'approval', from: 'Approval minute', hint: 'As the approval names it.' },
      { key: 'approved_on', label: 'Approved on', kind: 'date', section: 'approval', from: 'Approval minute' },
      { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party', section: 'approval', from: 'Approval minute' },
      paper('approval_minute', 'Approval minute', { section: 'approval' }),
      {
        key: 'packages_to_heads',
        label: 'Packages against the appraisal’s cost heads',
        kind: 'table',
        display: 'match',
        section: 'heads',
        required: false,
        columns: [
          { key: 'package', label: 'Package', kind: 'ref', target: 'package' },
          { key: 'head', label: 'Head', kind: 'enum', options: COST_HEADS },
        ],
        match: {
          left: { column: 'package', label: 'Packages', of: { target: 'package' } },
          right: { column: 'head', label: 'Appraisal heads', of: { table: costs('cost_by_head'), column: 'head' } },
        },
      },
      ...projectCost.fields,
      worked('budget_against_stated', 'Budget against the highest stated', variance(own('budget_total'), own('project_cost_high')), { unit: '%', precision: 1, section: 'stated', tier: 'situational' }),
      mirror('sanctioned_on_check', 'Sanctioned budget on the budget check', 'money', at(BUD, 'cost_quantity.budget_current', 'sanctioned_budget'), { ...INR, section: 'history', tier: 'expert' }),
      { key: 'price_base_date', label: 'Price base date', kind: 'date', section: 'history', ...expert, from: 'Cost plan' },
      {
        key: 'versions',
        label: 'Budget versions',
        kind: 'table',
        display: 'timeline',
        section: 'history',
        ...expert,
        columns: [
          { key: 'approved_on', label: 'Approved on', kind: 'date' },
          { key: 'version', label: 'Version', kind: 'text' },
          { key: 'total', label: 'Total', kind: 'money', ...INR },
          { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party' },
        ],
      },
    ],
    rules: [
      rule('compare', ['budget_total', 'sanctioned_on_check'], 'The packages add to {a} and the budget check records {b}: {divergence} apart, outside {tolerance}.', 'medium'),
      rule('compare', ['budget_total', 'feasibility_cost'], 'The budget is {a} and the appraisal’s construction with all charged on it is {b}: {divergence} apart.', 'medium', { at: { feasibility_cost: costs('construction_loaded') }, tolerance: 0.05 }),
      rule('at_most', ['budget_total', 'project_cost_low'], 'The budget, {a}, is above the lowest project cost stated, {b}.', 'medium'),
    ],
  },
  projectCost.set,

  /* --- Contingency and escalation ------------------------------------ */
  {
    id: B_CONTINGENCY,
    fn: BUD,
    title: 'Contingency and escalation',
    v: 1,
    sections: [
      { key: 'contingency', label: 'Contingency' },
      { key: 'prices', label: 'Prices' },
      { key: 'limits', label: 'Limits applied', tier: 'expert' },
    ],
    fields: [
      money('contingency_original', 'Contingency in the budget', { section: 'contingency', from: 'Cost plan' }),
      worked('contingency_drawn', 'Drawn from contingency', orNone(figure('cost_report.contingency_drawn')), { ...INR, section: 'contingency' }),
      worked('contingency_left', 'Contingency remaining', sub(own('contingency_original'), own('contingency_drawn')), { ...INR, section: 'contingency' }),
      worked('work_left', 'Work still to certify', sub(figure('cost.forecast'), orNone(figure('cost.certified'))), { ...INR, section: 'contingency' }),
      worked('contingency_left_pct', 'Remaining as a share of the work left', share(own('contingency_left'), own('work_left')), { unit: '%', precision: 1, section: 'contingency' }),
      {
        key: 'contingency_standing',
        label: 'Contingency',
        kind: 'status',
        section: 'contingency',
        cases: [
          { when: rule('require', ['contingency_original'], 'The contingency in the budget is not recorded.', 'low'), label: 'Not recorded', tone: 'neutral' },
          { when: rule('at_least', ['contingency_left'], 'Contingency remaining is {a}.', 'high', { against: 1 }), label: 'Exhausted', tone: 'critical' },
          { when: rule('require', ['contingency_left_pct'], 'There is no forecast to hold the contingency against.', 'low'), label: 'No forecast to hold it against', tone: 'neutral' },
          { when: rule('at_least', ['contingency_left_pct', 'contingency_floor'], 'Contingency is {a} of the work left; {b} at least.', 'medium'), label: 'Thin', tone: 'warning' },
        ],
        otherwise: { label: 'Healthy', tone: 'good' },
      },
      money('escalation_provision', 'Escalation provision in the budget', { section: 'prices', required: false, from: 'Cost plan' }),
      worked('basic_prices', 'Basic price adjustments, latest report', figure('cost_report.basic_prices'), { ...INR, section: 'prices' }),
      worked('contingency_floor', 'Least contingency, as a share of the work left', rate('budget_contingency_floor'), { unit: '%', section: 'limits', tier: 'expert' }),
      mirror('contingency_on_check', 'Contingency on the forecast check', 'money', forecastCheck('contingency_left'), { ...INR, section: 'limits', tier: 'expert' }),
    ],
    rules: [
      rule('at_least', ['contingency_left_pct', 'contingency_floor'], 'Contingency is {a} of the work left; {b} at least.', 'medium'),
      rule('compare', ['contingency_left', 'contingency_on_check'], 'Contingency works out at {a} and the forecast check records {b}: {divergence} apart.', 'medium'),
      rule('at_most', ['basic_prices', 'escalation_provision'], 'Basic price adjustments come to {a} and {b} is provided for escalation.', 'medium'),
    ],
  },
  {
    id: B_TRANSFERS,
    fn: BUD,
    title: 'Transfers between packages',
    v: 1,
    records: { of: 'transfer', titleField: 'reference', summaryFields: ['amount', 'dated'] },
    fields: [
      { key: 'reference', label: 'Reference', kind: 'text', hint: 'As the approval names it.' },
      { key: 'from_package', label: 'From', kind: 'ref', target: 'package' },
      { key: 'to_package', label: 'To', kind: 'ref', target: 'package' },
      money('amount', 'Amount'),
      { key: 'reason', label: 'Reason', kind: 'enum', options: ['Award below budget', 'Award above budget', 'Scope moved', 'Design change', 'Contingency released'] },
      { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party' },
      { key: 'dated', label: 'Dated', kind: 'date' },
      paper('approval', 'Approval'),
    ],
    rules: [],
  },

  /* --- Commitments ---------------------------------------------------- */
  {
    id: B_COMMITMENTS,
    fn: BUD,
    title: 'Commitments',
    v: 1,
    sections: [
      { key: 'committed', label: 'Committed' },
      { key: 'awards', label: 'Awards and variations' },
    ],
    fields: [
      worked('budget_total', 'Budget in total', figure('cost.budget'), { ...INR, section: 'committed' }),
      worked('contracts', 'Contracts', figure('cost.contracts'), { section: 'committed' }),
      worked('committed', 'Committed to date', figure('cost.committed'), { ...INR, section: 'committed' }),
      worked('uncommitted', 'Budget not yet committed', sub(own('budget_total'), own('committed')), { ...INR, section: 'committed' }),
      worked('committed_pct', 'Committed as a share of the budget', share(own('committed'), own('budget_total')), { unit: '%', precision: 1, section: 'committed' }),
      mirror('committed_on_check', 'Committed on the commitments check', 'money', at(BUD, 'cost_quantity.commitments', 'committed'), { ...INR, section: 'committed' }),
      {
        key: 'commitment_standing',
        label: 'Commitments',
        kind: 'status',
        section: 'committed',
        cases: [
          { when: rule('require', ['budget_total'], 'There is no budget to hold the commitments against.', 'low'), label: 'No budget to hold it against', tone: 'neutral' },
          { when: rule('at_most', ['committed', 'budget_total'], 'Committed is {a} against a budget of {b}.', 'high'), label: 'Committed above the budget', tone: 'critical' },
          { when: rule('compare', ['committed', 'committed_on_check'], 'The contracts add to {a} and the commitments check records {b}: {divergence} apart.', 'medium'), label: 'Differs from the commitments check', tone: 'warning' },
        ],
        otherwise: { label: 'Within the budget', tone: 'good' },
      },
      mirror('packages_awarded', 'Packages awarded', 'number', at('procurement.orders', 'procurement.award_completeness', 'packages_awarded'), { section: 'awards' }),
      mirror('contracts_executed', 'Contracts executed', 'number', at('procurement.orders', 'procurement.award_completeness', 'contracts_executed'), { section: 'awards' }),
      worked('variations_on_check', 'Variations on the variations check', there(at(BUD, 'cost_quantity.variations', 'variation_total')), { ...INR, section: 'awards' }),
      worked('committed_with_variations', 'Committed with those variations', add(own('committed'), orNone(own('variations_on_check'))), { ...INR, section: 'awards' }),
    ],
    rules: [
      rule('at_most', ['committed_with_variations', 'budget_total'], 'Committed with variations is {a} against a budget of {b}.', 'high'),
      rule('compare', ['committed', 'committed_on_check'], 'The contracts add to {a} and the commitments check records {b}: {divergence} apart, outside {tolerance}.', 'medium'),
    ],
  },

  /* --- Monthly cost report ------------------------------------------- */
  {
    id: B_REPORT,
    fn: BUD,
    title: 'Monthly cost report',
    v: 1,
    sections: [
      { key: 'latest', label: 'Latest report' },
      { key: 'movement', label: 'What moved' },
      { key: 'work', label: 'Work done', tier: 'expert' },
    ],
    fields: [
      worked('reports', 'Cost reports', figure('cost_report.count'), { section: 'latest' }),
      worked('period_end', 'Period ends', figure('cost_report.period_end'), { yields: 'date', section: 'latest' }),
      worked('report_budget', 'Budget', figure('cost_report.budget'), { ...INR, section: 'latest' }),
      worked('orders_issued', 'Orders issued', figure('cost_report.po_issued'), { ...INR, section: 'latest' }),
      worked('amount_paid', 'Paid', figure('cost_report.amount_paid'), { ...INR, section: 'latest' }),
      worked('anticipated_cost', 'Anticipated cost', figure('cost_report.anticipated'), { ...INR, section: 'latest' }),
      worked('anticipated_variance', 'Anticipated cost against budget', sub(own('anticipated_cost'), own('report_budget')), { ...INR, section: 'latest' }),
      worked('paid_of_issued_pct', 'Paid as a share of orders', share(own('amount_paid'), own('orders_issued')), { unit: '%', precision: 1, section: 'latest' }),
      worked('variations_in_period', 'Variations in the period', figure('cost_report.variations'), { ...INR, section: 'movement' }),
      worked('unexplained', 'Movement nothing explains', figure('cost_report.unexplained'), { ...INR, section: 'movement' }),
      {
        key: 'report_standing',
        label: 'Cost report',
        kind: 'status',
        section: 'movement',
        cases: [
          { when: rule('at_most', ['anticipated_cost', 'report_budget'], 'Anticipated cost is {a} against a budget of {b}.', 'high'), label: 'Anticipated cost above the budget', tone: 'critical' },
          { when: rule('at_most', ['unexplained'], '{a} of movement since the last report has no reason against it.', 'medium', { against: 0 }), label: 'Movement not explained', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      money('work_done_value', 'Value of work done', { section: 'work', ...expert, from: 'Quantity surveyor’s measure' }),
      worked('certified_to_date', 'Certified to date', figure('cost.certified'), { ...INR, section: 'work', tier: 'expert' }),
      {
        key: 'payments_ahead',
        label: 'Payments expected in the coming months',
        kind: 'table',
        section: 'work',
        ...expert,
        columns: [
          { key: 'month', label: 'Month', kind: 'date' },
          { key: 'package', label: 'Package', kind: 'ref', target: 'package' },
          { key: 'amount', label: 'Amount', kind: 'money', ...INR },
        ],
      },
    ],
    rules: [
      rule('at_most', ['anticipated_cost', 'report_budget'], 'Anticipated cost is {a} against a budget of {b}.', 'high'),
      rule('at_most', ['unexplained'], '{a} of movement since the last report has no reason against it.', 'medium', { against: 0 }),
      rule('at_least', ['work_done_value', 'certified_to_date'], 'Work done is valued at {a} and {b} is certified.', 'medium'),
    ],
  },

  /* --- Cost to complete and forecast --------------------------------- */
  {
    id: B_TO_COMPLETE,
    fn: BUD,
    title: 'Cost to complete',
    v: 1,
    situations: [
      { key: 'forecast_over_budget', label: 'Forecast over the budget', scope: 'function', hint: 'The forecast final cost is above the budget.', derive: { field: at(BUD, B_TO_COMPLETE, 'overrun'), is: 'gt', value: 0 } },
    ],
    optionSets: [
      {
        id: 'overrun_funding',
        label: 'Overrun funded by',
        options: [
          { key: 'promoter', label: 'Promoter', tone: 'info' },
          { key: 'standby_facility', label: 'Standby facility', tone: 'info' },
          { key: 'sales_receipts', label: 'Sales receipts', tone: 'warning' },
          { key: 'not_yet_funded', label: 'Not yet funded', tone: 'critical' },
        ],
      },
    ],
    sections: [
      { key: 'forecast', label: 'Forecast' },
      { key: 'budget', label: 'Against the budget' },
      { key: 'overrun', label: 'The overrun', showWhen: { situation: 'forecast_over_budget' } },
      { key: 'progress', label: 'Against progress', showWhen: { field: PROGRESS, is: 'set' } },
      { key: 'stated', label: 'As others state it', showWhen: { records: costToComplete.set.id, is: 'any' } },
      { key: 'limits', label: 'Limits applied', tier: 'expert' },
    ],
    fields: [
      worked('forecast_final_cost', 'Anticipated final cost', figure('cost.forecast'), { ...INR, section: 'forecast' }),
      mirror('forecast_dated', 'Forecast dated', 'date', forecastCheck('forecast_dated'), { section: 'forecast' }),
      worked('certified_to_date', 'Certified to date', orNone(figure('cost.certified')), { ...INR, section: 'forecast' }),
      worked('paid_to_date', 'Paid to date', orNone(figure('cost.paid')), { ...INR, section: 'forecast' }),
      worked('cost_to_complete', 'Cost to complete', sub(own('forecast_final_cost'), own('certified_to_date')), { ...INR, section: 'forecast' }),
      worked('cash_to_complete', 'Cash still to pay', sub(own('forecast_final_cost'), own('paid_to_date')), { ...INR, section: 'forecast' }),
      worked('budget_total', 'Budget in total', figure('cost.budget'), { ...INR, section: 'budget' }),
      worked('overrun', 'Forecast over budget', sub(own('forecast_final_cost'), own('budget_total')), { ...INR, section: 'budget' }),
      worked('contingency_left', 'Contingency remaining', there(at(BUD, B_CONTINGENCY, 'contingency_left')), { ...INR, section: 'budget' }),
      {
        key: 'overrun_standing',
        label: 'Against the budget',
        kind: 'status',
        section: 'budget',
        cases: [
          { when: rule('at_most', ['overrun', 'contingency_left'], 'The forecast is {a} over the budget and {b} of contingency remains.', 'high'), label: 'Over the budget and the contingency', tone: 'critical' },
          { when: rule('at_most', ['overrun'], 'The forecast is {a} over the budget.', 'medium', { against: 0 }), label: 'Over the budget', tone: 'warning' },
        ],
        otherwise: { label: 'Within the budget', tone: 'good' },
      },
      worked('overrun_pct', 'Overrun as a share of the budget', share(own('overrun'), own('budget_total')), { unit: '%', precision: 1, section: 'overrun', tier: 'situational' }),
      {
        key: 'overrun_causes',
        label: 'What the overrun is made of',
        kind: 'table',
        section: 'overrun',
        tier: 'situational',
        columns: [
          { key: 'cause', label: 'Cause', kind: 'enum', options: ['Variations', 'Price rise', 'Quantities', 'Delay', 'Scope added', 'Award above budget'] },
          { key: 'amount', label: 'Amount', kind: 'money', ...INR },
        ],
      },
      worked('overrun_explained', 'Explained by those causes', { op: 'sum', table: 'overrun_causes', column: 'amount' }, { ...INR, section: 'overrun', tier: 'situational' }),
      { key: 'funded_by', label: 'Overrun funded by', kind: 'enum', control: 'tiles', optionSet: 'overrun_funding', section: 'overrun', tier: 'situational' },
      { key: 'revised_budget_approved_on', label: 'Revised budget approved on', kind: 'date', section: 'overrun', tier: 'situational', required: false, from: 'Approval minute' },
      { key: 'lender_told_on', label: 'Lender told on', kind: 'date', section: 'overrun', tier: 'situational', requiredWhen: { situation: 'lender_funded' }, from: 'Letter to the lender' },
      mirror('physical_progress_pct', 'Physical progress', 'percent', PROGRESS, { unit: '%', section: 'progress', tier: 'situational' }),
      worked('cost_progress_pct', 'Cost progress', share(own('certified_to_date'), own('forecast_final_cost')), { unit: '%', precision: 1, section: 'progress', tier: 'situational' }),
      worked(
        'progress_gap',
        'Points between cost and physical progress',
        { op: 'max', of: [sub(own('cost_progress_pct'), there(PROGRESS)), sub(there(PROGRESS), own('cost_progress_pct'))] },
        { unit: 'points', precision: 1, section: 'progress', tier: 'situational' },
      ),
      {
        key: 'progress_standing',
        label: 'Cost against physical progress',
        kind: 'status',
        section: 'progress',
        tier: 'situational',
        cases: [
          { when: rule('require', ['progress_gap'], 'There is no cost progress to hold against physical progress yet.', 'low'), label: 'No cost progress yet', tone: 'neutral' },
          { when: rule('at_most', ['progress_gap', 'progress_gap_limit'], 'Cost and physical progress are {a} apart; {b} at most.', 'medium'), label: 'Cost and progress apart', tone: 'warning' },
        ],
        otherwise: { label: 'Aligned', tone: 'good' },
      },
      ...costToComplete.fields,
      worked('ctc_against_stated', 'Cost to complete against the highest stated', variance(own('cost_to_complete'), own('ctc_high')), { unit: '%', precision: 1, section: 'stated', tier: 'situational' }),
      worked('forecast_age_days', 'Age of the forecast', sub(today, dateAt(forecastCheck('forecast_dated'))), { unit: 'days', section: 'limits', tier: 'expert' }),
      worked('forecast_age_limit', 'Age past which a forecast is old', rate('budget_forecast_age_days'), { unit: 'days', section: 'limits', tier: 'expert' }),
      worked('progress_gap_limit', 'Most points between cost and physical progress', rate('budget_progress_gap_points'), { unit: 'points', section: 'limits', tier: 'expert' }),
      mirror('forecast_on_check', 'Forecast on the forecast check', 'money', forecastCheck('forecast_at_completion'), { ...INR, section: 'limits', tier: 'expert' }),
      mirror('completion_forecast', 'Forecast completion', 'date', at('construction.progress', 'schedule_progress.forecast_completion', 'forecast_completion'), { section: 'limits', tier: 'expert' }),
    ],
    rules: [
      rule('at_most', ['overrun', 'contingency_left'], 'The forecast is {a} over the budget and {b} of contingency remains.', 'high'),
      rule('compare', ['forecast_final_cost', 'forecast_on_check'], 'The cost register forecasts {a} and the forecast check records {b}: {divergence} apart, outside {tolerance}.', 'medium'),
      rule('at_most', ['forecast_age_days', 'forecast_age_limit'], 'The forecast is {a} old; {b} at most.', 'medium'),
      rule('at_most', ['progress_gap', 'progress_gap_limit'], 'Cost and physical progress are {a} apart; {b} at most.', 'medium'),
      rule('compare', ['cost_to_complete', 'ctc_high'], 'Cost to complete works out at {a} and the highest stated is {b}: {divergence} apart, outside {tolerance}.', 'medium', { tolerance: 0.05 }),
      rule('compare', ['overrun_explained', 'overrun'], 'The causes add to {a} and the overrun is {b}: {divergence} apart.', 'medium', { when: { situation: 'forecast_over_budget' }, tolerance: 0.05 }),
      rule('require', ['funded_by'], 'The forecast is over the budget and how the overrun is funded is not said.', 'high', { when: { situation: 'forecast_over_budget' } }),
    ],
  },
  costToComplete.set,
];

/* ==================================================================== */
/* What Valuation, Feasibility and Budget read from other departments    */
/* ==================================================================== */

const VARIATIONS = 'procurement.orders.variations';
const ORDERS = (field: string) => at('procurement.orders', 'procurement.orders.position', field);
const WITH_LENDER = { situation: 'lender_funded' } as const;
const ANY_VARIATION = { records: VARIATIONS, is: 'any' } as const;

const LINKS: SetLinks[] = [
  {
    set: V_LAND,
    // Title's own standing and the advocate's verdict, beside the land they are an assumption about; and the head lease, where the land is leased.
    fields: [
      mirror('title_standing', 'Title, as Legal finds it', 'text', at('legal.title', 'legal.title.opinion', 'title_standing'), { section: 'land', tier: 'situational', showWhen: { field: at('legal.title', 'legal.title.opinion', 'verdict'), is: 'set' } }),
      { key: 'title_verdict', label: 'Advocate’s verdict on title', kind: 'enum', optionSet: 'title_verdict', sameAs: at('legal.title', 'legal.title.opinion', 'verdict'), required: false, section: 'land', tier: 'situational', showWhen: { field: at('legal.title', 'legal.title.opinion', 'verdict'), is: 'set' } },
      { key: 'head_lease_ends', label: 'Head lease ends', kind: 'date', sameAs: at('legal.contracts', 'legal.contracts.land', 'lease_end'), required: false, section: 'interest', tier: 'situational', showWhen: { situation: 'leasehold_land' } },
      mirror('ground_rent', 'Ground rent, a year', 'money', at('legal.contracts', 'legal.contracts.land', 'ground_rent'), { ...INR, section: 'interest', tier: 'situational', showWhen: { situation: 'leasehold_land' } }),
    ],
  },
  {
    set: V_REGISTER,
    // What is owed against the security is Lenders' figure. The cover a lender looks at is worked out from it.
    fields: [
      mirror('loan_outstanding', 'Loan outstanding, per Lenders', 'money', at('finance.lenders', 'finance.lenders.position', 'outstanding'), { ...INR, section: 'revaluation', tier: 'situational', showWhen: WITH_LENDER }),
      worked('loan_to_value_pct', 'Loan to value', { op: 'multiply', left: { op: 'divide', left: there(at('finance.lenders', 'finance.lenders.position', 'outstanding')), right: own('value_now') }, right: { op: 'const', value: 100 } }, { unit: '%', precision: 1, section: 'revaluation', tier: 'situational', showWhen: WITH_LENDER }),
      { key: 'lender_revalues_every', label: 'Lender revalues every', kind: 'duration', unit: 'months', sameAs: at('finance.lenders', 'finance.lenders.security', 'revaluation_every'), required: false, section: 'revaluation', tier: 'situational', showWhen: WITH_LENDER },
    ],
    rules: [rule('at_most', ['validity_months', 'lender_revalues_every'], 'The report is valid for {a} months and the lender revalues every {b}.', 'medium', { when: WITH_LENDER })],
  },
  {
    set: F_REVENUE,
    rules: [
      // The landowner's share is the agreement's, which Legal holds.
      rule('compare', ['owner_share_assumed_pct', 'owner_share_agreed'], 'The appraisal gives the landowner {a} and the joint development agreement {b}.', 'high', { at: { owner_share_agreed: at('legal.contracts', 'legal.contracts.jda', 'owner_share') }, tolerance: 0.001, when: { situation: 'joint_development' } }),
      // No sale before registration: the launch the appraisal assumes is held to the day Legal records.
      rule('before', ['registered_on', 'launch_date'], 'The appraisal launches on {b}, before the RERA registration of {a}.', 'high', { at: { registered_on: at('legal.rera', 'legal.rera.registration', 'registered_on') } }),
    ],
  },
  {
    set: F_COSTS,
    fields: [
      mirror('duty_worked_out', 'Stamp duty and fees on the land, per Tax', 'money', at('finance.tax', 'finance.tax.duty', 'worked_out'), { ...INR, section: 'land', tier: 'situational', showWhen: { records: 'finance.tax.instruments', is: 'any' } }),
      mirror('fees_demanded', 'Approval fees demanded, per Liaison', 'money', at('legal.approvals', 'legal.approvals.register', 'fees_demanded'), { ...INR, section: 'land', tier: 'situational', showWhen: { records: 'shared.approvals', is: 'any', where: { column: 'fees_total', is: 'gt', value: 0 } } }),
      mirror('debt_sanctioned', 'Debt sanctioned, per Lenders', 'money', at('finance.lenders', 'finance.lenders.drawdown', 'sanctioned'), { ...INR, section: 'debt', tier: 'situational' }),
    ],
    rules: [
      rule('at_least', ['approval_costs', 'fees_demanded'], 'The appraisal carries {a} of approval fees and the authorities have demanded {b}.', 'medium'),
      rule('compare', ['debt_assumed', 'debt_sanctioned'], 'The appraisal assumes {a} of debt and the lender has sanctioned {b}.', 'medium', { tolerance: 0.05, when: WITH_LENDER }),
    ],
  },
  {
    set: B_COMMITMENTS,
    // Variations are Procurement's records. Where it keeps any, their approved total is read from there; the variations check stands in until then.
    replace: [
      worked(
        'variations_on_check',
        'Variations approved',
        { op: 'if', when: { left: { op: 'records', set: VARIATIONS, reduce: 'count' }, is: 'gt', right: { op: 'const', value: 0 } }, then: there(ORDERS('variations_approved')), else: there(at(BUD, 'cost_quantity.variations', 'variation_total')) },
        { ...INR, section: 'awards' },
      ),
    ],
  },
  {
    set: B_TO_COMPLETE,
    fields: [
      mirror('variations_pending', 'Variations pending, per Procurement', 'money', ORDERS('variations_pending'), { ...INR, section: 'forecast', tier: 'situational', showWhen: ANY_VARIATION }),
      mirror('built_unapproved', 'Built and not approved, per Procurement', 'money', ORDERS('built_unapproved'), { ...INR, section: 'forecast', tier: 'situational', showWhen: ANY_VARIATION }),
      mirror('undrawn_loan', 'Loan not yet drawn, per Lenders', 'money', at('finance.lenders', 'finance.lenders.drawdown', 'undrawn'), { ...INR, section: 'forecast', tier: 'situational', showWhen: WITH_LENDER }),
    ],
  },
];

export const VALUATION_FEASIBILITY_BUDGET_FIELD_SETS: FieldSet[] = withLinks([...VALUATION, ...FEASIBILITY, ...BUDGET], LINKS);
