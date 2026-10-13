/**
 * Procurement's fields: the plan for each package, how its bids were judged,
 * the contract and its terms, variations and time claims, guarantees and
 * insurance, and the vendor behind each of them.
 *
 * The tender tracker and the cost register are modules of their own: a
 * package's budget, its estimate, its bids and its letter of acceptance are
 * read from them as figures and never entered here.
 *
 * A contract is the shared contract record with Procurement's facts added
 * to it; its commercial terms and where it stands are a record of their own
 * beside it. A variation and a time claim are records, each linked to its
 * contract, and a variation that carries a time claim links to that claim.
 * What a claim does to a contract is worked out on the contract: the days
 * granted move its completion date, and every guarantee that no longer
 * outlasts that date says so.
 */

import type { FieldSet } from '../../types';
import {
  BOQ,
  CONTRACTS,
  DELIVERIES,
  ORDERS,
  PARTIES,
  PROGRESS,
  SET,
  VENDORS,
  add,
  at,
  choices,
  computed,
  computedDay,
  computedMoney,
  countOf,
  countWhere,
  date,
  day,
  dayFrom,
  dayVia,
  div,
  equals,
  f,
  figure,
  flag,
  from,
  isSet,
  money,
  mul,
  n,
  oneOf,
  openness,
  own,
  paper,
  party,
  pct,
  rate,
  sub,
  sumOf,
  sumWhere,
  text,
  today,
  via,
  when,
} from './parts';

const CONTRACT = (field: string) => at('shared', CONTRACTS, field);
const CLAIM = (field: string) => at(ORDERS, SET.timeClaims, field);
const PACKAGE = { key: 'package', label: 'Package', kind: 'ref', target: 'package' } as const;
const CONTRACT_LINK = { key: 'contract', label: 'Contract', kind: 'ref', target: 'contract' } as const;

/** A head of a claim as a figure, nought where it is not stated, so the heads that are stated can be added up. */
const orNought = (key: string) => ({ op: 'max' as const, of: [f(key), n(0)] });

const SINGLE_SOURCE = ['negotiated', 'nominated', 'direct_purchase'];
const VARIATION_STANDS = ['approved', 'paid'];
const VARIATION_PENDING = ['notified', 'claimed', 'assessed', 'disputed'];

/* ==================================================================== */
/* Tenders: the plan, each package, how its bids were judged             */
/* ==================================================================== */

const BOQ_SETS: FieldSet[] = [
  {
    id: SET.plan,
    fn: BOQ,
    title: 'Procurement plan',
    v: 1,
    optionSets: [
      {
        id: 'package_trade',
        label: 'Trade',
        options: choices([
          'Piling', 'Civil and structure', 'Waterproofing', 'Blockwork and plaster', 'Flooring', 'Doors and windows', 'Façade', 'Painting', 'Electrical', 'Plumbing', 'Fire fighting', 'Air conditioning',
          'Lifts', 'Sewage treatment', 'Generator and transformer', 'Landscape', 'External works', 'Interiors', 'Signage', 'Consultancy',
        ]),
      },
      { id: 'security_instrument', label: 'Instrument', options: choices(['Bank guarantee', 'Fixed deposit', 'Demand draft', 'Cash retention', 'Insurance surety bond', 'Online transfer']) },
    ],
    fields: [
      computed('packages', 'Work packages', figure('cost.packages'), { precision: 0, from: 'Cost register' }),
      computed('plans', 'Packages planned', countOf(SET.packagePlans), { precision: 0 }),
      computed('tenders', 'Tenders begun', figure('tenders.count'), { precision: 0, from: 'Tenders' }),
      computed('packages_awarded', 'Packages awarded', figure('tenders.awarded'), { precision: 0, from: 'Tenders' }),
      computed('contracts_signed', 'Tenders with the contract signed', figure('tenders.contract_signed'), { precision: 0, from: 'Tenders' }),
      computed('stages_late', 'Tender stages past their date', figure('tenders.stages_late'), { precision: 0, from: 'Tenders' }),
      computed('awards_late', 'Awards late against need', sumOf(SET.packagePlans, 'late'), { precision: 0 }),
      { key: 'tender_weeks', label: 'Weeks a tender takes', kind: 'duration', unit: 'weeks', min: 0, defaults: [{ value: 6, from: 'firm' }] },
    ],
    rules: [
      { kind: 'at_most', fields: ['stages_late'], against: 0, say: '{a} tender stages are past their date.', severity: 'medium' },
      { kind: 'at_least', fields: ['plans', 'packages'], say: '{a} of {b} work packages have a plan.', severity: 'low' },
      { kind: 'compare', fields: ['packages_awarded', 'on_check'], at: { on_check: at(ORDERS, 'procurement.award_completeness', 'packages_awarded') }, tolerance: 0, say: 'The tenders show {a} packages awarded and the Award check records {b}.', severity: 'low' },
    ],
  },
  {
    id: SET.packagePlans,
    fn: BOQ,
    title: 'Package plans',
    v: 1,
    records: { of: 'package plan', titleField: 'package', summaryFields: ['route', 'award_by', 'standing'] },
    optionSets: [
      {
        id: 'procurement_route',
        label: 'Route',
        options: [
          { key: 'open_tender', label: 'Open tender', tone: 'good' },
          { key: 'limited_tender', label: 'Limited tender', tone: 'good' },
          { key: 'rate_contract', label: 'Rate contract', tone: 'neutral' },
          { key: 'negotiated', label: 'Negotiated', tone: 'warning' },
          { key: 'nominated', label: 'Nominated', tone: 'warning' },
          { key: 'direct_purchase', label: 'Direct purchase', tone: 'warning' },
        ],
      },
    ],
    sections: [
      { key: 'package', label: 'Package' },
      { key: 'money', label: 'Money' },
      { key: 'dates', label: 'Dates' },
    ],
    fields: [
      { ...PACKAGE, section: 'package' },
      { key: 'trade', label: 'Trade', kind: 'enum', optionSet: 'package_trade', section: 'package' },
      { key: 'route', label: 'Route', kind: 'enum', control: 'tiles', optionSet: 'procurement_route', section: 'package' },
      {
        key: 'single_source_reason',
        label: 'Why one source',
        kind: 'enum',
        section: 'package',
        tier: 'situational',
        showWhen: { field: at(BOQ, SET.packagePlans, 'route'), is: 'in', value: SINGLE_SOURCE },
        options: ['proprietary item', 'continuity of work', 'only vendor approved', 'urgency', 'owner’s nomination'],
      },
      { key: 'contract_form', label: 'Form of contract', kind: 'enum', section: 'package', options: ['item rate', 'lump sum', 'design and build', 'labour only', 'supply only', 'supply and install', 'cost plus'] },
      party('owner', 'Package owner', { section: 'package', required: false }),
      paper('boq', 'Bill of quantities', { section: 'package' }),
      computedMoney('budget', 'Budget', figure('package.budget', 'package'), { section: 'money', from: 'Cost register' }),
      computedMoney('estimate', 'Pre-tender estimate', figure('package.estimate', 'package'), { section: 'money', from: 'Tenders' }),
      { key: 'lead_weeks', label: 'Weeks from award to start on site', kind: 'duration', unit: 'weeks', min: 0, section: 'dates', from: 'Procurement plan' },
      computedDay('needed_on_site', 'Needed on site by', figure('package.need_day', 'package'), { section: 'dates', from: 'Schedule' }),
      computedDay('award_by', 'Award needed by', { op: 'add_days', date: day('needed_on_site'), days: mul(f('lead_weeks'), n(-7)) }, { section: 'dates' }),
      computedDay('tender_by', 'Tender to go out by', { op: 'add_days', date: day('award_by'), days: mul(from(at(BOQ, SET.plan, 'tender_weeks')), n(-7)) }, { section: 'dates' }),
      computedDay('awarded_on', 'Letter of acceptance dated', figure('package.award_day', 'package'), { section: 'dates', from: 'Tenders' }),
      computed('late', 'Not awarded and past the day', when(isSet('awarded_on'), n(0), when({ left: today, is: 'gt', right: day('award_by') }, n(1), n(0))), { section: 'dates', precision: 0, tier: 'expert' }),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        section: 'dates',
        cases: [
          { when: { kind: 'at_most', fields: ['late'], against: 0, say: 'This package is not awarded and the day its award was needed has passed.', severity: 'high' }, label: 'Award late against need', tone: 'critical' },
          { when: { kind: 'before', fields: ['awarded_on', 'award_by'], say: 'Awarded on {a}, after the {b} it was needed by.', severity: 'medium' }, label: 'Awarded after it was needed', tone: 'warning' },
          { when: { kind: 'require', fields: ['awarded_on'], say: 'This package is not awarded yet.', severity: 'low' }, label: 'To be awarded', tone: 'info' },
        ],
        otherwise: { label: 'Awarded in time', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'at_most', fields: ['estimate', 'budget'], say: 'The pre-tender estimate is {a}, above the budget of {b}.', severity: 'medium' },
      { kind: 'before', fields: ['awarded_on', 'award_by'], say: 'The letter of acceptance is dated {a}, after the {b} the award was needed by.', severity: 'medium' },
    ],
  },
  {
    id: SET.evaluations,
    fn: BOQ,
    title: 'Bid evaluations',
    v: 1,
    records: { of: 'evaluation', titleField: 'package', summaryFields: ['bids', 'lowest_bid', 'awarded_value'] },
    sections: [
      { key: 'bids', label: 'Bids' },
      { key: 'judged', label: 'How they were judged' },
      { key: 'award', label: 'Award' },
      { key: 'note', label: 'Note', tier: 'expert' },
    ],
    fields: [
      { ...PACKAGE, section: 'bids' },
      computed('bids', 'Bids priced', figure('package.bids', 'package'), { section: 'bids', precision: 0, from: 'Tenders' }),
      computedMoney('lowest_bid', 'Lowest bid', figure('package.lowest_bid', 'package'), { section: 'bids', from: 'Tenders' }),
      {
        key: 'normalisation',
        label: 'Adjustments to a common basis',
        kind: 'table',
        section: 'judged',
        required: false,
        columns: [
          { key: 'bidder', label: 'Bidder', kind: 'ref', target: 'party' },
          { key: 'item', label: 'For', kind: 'enum', options: ['excluded scope priced', 'tax basis', 'free-issue material', 'payment terms', 'escalation', 'arithmetic correction'] },
          { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR' },
        ],
      },
      {
        key: 'technical',
        label: 'Technical scores',
        kind: 'table',
        section: 'judged',
        required: false,
        columns: [
          { key: 'bidder', label: 'Bidder', kind: 'ref', target: 'party' },
          { key: 'criterion', label: 'Criterion', kind: 'enum', options: ['similar work', 'turnover', 'key staff', 'plant', 'method', 'safety record', 'quality system', 'workload in hand'] },
          { key: 'weight', label: 'Weight', kind: 'number', min: 0, max: 100 },
          { key: 'score', label: 'Score out of five', kind: 'number', min: 0, max: 5 },
        ],
      },
      computed('technical_weights', 'Weights given, in total', { op: 'sum', table: 'technical', column: 'weight' }, { section: 'judged', precision: 0, tier: 'expert' }),
      {
        key: 'negotiation',
        label: 'Negotiation rounds',
        kind: 'table',
        display: 'timeline',
        section: 'judged',
        required: false,
        from: 'Minutes of negotiation',
        columns: [
          { key: 'on', label: 'Date', kind: 'date' },
          { key: 'bidder', label: 'Bidder', kind: 'ref', target: 'party' },
          { key: 'revised_amount', label: 'Revised to', kind: 'money', currency: 'INR' },
        ],
      },
      computedMoney('awarded_value', 'Awarded for', figure('package.award_value', 'package'), { section: 'award', from: 'Tenders' }),
      computedMoney('above_lowest', 'Above the lowest bid', sub(f('awarded_value'), f('lowest_bid')), { section: 'award' }),
      { key: 'reasons', label: 'Reasons for the recommendation', kind: 'multi_enum', section: 'award', options: ['lowest after adjustment', 'best technical score', 'shortest time', 'only compliant bid', 'incumbent on site'] },
      {
        key: 'not_lowest_reason',
        label: 'Why not the lowest',
        kind: 'enum',
        section: 'award',
        tier: 'situational',
        showWhen: { field: at(BOQ, SET.evaluations, 'above_lowest'), is: 'gt', value: 0 },
        options: ['lowest bid not compliant', 'lowest bid withdrawn', 'better technical score', 'shorter time', 'lower after adjustment'],
      },
      party('approver', 'Approved by', { section: 'award' }),
      { key: 'note', label: 'Evaluator’s note', kind: 'longtext', maxLength: 400, section: 'note', required: false },
    ],
    rules: [
      { kind: 'compare', fields: ['technical_weights'], against: 100, tolerance: 0, say: 'The technical weights come to {a}, not {b}.', severity: 'low' },
      { kind: 'at_least', fields: ['bids'], against: 3, say: 'Only {a} bids are priced, fewer than {b}.', severity: 'medium' },
    ],
  },
  {
    id: SET.earnestMoney,
    fn: BOQ,
    title: 'Earnest money',
    v: 1,
    records: { of: 'deposit', titleField: 'bidder', summaryFields: ['amount', 'valid_to', 'standing'] },
    fields: [
      party('bidder', 'Bidder', { fromTypes: ['Bid'] }),
      { ...PACKAGE },
      money('amount', 'Amount', { from: 'Bid cover', fromTypes: ['Bid'], factKey: 'earnest_money_amount' }),
      { key: 'instrument', label: 'Instrument', kind: 'enum', optionSet: 'security_instrument', from: 'Bid cover' },
      text('reference', 'Instrument number', { required: false, from: 'Bid cover', fromTypes: ['Bid'], factKey: 'earnest_money_instrument_number' }),
      date('valid_to', 'Valid until', { from: 'Bid cover', fromTypes: ['Bid'], factKey: 'earnest_money_valid_until' }),
      date('returned_on', 'Returned on', { required: false }),
      ...openness({ done: 'returned_on', due: 'valid_to', labels: { open: 'Held', overdue: 'Held past its validity', closed: 'Returned' }, say: 'This deposit is held past the day it was valid until.' }),
    ],
    rules: [],
  },
  {
    id: SET.addenda,
    fn: BOQ,
    title: 'Addenda',
    v: 1,
    records: { of: 'addendum', titleField: 'addendum_no', summaryFields: ['package', 'issued_on'] },
    fields: [
      text('addendum_no', 'Addendum', { from: 'Addendum' }),
      { ...PACKAGE },
      date('issued_on', 'Issued on', { from: 'Addendum' }),
      { key: 'sent_to_all', label: 'Sent to every bidder', kind: 'boolean', control: 'tick' },
      { key: 'what_changed', label: 'What changed', kind: 'longtext', maxLength: 200, required: false },
      paper('file', 'Addendum'),
    ],
    rules: [{ kind: 'require_if', fields: ['issued_on', 'file'], say: 'Issued on {a} with no copy of it on file.', severity: 'low' }],
  },
];

/* ==================================================================== */
/* Orders: contracts, their terms, variations and time claims            */
/* ==================================================================== */

const ORDERS_SETS: FieldSet[] = [
  {
    id: SET.position,
    fn: ORDERS,
    title: 'Contracts and claims',
    v: 1,
    sections: [
      { key: 'contracts', label: 'Contracts' },
      { key: 'variations', label: 'Variations' },
      { key: 'time', label: 'Time' },
    ],
    fields: [
      computed('contracts', 'Contracts', countOf(CONTRACTS), { section: 'contracts', precision: 0 }),
      computed('contracts_signed', 'Signed', countWhere(CONTRACTS, { column: 'signed_on', is: 'set' }), { section: 'contracts', precision: 0 }),
      {
        key: 'package_cover',
        label: 'Packages to contracts',
        kind: 'table',
        display: 'match',
        section: 'contracts',
        required: false,
        columns: [
          { key: 'package', label: 'Package', kind: 'ref', target: 'package' },
          { key: 'contract', label: 'Contract', kind: 'ref', target: 'contract' },
        ],
        match: { left: { column: 'package', label: 'Packages with no contract', of: { target: 'package' } }, right: { column: 'contract', label: 'Contracts covering no package', of: { target: 'contract' } } },
      },
      computed('variations', 'Variations', countOf(SET.variations), { section: 'variations', precision: 0 }),
      computedMoney('variations_approved', 'Approved', sumOf(SET.variations, 'approved_value'), { section: 'variations' }),
      computedMoney('variations_pending', 'Pending', sumOf(SET.variations, 'pending_value'), { section: 'variations' }),
      computedMoney('built_unapproved', 'Built and not approved', sumOf(SET.variations, 'built_unapproved'), { section: 'variations' }),
      computed('time_claims', 'Time claims', countOf(SET.timeClaims), { section: 'time', precision: 0 }),
      computed('days_claimed', 'Days claimed', sumOf(SET.timeClaims, 'days_claimed'), { section: 'time', unit: 'days', precision: 0 }),
      computed('days_granted', 'Days granted', sumOf(SET.timeClaims, 'days_granted'), { section: 'time', unit: 'days', precision: 0 }),
      computed('notices_late', 'Claims notified out of time', countWhere(SET.timeClaims, { column: 'notice', is: 'equals', value: 'Notice out of time' }), { section: 'time', precision: 0 }),
    ],
    rules: [
      { kind: 'at_least', fields: ['contracts_signed', 'contracts'], say: '{a} of {b} contracts are signed.', severity: 'medium' },
      { kind: 'compare', fields: ['contracts_signed', 'on_check'], at: { on_check: at(ORDERS, 'procurement.award_completeness', 'contracts_executed') }, tolerance: 0, say: '{a} contracts are recorded as signed and the Award check records {b} executed.', severity: 'low' },
    ],
  },
  {
    id: SET.contract,
    fn: ORDERS,
    title: 'Contract particulars',
    v: 1,
    extends: CONTRACTS,
    optionSets: [
      {
        id: 'contract_conditions',
        label: 'Conditions of contract',
        options: [
          { key: 'cpwd_gcc', label: 'CPWD general conditions' },
          { key: 'fidic_red', label: 'FIDIC Red Book' },
          { key: 'fidic_yellow', label: 'FIDIC Yellow Book' },
          { key: 'company_standard', label: 'Company standard' },
          { key: 'work_order_terms', label: 'Work order terms' },
        ],
      },
    ],
    fields: [
      text('reference', 'Contract or work order number', { from: 'Contract', fromTypes: ['Work order'], factKey: 'contract_number' }),
      { key: 'conditions', label: 'Conditions of contract', kind: 'enum', optionSet: 'contract_conditions', from: 'Contract' },
      computedMoney('value', 'Contract value', figure('package.contract_value', 'package'), { from: 'Cost register' }),
      date('start_on', 'Commencement date', { from: 'Contract', fromTypes: ['Work order'], factKey: 'commencement_date' }),
      date('completion_on', 'Completion date', { from: 'Contract', fromTypes: ['Work order'], factKey: 'completion_date' }),
      { key: 'notice_days', label: 'Days in which a claim is to be notified', kind: 'duration', unit: 'days', min: 0, required: false, from: 'Contract' },
      computed('notice_period', 'Notice period applied to claims', when(isSet('notice_days'), f('notice_days'), rate('claim_notice_days', { conditions: 'conditions' })), { unit: 'days', precision: 0 }),
      computed('performance_usual_pct', 'Performance security its conditions usually ask', rate('performance_security_pct', { conditions: 'conditions' }), { unit: '%', precision: 2, tier: 'expert' }),
      computed('days_granted', 'Days of extension granted', sumWhere(SET.timeClaims, 'days_granted', own('contract')), { unit: 'days', precision: 0 }),
      computedDay('revised_completion', 'Completion date after extensions', { op: 'add_days', date: day('completion_on'), days: f('days_granted') }),
      computedMoney('variations_approved', 'Variations approved', sumWhere(SET.variations, 'approved_value', own('contract'))),
      date('completed_on', 'Completion certified on', { required: false, from: 'Completion certificate' }),
      { key: 'defects_months', label: 'Defect liability period', kind: 'duration', unit: 'months', min: 0, from: 'Contract', fromTypes: ['Work order'], factKey: 'defect_liability_months' },
      computedDay('defects_end', 'Defect liability ends', { op: 'add_months', date: day('completed_on'), months: f('defects_months') }),
    ],
    rules: [{ kind: 'before', fields: ['start_on', 'completion_on'], say: 'The contract commences on {a} and completes on {b}: the start is after the end.', severity: 'medium' }],
  },
  {
    id: SET.terms,
    fn: ORDERS,
    title: 'Contract terms and position',
    v: 1,
    records: { of: 'contract’s terms', titleField: 'contract', summaryFields: ['revised_value', 'position'] },
    optionSets: [
      {
        id: 'insurance_kind',
        label: 'Insurance',
        options: choices(['Contractor’s all risk', 'Workmen’s compensation', 'Third party liability', 'Plant and machinery', 'Professional indemnity']),
      },
    ],
    situations: [
      { key: 'contract_being_terminated', label: 'A contract is being terminated', scope: 'function', hint: 'A notice of default has gone to a contractor, or one is about to.' },
    ],
    sections: [
      { key: 'terms', label: 'Terms' },
      { key: 'security', label: 'Security' },
      { key: 'position', label: 'Position' },
      { key: 'termination', label: 'Termination', showWhen: { situation: 'contract_being_terminated' } },
    ],
    fields: [
      { ...CONTRACT_LINK, section: 'terms' },
      { key: 'damages_pct_per_week', label: 'Liquidated damages a week', kind: 'percent', precision: 2, section: 'terms', from: 'Contract' },
      { key: 'damages_cap_pct', label: 'Liquidated damages, at most', kind: 'percent', precision: 2, section: 'terms', from: 'Contract' },
      { key: 'deviation_limit_pct', label: 'Deviation the contract allows', kind: 'percent', precision: 2, section: 'terms', required: false, from: 'Contract' },
      { key: 'escalation', label: 'Price variation', kind: 'enum', control: 'segmented', section: 'terms', options: ['none', 'by formula', 'on named materials'], from: 'Contract' },
      { key: 'escalation_cap_pct', label: 'Price variation, at most', kind: 'percent', precision: 2, section: 'terms', tier: 'situational', showWhen: { field: at(ORDERS, SET.terms, 'escalation'), is: 'in', value: ['by formula', 'on named materials'] }, from: 'Contract' },
      { key: 'insurances_required', label: 'Insurances the contract asks for', kind: 'multi_enum', optionSet: 'insurance_kind', section: 'security', from: 'Contract' },
      { key: 'performance_security_pct', label: 'Performance security asked', kind: 'percent', precision: 2, section: 'security', from: 'Contract' },
      computed('performance_usual_pct', 'Usual under its conditions', via('contract', CONTRACT('performance_usual_pct')), { section: 'security', unit: '%', precision: 2 }),
      computedMoney('performance_required', 'Performance security required', div(mul(via('contract', CONTRACT('value')), f('performance_security_pct')), n(100)), { section: 'security' }),
      computedMoney('performance_held', 'Performance security held', sumWhere(SET.securities, 'performance_amount', own('contract', 'contract')), { section: 'security' }),
      computedMoney('revised_value', 'Revised contract value', add(via('contract', CONTRACT('value')), via('contract', CONTRACT('variations_approved'))), { section: 'position' }),
      computed('variation_pct', 'Approved variations, of the contract value', pct(via('contract', CONTRACT('variations_approved')), via('contract', CONTRACT('value'))), { section: 'position', unit: '%', precision: 2 }),
      computed(
        'days_late',
        'Days the forecast runs past completion',
        when({ left: dayFrom(at(PROGRESS, 'schedule_progress.forecast_completion', 'forecast_completion')), is: 'gt', right: dayVia('contract', CONTRACT('revised_completion')) }, sub(dayFrom(at(PROGRESS, 'schedule_progress.forecast_completion', 'forecast_completion')), dayVia('contract', CONTRACT('revised_completion'))), n(0)),
        { section: 'position', unit: 'days', precision: 0 },
      ),
      computedMoney(
        'damages_exposure',
        'Liquidated damages exposure',
        // Told only where both the days and the rate are known. Each `else` reads the figure that is missing, and so gives no answer.
        when(isSet('days_late'), when(isSet('damages_pct_per_week'), div(mul(via('contract', CONTRACT('value')), { op: 'min', of: [mul(div(f('days_late'), n(7)), f('damages_pct_per_week')), f('damages_cap_pct')] }), n(100)), f('damages_pct_per_week')), f('days_late')),
        { section: 'position' },
      ),
      {
        key: 'position',
        label: 'Position',
        kind: 'status',
        section: 'position',
        cases: [
          { when: { kind: 'at_most', fields: ['days_late'], against: 0, say: 'The forecast runs {a} past the completion date after extensions.', severity: 'high' }, label: 'Forecast past the completion date', tone: 'critical' },
          { when: { kind: 'at_most', fields: ['variation_pct', 'deviation_limit_pct'], say: 'Approved variations are {a} of the contract value, past the {b} the contract allows.', severity: 'high' }, label: 'Past the deviation limit', tone: 'critical' },
          { when: { kind: 'at_least', fields: ['performance_held', 'performance_required'], say: 'Performance security held is {a} against {b} required.', severity: 'high' }, label: 'Performance security short', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      date('default_notice_on', 'Notice of default given on', { section: 'termination', tier: 'situational', required: false, from: 'Default notice' }),
      { key: 'cure_days', label: 'Days given to cure', kind: 'duration', unit: 'days', min: 0, section: 'termination', tier: 'situational', required: false, from: 'Contract' },
      computedDay('cure_ends', 'Cure period ends', { op: 'add_days', date: day('default_notice_on'), days: f('cure_days') }, { section: 'termination', tier: 'situational' }),
      date('terminated_on', 'Terminated on', { section: 'termination', tier: 'situational', required: false, from: 'Termination letter' }),
    ],
    rules: [
      { kind: 'at_least', fields: ['performance_held', 'performance_required'], say: 'Performance security held is {a} against {b} required.', severity: 'high' },
      { kind: 'at_most', fields: ['variation_pct', 'deviation_limit_pct'], say: 'Approved variations are {a} of the contract value, past the {b} the contract allows.', severity: 'high' },
      { kind: 'at_least', fields: ['performance_security_pct', 'performance_usual_pct'], say: 'The contract asks {a} as performance security where its conditions usually ask {b}.', severity: 'low' },
      { kind: 'before', when: { situation: 'contract_being_terminated' }, fields: ['cure_ends', 'terminated_on'], say: 'Terminated on {b}, before the cure period ended on {a}.', severity: 'critical' },
    ],
  },
  {
    id: SET.variations,
    fn: ORDERS,
    title: 'Variations',
    v: 1,
    records: { of: 'variation', titleField: 'ref', summaryFields: ['claimed', 'stage', 'standing'] },
    optionSets: [
      {
        id: 'variation_stage',
        label: 'Stage',
        options: [
          { key: 'notified', label: 'Notified', tone: 'info' },
          { key: 'claimed', label: 'Claimed', tone: 'info' },
          { key: 'assessed', label: 'Assessed', tone: 'info' },
          { key: 'approved', label: 'Approved', tone: 'good' },
          { key: 'rejected', label: 'Rejected', tone: 'neutral' },
          { key: 'disputed', label: 'Disputed', tone: 'warning' },
          { key: 'paid', label: 'Paid', tone: 'good' },
        ],
      },
    ],
    sections: [
      { key: 'what', label: 'Variation' },
      { key: 'money', label: 'Money' },
    ],
    // A variation that carries a time claim: the claim it rides on and the days, as a sheet of that variation alone.
    sheets: [
      {
        id: 'time_claim',
        title: 'Time claim',
        showWhen: { field: at(ORDERS, SET.variations, 'time_effect'), is: 'true' },
        fields: [
          { key: 'time_claim', label: 'Time claim', kind: 'ref', target: { set: SET.timeClaims } },
          computed('days_claimed', 'Days claimed', via('time_claim', CLAIM('days_claimed')), { unit: 'days', precision: 0 }),
          computed('days_granted', 'Days granted', via('time_claim', CLAIM('days_granted')), { unit: 'days', precision: 0 }),
          computedDay('claim_decided_on', 'Claim decided on', dayVia('time_claim', CLAIM('decided_on'))),
          computedDay('completion_after', 'Contract completion after the days granted', dayVia('contract', CONTRACT('revised_completion'))),
        ],
        rules: [],
      },
    ],
    fields: [
      text('ref', 'Reference', { section: 'what', from: 'Variation order', fromTypes: ['Variation claim'], factKey: 'variation_reference' }),
      { ...CONTRACT_LINK, section: 'what', fromTypes: ['Variation claim'], factKey: 'contract_number' },
      { key: 'kind', label: 'Kind', kind: 'enum', section: 'what', options: ['extra item', 'substituted item', 'quantity deviation', 'omission', 'rate revision'], from: 'Variation order' },
      { key: 'origin', label: 'Arose from', kind: 'enum', section: 'what', options: ['design change', 'answer to a query', 'site instruction', 'quantity re-measure', 'authority requirement'] },
      // What it arose from, as the record its owner keeps: the Architect's design change, or the query that was answered.
      { key: 'design_change', label: 'Design change it arose from', kind: 'ref', target: { set: 'design.changes.register' }, section: 'what', required: false, tier: 'situational', showWhen: { field: at(ORDERS, SET.variations, 'origin'), is: 'equals', value: 'design change' } },
      { key: 'query', label: 'Query it arose from', kind: 'ref', target: { set: 'design.rfis.requests' }, section: 'what', required: false, tier: 'situational', showWhen: { field: at(ORDERS, SET.variations, 'origin'), is: 'equals', value: 'answer to a query' } },
      date('notified_on', 'Notice received on', { section: 'what', from: 'Notice' }),
      paper('instruction', 'Instruction or order', { section: 'what' }),
      { key: 'time_effect', label: 'Carries a time claim', kind: 'boolean', control: 'switch', section: 'what' },
      money('claimed', 'Claimed', { section: 'money', from: 'Contractor’s claim', fromTypes: ['Variation claim'], factKey: 'amount_claimed', proof: 'expected' }),
      money('assessed', 'Assessed', { section: 'money', required: false, from: 'Rate analysis' }),
      { key: 'rate_basis', label: 'Basis of the rate', kind: 'enum', section: 'money', required: false, options: ['contract rate', 'derived from a contract rate', 'market rate analysis', 'schedule of rates', 'negotiated'] },
      { key: 'stage', label: 'Stage', kind: 'enum', optionSet: 'variation_stage', section: 'money' },
      date('approved_on', 'Approved on', { section: 'money', required: false, from: 'Variation order' }),
      { key: 'built', label: 'Already built', kind: 'boolean', control: 'tick', section: 'money' },
      computedMoney('approved_value', 'Counted as approved', when(oneOf('stage', VARIATION_STANDS), f('assessed'), n(0)), { section: 'money', tier: 'expert' }),
      computedMoney('pending_value', 'Counted as pending', when(oneOf('stage', VARIATION_PENDING), { op: 'max', of: [f('assessed'), f('claimed')] }, n(0)), { section: 'money', tier: 'expert' }),
      computedMoney('built_unapproved', 'Built and not approved', when({ all: [{ field: 'built', is: 'true' }, oneOf('stage', VARIATION_PENDING)] }, f('claimed'), n(0)), { section: 'money', tier: 'expert' }),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        section: 'money',
        cases: [
          { when: { kind: 'at_most', fields: ['built_unapproved'], against: 0, say: 'It is built, worth {a} as claimed, and not approved.', severity: 'high' }, label: 'Built and not approved', tone: 'critical' },
          { when: { kind: 'at_most', fields: ['assessed', 'claimed'], say: 'Assessed at {a}, above the {b} claimed.', severity: 'medium' }, label: 'Assessed above the claim', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'at_most', fields: ['built_unapproved'], against: 0, say: 'It is built, worth {a} as claimed, and not approved.', severity: 'high' },
      { kind: 'require_if', fields: ['stage', 'approved_on'], whenIn: VARIATION_STANDS, say: 'It is recorded as approved with no date of approval.', severity: 'low' },
    ],
  },
  {
    id: SET.timeClaims,
    fn: ORDERS,
    title: 'Time claims',
    v: 1,
    records: { of: 'time claim', titleField: 'claim_no', summaryFields: ['days_claimed', 'days_granted', 'notice'] },
    sections: [
      { key: 'claim', label: 'Claim' },
      { key: 'notice', label: 'Notice' },
      { key: 'days', label: 'Days' },
    ],
    // The cost of the delay, head by head: a sheet of the claim that makes one.
    sheets: [
      {
        id: 'cost_of_delay',
        title: 'Cost of delay',
        showWhen: { field: at(ORDERS, SET.timeClaims, 'with_cost'), is: 'true' },
        sections: [
          { key: 'claimed', label: 'Claimed' },
          { key: 'heads', label: 'Head by head' },
          { key: 'decided', label: 'Assessed and granted' },
        ],
        fields: [
          { key: 'cost_head', label: 'Claimed as', kind: 'multi_enum', section: 'claimed', options: ['prolongation', 'idle plant and labour', 'escalation', 'interest on late payment', 'loss of profit'] },
          money('cost_claimed', 'Cost claimed', { section: 'claimed', from: 'Contractor’s claim', fromTypes: ['Extension of time claim'] }),
          money('cost_assessed', 'Cost assessed', { section: 'decided', required: false }),
          money('site_overheads', 'Site overheads', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          money('head_office_overheads', 'Head office overheads', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          money('idle_plant', 'Idle plant', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          money('idle_labour', 'Idle labour', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          money('escalation', 'Escalation', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          money('finance_cost', 'Finance cost', { section: 'heads', required: false, from: 'Contractor’s claim' }),
          computedMoney('heads_total', 'Heads, added up', add(add(add(orNought('site_overheads'), orNought('head_office_overheads')), add(orNought('idle_plant'), orNought('idle_labour'))), add(orNought('escalation'), orNought('finance_cost'))), { section: 'heads' }),
          { key: 'formula_used', label: 'Overheads worked out by', kind: 'enum', section: 'heads', required: false, options: ['actual cost', 'Hudson', 'Emden', 'Eichleay'] },
          money('cost_granted', 'Cost granted', { section: 'decided', required: false, from: 'Determination' }),
        ],
        rules: [
          { kind: 'compare', fields: ['heads_total', 'cost_claimed'], when: { field: at(ORDERS, SET.timeClaims, 'heads_total'), is: 'gt', value: 0 }, tolerance: 0.001, say: 'The heads add to {a} and {b} is claimed: {divergence} apart.', severity: 'medium' },
          { kind: 'at_most', fields: ['cost_granted', 'cost_assessed'], say: '{a} of cost is granted, more than the {b} assessed.', severity: 'medium' },
        ],
      },
    ],
    fields: [
      text('claim_no', 'Claim', { section: 'claim', from: 'Contractor’s claim', fromTypes: ['Extension of time claim'], factKey: 'claim_number' }),
      { ...CONTRACT_LINK, section: 'claim', fromTypes: ['Extension of time claim'], factKey: 'contract_number' },
      { key: 'event', label: 'Delay event', kind: 'ref', target: { set: SET.delayEvents }, section: 'claim' },
      { key: 'cause', label: 'Whose delay', kind: 'enum', control: 'segmented', optionSet: 'delay_cause', section: 'claim', required: false },
      paper('claim', 'Claim and determination', { section: 'claim' }),
      computedDay('event_on', 'Event began on', dayVia('event', at(PROGRESS, SET.delayEvents, 'event_on')), { section: 'notice' }),
      date('notified_on', 'Notice received on', { section: 'notice', from: 'Notice', proof: 'expected' }),
      computed('days_to_notice', 'Days from the event to the notice', sub(day('notified_on'), day('event_on')), { section: 'notice', unit: 'days', precision: 0 }),
      computed('notice_period', 'Notice period under the contract', via('contract', CONTRACT('notice_period')), { section: 'notice', unit: 'days', precision: 0 }),
      {
        key: 'notice',
        label: 'Notice',
        kind: 'status',
        section: 'notice',
        cases: [
          { when: { kind: 'require', fields: ['notified_on'], say: 'The day the notice was received is not recorded.', severity: 'medium' }, label: 'Notice date not recorded', tone: 'warning' },
          { when: { kind: 'at_most', fields: ['days_to_notice', 'notice_period'], say: 'The notice came {a} after the event, outside the {b} the contract gives.', severity: 'high' }, label: 'Notice out of time', tone: 'critical' },
        ],
        otherwise: { label: 'Notice in time', tone: 'good' },
      },
      { key: 'days_claimed', label: 'Days claimed', kind: 'duration', unit: 'days', min: 0, section: 'days', from: 'Contractor’s claim', fromTypes: ['Extension of time claim'] },
      computed('days_recorded', 'Days recorded for the event on site', via('event', at(PROGRESS, SET.delayEvents, 'days')), { section: 'days', unit: 'days', precision: 0 }),
      { key: 'days_assessed', label: 'Days assessed', kind: 'duration', unit: 'days', min: 0, section: 'days', required: false },
      { key: 'days_granted', label: 'Days granted', kind: 'duration', unit: 'days', min: 0, section: 'days', required: false, from: 'Determination' },
      date('decided_on', 'Decided on', { section: 'days', required: false, from: 'Determination' }),
      { key: 'with_cost', label: 'Claims the cost of the delay', kind: 'boolean', control: 'switch', section: 'days' },
    ],
    rules: [
      { kind: 'at_most', fields: ['days_to_notice', 'notice_period'], say: 'The notice came {a} after the event, outside the {b} the contract gives.', severity: 'high' },
      { kind: 'at_most', fields: ['days_granted', 'days_claimed'], say: '{a} are granted, more than the {b} claimed.', severity: 'medium' },
      { kind: 'at_most', fields: ['days_claimed', 'days_recorded'], say: '{a} are claimed where site recorded {b} for the event.', severity: 'medium' },
      { kind: 'require_if', fields: ['days_granted', 'decided_on'], say: '{a} are granted with no date of the decision.', severity: 'low' },
      { kind: 'at_most', when: { field: at(ORDERS, SET.timeClaims, 'with_cost'), is: 'true' }, fields: ['cost_assessed', 'cost_claimed'], say: 'The cost of delay is assessed at {a}, above the {b} claimed.', severity: 'medium' },
    ],
  },
];

/* ==================================================================== */
/* Vendors: the vendor, guarantees, insurance                            */
/* ==================================================================== */

const VENDORS_SETS: FieldSet[] = [
  {
    id: SET.cover,
    fn: VENDORS,
    title: 'Securities and cover',
    v: 1,
    situations: [{ key: 'guarantee_held', label: 'A security is held', scope: 'function', hint: 'A guarantee or deposit is on the register.', derive: { records: SET.securities, is: 'any' } }],
    sections: [
      { key: 'held', label: 'Held' },
      { key: 'guarantees', label: 'Guarantees', showWhen: { situation: 'guarantee_held' } },
    ],
    fields: [
      computed('securities', 'Securities on the register', countOf(SET.securities), { section: 'held', precision: 0 }),
      computedMoney('performance_held', 'Performance security held', sumOf(SET.securities, 'performance_amount'), { section: 'held' }),
      computed('policies', 'Insurance policies', countOf(SET.policies), { section: 'held', precision: 0 }),
      computed('policies_lapsed', 'Policies no longer in force', countWhere(SET.policies, { column: 'in_force', is: 'equals', value: 0 }), { section: 'held', precision: 0 }),
      computed('vendors_debarred', 'Vendors debarred', countWhere(PARTIES, { column: 'debarred', is: 'true' }), { section: 'held', precision: 0, tier: 'expert' }),
      computed('days_to_first_expiry', 'Days to the first expiry', { op: 'records', set: SET.securities, reduce: 'min', field: 'days_live' }, { section: 'guarantees', tier: 'situational', unit: 'days', precision: 0 }),
      computed('expiring', 'To renew or already run out', countWhere(SET.securities, { column: 'standing', is: 'in', value: ['Expired', 'Expiring', 'Renew now'] }), { section: 'guarantees', tier: 'situational', precision: 0 }),
      computed('uncovered', 'Running out before the obligation ends', countWhere(SET.securities, { column: 'standing', is: 'equals', value: 'Runs out before the obligation ends' }), { section: 'guarantees', tier: 'situational', precision: 0 }),
      computed('unconfirmed', 'Not confirmed with the bank', countWhere(SET.securities, { column: 'standing', is: 'equals', value: 'Not confirmed with the bank' }), { section: 'guarantees', tier: 'situational', precision: 0 }),
    ],
    rules: [
      {
        kind: 'at_least',
        when: { situation: 'guarantee_held' },
        fields: ['performance_held', 'required_on_check'],
        at: { required_on_check: at(VENDORS, 'procurement.security', 'pbg_required') },
        say: 'Performance security held is {a} against the {b} the Security check records as required.',
        severity: 'high',
      },
      {
        kind: 'compare',
        when: { situation: 'guarantee_held' },
        fields: ['performance_held', 'held_on_check'],
        at: { held_on_check: at(VENDORS, 'procurement.security', 'pbg_held') },
        tolerance: 0,
        say: 'The register holds {a} of performance security and the Security check records {b} held.',
        severity: 'low',
      },
    ],
  },
  {
    id: SET.vendor,
    fn: VENDORS,
    title: 'Vendor',
    v: 1,
    extends: PARTIES,
    fields: [
      { key: 'vendor_kind', label: 'Supplies as', kind: 'multi_enum', required: false, options: ['contractor', 'labour contractor', 'supplier', 'manufacturer', 'consultant', 'testing laboratory'] },
      { key: 'vendor_trades', label: 'Trades', kind: 'multi_enum', optionSet: 'package_trade', required: false },
      // Whether they are a registered small enterprise, and the number, are on the party record once, with Finance's facts of it (finance.ledgers.supplier_facts).
      money('prequalified_limit', 'Prequalified up to', { required: false, from: 'Prequalification note' }),
      date('prequalified_to', 'Prequalified until', { required: false, from: 'Prequalification note', expires: { leadDays: 30 } }),
      { key: 'debarred', label: 'Debarred', kind: 'boolean', control: 'switch', required: false, tier: 'expert' },
      computed('contracts_held', 'Contracts on this project', countWhere(CONTRACTS, own('counterparty')), { precision: 0 }),
      computedMoney('work_in_hand', 'Contract value on this project', sumWhere(CONTRACTS, 'value', own('counterparty'))),
      computed('inspections_requested', 'Inspections requested', countWhere(SET.inspections, own('contractor')), { precision: 0, tier: 'expert' }),
      computed('first_pass_pct', 'Inspections approved first time', pct(sumWhere(SET.inspections, 'first_pass', own('contractor')), f('inspections_requested')), { unit: '%', precision: 0 }),
      computed('ncrs_against', 'Non-conformances against them', countWhere(SET.ncrs, own('against')), { precision: 0 }),
      computed('snags_against', 'Snags to fix', countWhere(SET.snags, own('contractor')), { precision: 0 }),
      computed('incidents_on_workforce', 'Incidents among their workers', countWhere(SET.incidents, own('employer')), { precision: 0 }),
    ],
    rules: [
      { kind: 'at_most', fields: ['work_in_hand', 'prequalified_limit'], say: 'They hold {a} of contracts on this project, above the {b} they are prequalified up to.', severity: 'medium' },
    ],
  },
  {
    id: SET.securities,
    fn: VENDORS,
    title: 'Securities',
    v: 1,
    records: { of: 'security', titleField: 'number', summaryFields: ['kind', 'amount', 'valid_to', 'standing'] },
    optionSets: [
      {
        id: 'security_kind',
        label: 'Security',
        options: [
          { key: 'performance', label: 'Performance guarantee', tone: 'info' },
          { key: 'advance_payment', label: 'Advance payment guarantee', tone: 'info' },
          { key: 'retention', label: 'Retention guarantee', tone: 'info' },
          { key: 'defect_liability', label: 'Defect liability guarantee', tone: 'info' },
          { key: 'security_deposit', label: 'Security deposit', tone: 'neutral' },
        ],
      },
    ],
    sections: [
      { key: 'instrument', label: 'Instrument' },
      { key: 'validity', label: 'Validity' },
      { key: 'standing', label: 'Against the obligation' },
    ],
    // A guarantee that is called on: the demand, what the bank did, and the suit if the vendor went to court. Nothing on it is asked until there is a demand.
    sheets: [
      {
        id: 'invocation',
        title: 'Invocation',
        showWhen: { field: at(VENDORS, SET.securities, 'valid_to'), is: 'set' },
        fields: [
          date('invoked_on', 'Demand lodged with the bank on', { required: false, from: 'Demand letter' }),
          money('amount_claimed', 'Amount demanded', { required: false, from: 'Demand letter' }),
          { key: 'ground', label: 'Ground', kind: 'enum', required: false, options: ['non-performance', 'not renewed', 'advance not recovered', 'termination'] },
          { key: 'demand_matches_terms', label: 'Demand worded as the guarantee asks', kind: 'boolean', control: 'tick', required: false },
          paper('demand', 'Demand letter'),
          date('bank_paid_on', 'Bank paid on', { required: false, from: 'Bank advice' }),
          money('amount_paid', 'Amount the bank paid', { required: false, from: 'Bank advice' }),
          { key: 'injunction_sought', label: 'The vendor has gone to court to stop it', kind: 'boolean', control: 'switch', required: false },
          { key: 'matter', label: 'Matter', kind: 'ref', target: 'matter', required: false, tier: 'situational', showWhen: { field: at(VENDORS, SET.securities, 'injunction_sought'), is: 'true' } },
          computed('demand_days_late', 'Days the demand was lodged after claims closed', sub(day('invoked_on'), day('claim_until')), { unit: 'days', precision: 0, tier: 'expert' }),
        ],
        rules: [
          { kind: 'at_most', fields: ['demand_days_late'], against: 0, say: 'The demand was lodged {a} after the last day the guarantee allows a claim.', severity: 'critical' },
          { kind: 'at_most', fields: ['amount_claimed', 'amount'], say: '{a} is demanded under a guarantee of {b}.', severity: 'high' },
          { kind: 'require_if', fields: ['invoked_on', 'amount_claimed'], say: 'A demand was lodged on {a} with no amount recorded.', severity: 'medium' },
          { kind: 'require', fields: ['matter'], when: { field: at(VENDORS, SET.securities, 'injunction_sought'), is: 'true' }, say: 'The vendor has gone to court over the invocation and no matter is linked.', severity: 'medium' },
        ],
      },
    ],
    fields: [
      text('number', 'Guarantee or instrument number', { section: 'instrument', from: 'Bank guarantee', fromTypes: ['Bank guarantee'], factKey: 'guarantee_number' }),
      { key: 'kind', label: 'Security', kind: 'enum', control: 'tiles', optionSet: 'security_kind', section: 'instrument', from: 'Bank guarantee' },
      { key: 'instrument', label: 'Instrument', kind: 'enum', optionSet: 'security_instrument', section: 'instrument', from: 'Bank guarantee' },
      { ...CONTRACT_LINK, section: 'instrument', fromTypes: ['Bank guarantee'], factKey: 'contract_number' },
      party('vendor', 'Given by', { section: 'instrument', required: false }),
      party('bank', 'Bank', { section: 'instrument', from: 'Bank guarantee', fromTypes: ['Bank guarantee'] }),
      money('amount', 'Amount', { section: 'instrument', from: 'Bank guarantee', fromTypes: ['Bank guarantee'], factKey: 'guaranteed_amount', proof: 'expected' }),
      paper('guarantee', 'Guarantee', { section: 'instrument' }),
      date('issued_on', 'Issued on', { section: 'validity', required: false, from: 'Bank guarantee', fromTypes: ['Bank guarantee'] }),
      date('valid_to', 'Valid until', { section: 'validity', from: 'Bank guarantee', fromTypes: ['Bank guarantee'], factKey: 'valid_until', proof: 'expected' }),
      date('claim_until', 'Claims may be lodged until', { section: 'validity', required: false, from: 'Bank guarantee', fromTypes: ['Bank guarantee'] }),
      date('confirmed_with_bank_on', 'Confirmed with the bank on', { section: 'validity', from: 'Bank’s confirmation' }),
      date('released_on', 'Released on', { section: 'validity', required: false, from: 'Release letter' }),
      computedDay(
        'obligation_ends',
        'The obligation it secures ends',
        when(
          equals('kind', 'defect_liability'),
          dayVia('contract', CONTRACT('defects_end')),
          when(equals('kind', 'performance'), { op: 'add_days', date: dayVia('contract', CONTRACT('revised_completion')), days: rate('performance_security_margin_days') }, dayVia('contract', CONTRACT('revised_completion'))),
        ),
        { section: 'standing' },
      ),
      computedDay('renew_by', 'Renew by', { op: 'add_days', date: day('valid_to'), days: n(-45) }, { section: 'standing' }),
      computed('days_left', 'Days left', sub(day('valid_to'), today), { section: 'standing', unit: 'days', precision: 0 }),
      flag('released', 'Released', isSet('released_on'), { section: 'standing' }),
      // No figure once released: a date read as a figure gives no answer, so a released security is left out of the first expiry.
      computed('days_live', 'Days left, while held', when(isSet('released_on'), f('released_on'), f('days_left')), { section: 'standing', unit: 'days', precision: 0, tier: 'expert' }),
      computedMoney('performance_amount', 'Counted as performance security in force', when(equals('kind', 'performance'), when(isSet('released_on'), n(0), when({ left: f('days_left'), is: 'gte', right: n(0) }, f('amount'), n(0))), n(0)), { section: 'standing', tier: 'expert' }),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        section: 'standing',
        cases: [
          { when: { kind: 'at_most', fields: ['released'], against: 0, say: 'This security has been released.', severity: 'low' }, label: 'Released', tone: 'neutral' },
          { when: { kind: 'at_least', fields: ['days_left'], against: 0, say: 'This security has run out.', severity: 'critical' }, label: 'Expired', tone: 'critical' },
          { when: { kind: 'before', fields: ['obligation_ends', 'valid_to'], say: 'The obligation it secures runs to {a} and it runs out on {b}.', severity: 'critical' }, label: 'Runs out before the obligation ends', tone: 'critical' },
          { when: { kind: 'at_least', fields: ['days_left'], against: 15, say: 'It runs out in {a}.', severity: 'high' }, label: 'Expiring', tone: 'critical' },
          { when: { kind: 'at_least', fields: ['days_left'], against: 45, say: 'It runs out in {a}: renew it now.', severity: 'medium' }, label: 'Renew now', tone: 'warning' },
          { when: { kind: 'require', fields: ['confirmed_with_bank_on'], say: 'The issuing bank has not confirmed it.', severity: 'medium' }, label: 'Not confirmed with the bank', tone: 'warning' },
        ],
        otherwise: { label: 'Valid', tone: 'good' },
      },
    ],
    rules: [
      {
        kind: 'before',
        when: { field: at(VENDORS, SET.securities, 'released'), is: 'lt', value: 1 },
        fields: ['obligation_ends', 'valid_to'],
        say: 'The obligation it secures runs to {a} and this runs out on {b}: have it extended.',
        severity: 'critical',
      },
      { kind: 'before', fields: ['valid_to', 'claim_until'], say: 'Claims may be lodged until {b}, before it runs out on {a}.', severity: 'low' },
    ],
  },
  {
    id: SET.policies,
    fn: VENDORS,
    title: 'Insurance policies',
    v: 1,
    records: { of: 'policy', titleField: 'policy_no', summaryFields: ['kind', 'sum_insured', 'to'] },
    fields: [
      text('policy_no', 'Policy number', { from: 'Insurance policy' }),
      { key: 'kind', label: 'Insurance', kind: 'enum', optionSet: 'insurance_kind', from: 'Insurance policy' },
      { ...CONTRACT_LINK },
      party('insurer', 'Insurer', { from: 'Insurance policy' }),
      money('sum_insured', 'Sum insured', { from: 'Insurance policy' }),
      date('from', 'From', { from: 'Insurance policy' }),
      date('to', 'Until', { from: 'Insurance policy', expires: { leadDays: 30 } }),
      { key: 'employer_named', label: 'Employer named as insured', kind: 'boolean', control: 'tick', from: 'Insurance policy' },
      paper('policy', 'Policy'),
      flag('in_force', 'In force today', { left: today, is: 'lte', right: day('to') }),
    ],
    rules: [{ kind: 'before', fields: ['from', 'to'], say: 'The policy runs from {a} to {b}: the start is after the end.', severity: 'low' }],
  },
  {
    id: SET.vendorEvaluations,
    fn: VENDORS,
    title: 'Evaluations after a contract',
    v: 1,
    records: { of: 'evaluation', titleField: 'contract', summaryFields: ['vendor', 'score'] },
    fields: [
      { ...CONTRACT_LINK },
      party('vendor', 'Vendor'),
      { key: 'quality', label: 'Quality', kind: 'number', control: 'scale', min: 1, max: 5 },
      { key: 'time', label: 'Time', kind: 'number', control: 'scale', min: 1, max: 5 },
      { key: 'safety', label: 'Safety', kind: 'number', control: 'scale', min: 1, max: 5 },
      { key: 'conduct', label: 'Commercial conduct', kind: 'number', control: 'scale', min: 1, max: 5 },
      computed('score', 'Score out of five', div(add(add(f('quality'), f('time')), add(f('safety'), f('conduct'))), n(4)), { precision: 1 }),
      party('evaluated_by', 'Evaluated by', { required: false }),
      date('evaluated_on', 'Evaluated on', { required: false }),
    ],
    rules: [],
  },
];

/* ==================================================================== */
/* Deliveries: what arrived, and what is on long lead                    */
/* ==================================================================== */

const DELIVERIES_SETS: FieldSet[] = [
  {
    id: SET.deliveries,
    fn: DELIVERIES,
    title: 'Deliveries',
    v: 1,
    situations: [{ key: 'long_lead_item', label: 'An order is on long lead', scope: 'function', hint: 'An order with a lead time is being tracked against the day it is needed.', derive: { records: SET.longLead, is: 'any' } }],
    sections: [
      { key: 'received', label: 'Received' },
      { key: 'orders', label: 'Orders on long lead', showWhen: { situation: 'long_lead_item' } },
    ],
    fields: [
      computed('receipts', 'Receipts recorded', countOf(SET.receipts), { section: 'received', precision: 0 }),
      computed('uncertified', 'Cement and steel received with no certificate', countWhere(SET.receipts, { column: 'standing', is: 'equals', value: 'Certificate missing' }), { section: 'received', precision: 0 }),
      computed('steel_lots_failing', 'Reinforcement lots below their grade', countWhere(SET.steel, { column: 'acceptance', is: 'in', value: ['Yield below the grade', 'Elongation below the grade', 'Ratio below the grade', 'Bend test failed'] }), { section: 'received', precision: 0 }),
      computed('orders', 'Orders tracked', countOf(SET.longLead), { section: 'orders', tier: 'situational', precision: 0 }),
      computed('orders_late', 'Arriving after they are needed', countWhere(SET.longLead, { column: 'standing', is: 'equals', value: 'Arrives after it is needed' }), { section: 'orders', tier: 'situational', precision: 0 }),
    ],
    rules: [],
  },
  {
    id: SET.receipts,
    fn: DELIVERIES,
    title: 'Material received',
    v: 1,
    records: { of: 'receipt', titleField: 'challan_no', summaryFields: ['material', 'quantity', 'standing'] },
    fields: [
      text('challan_no', 'Challan number', { from: 'Delivery challan' }),
      date('received_on', 'Received on', { from: 'Delivery challan' }),
      { key: 'material', label: 'Material', kind: 'enum', options: ['cement', 'steel', 'ready-mix concrete', 'aggregate', 'sand', 'blocks', 'tiles', 'pipes', 'cables', 'other'], from: 'Delivery challan' },
      { key: 'quantity', label: 'Quantity', kind: 'number', min: 0, from: 'Delivery challan' },
      { key: 'unit', label: 'In', kind: 'enum', control: 'segmented', options: ['bags', 'tonnes', 'cubic metres', 'numbers', 'square metres', 'metres'] },
      party('vendor', 'From'),
      { ...PACKAGE, required: false },
      text('grade_or_make', 'Grade or make', { required: false, from: 'Delivery challan' }),
      paper('certificate', 'Test certificate'),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [{ when: { kind: 'require_if', fields: ['material', 'certificate'], whenIn: ['cement', 'steel'], say: 'This {a} came with no test certificate on file.', severity: 'medium' }, label: 'Certificate missing', tone: 'warning' }],
        otherwise: { label: 'Received', tone: 'neutral' },
      },
    ],
    rules: [],
  },
  {
    id: SET.longLead,
    fn: DELIVERIES,
    title: 'Orders on long lead',
    v: 1,
    records: { of: 'order', titleField: 'item', summaryFields: ['expected_on', 'float_days', 'standing'] },
    fields: [
      text('item', 'Item', { from: 'Purchase order' }),
      { ...PACKAGE },
      party('vendor', 'Ordered from'),
      date('ordered_on', 'Ordered on', { from: 'Purchase order' }),
      { key: 'lead_weeks', label: 'Lead time', kind: 'duration', unit: 'weeks', min: 0, from: 'Purchase order' },
      computedDay('needed_on_site', 'Needed on site by', figure('package.need_day', 'package'), { from: 'Schedule' }),
      computedDay('expected_on', 'Expected on', { op: 'add_days', date: day('ordered_on'), days: mul(f('lead_weeks'), n(7)) }),
      computed('float_days', 'Days in hand', sub(day('needed_on_site'), day('expected_on')), { unit: 'days', precision: 0 }),
      date('delivered_on', 'Delivered on', { required: false }),
      flag('delivered', 'Delivered', isSet('delivered_on')),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [
          { when: { kind: 'at_most', fields: ['delivered'], against: 0, say: 'It has been delivered.', severity: 'low' }, label: 'Delivered', tone: 'good' },
          { when: { kind: 'at_least', fields: ['float_days'], against: 0, say: 'It is expected {a} after the day it is needed on site.', severity: 'high' }, label: 'Arrives after it is needed', tone: 'critical' },
        ],
        otherwise: { label: 'In time', tone: 'good' },
      },
    ],
    rules: [],
  },
];

export const PROCUREMENT_SETS: FieldSet[] = [...BOQ_SETS, ...ORDERS_SETS, ...VENDORS_SETS, ...DELIVERIES_SETS];
