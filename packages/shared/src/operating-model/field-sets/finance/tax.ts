/**
 * Finance › Tax: the project's tax position, held as facts and workings for
 * the firm's chartered accountant to confirm. None of it is tax advice, and
 * every sheet says so in the name of its first section.
 *
 * Six functions of the catalog:
 *
 * - GST on units sold: the rate each unit carries, by the rule table, and
 *   the month's liability as a record for each month;
 * - GST on purchases: the registered-supplier test, a record for each year;
 * - tax deducted at source: by the firm a month at a time, on property
 *   bought, and by buyers against the tax statement;
 * - stamp duty and registration, an instrument at a time;
 * - khata and property tax;
 * - a joint development's tax facts, shown only on a joint development.
 *
 * The returns, the purchase register and the vouchers stay in the
 * accounting package and on the government's portals. What is held here is
 * the position: which rate, on what, due when, paid or not.
 */

import type { FieldSet } from '../../types';
import { EXISTING, IF_JOINT, NOT_ADVICE, PAPER, SET } from './names';
import {
  TAX,
  addDays,
  addMonths,
  area,
  asPct,
  at,
  choice,
  tallyWhere,
  dateOf,
  day,
  f,
  limitFor,
  link,
  minus,
  mirror,
  money,
  most,
  n,
  nothing,
  only,
  options,
  orZero,
  paper,
  pctOf,
  percent,
  plus,
  rate,
  rule,
  rupees,
  share,
  standing,
  totalOf,
  totalWhere,
  text,
  tick,
  times,
  today,
  when,
  worked,
} from './kit';

const KIND_OF_PAYMENT = at(TAX, SET.jdaPayments, 'kind');
/** The welfare cess has been assessed: a cost of construction is recorded for it. */
const ASSESSED = { field: at(TAX, SET.welfareCess, 'cost_assessed'), is: 'set' } as const;

export const TAX_SETS: FieldSet[] = [
  {
    id: SET.partyTax,
    fn: TAX,
    title: 'Tax registrations',
    v: 1,
    extends: 'shared.parties',
    fields: [
      text('pan', 'Permanent account number', { required: false }),
      text('gstin', 'GST registration number', { required: false }),
      text('tan', 'Tax deduction account number', { required: false }),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* GST on units sold                                                   */
  /* ================================================================== */
  {
    id: SET.gst,
    fn: TAX,
    title: 'GST on units sold',
    v: 1,
    optionSets: [
      options('gst_scheme', 'GST scheme', [
        ['without_credit', 'New scheme, without input credit'],
        ['with_credit', 'Old scheme, with input credit'],
      ]),
    ],
    situations: [
      {
        key: 'started_under_old_scheme',
        label: 'Began under the scheme with input credit',
        scope: 'function',
        hint: 'The project was under way when the scheme without input credit came in, so a choice between the two was open.',
        derive: { field: at(TAX, SET.gst, 'scheme_generation'), is: 'equals', value: 1 },
      },
    ],
    sections: [
      { key: 'position', label: `GST position: ${NOT_ADVICE}` },
      { key: 'charged', label: 'Charged against expected', showWhen: { records: 'shared.units', is: 'any' } },
      { key: 'choice', label: 'Scheme chosen', showWhen: { situation: 'started_under_old_scheme' } },
    ],
    fields: [
      link('taxpayer', 'Registered person', 'party', { section: 'position' }),
      day('commenced_on', 'Project commenced on', { section: 'position', from: 'Commencement certificate', sameAs: { fn: 'legal.approvals', set: 'legal.approvals.occupancy', field: 'commencement_on' } }),
      worked('scheme_generation', 'Scheme in force when it began, by its number in the rule table', rate('gst_scheme_generation', 'commenced_on'), { section: 'position', precision: 0 }),
      percent('commercial_share', 'Commercial carpet area, share of all carpet', { section: 'position', required: false, from: 'Area statement' }),
      share('commercial_limit', 'Largest commercial share of a residential project', limitFor('commercial_share', rate('gst_residential_commercial_share_max')), { section: 'position' }),
      standing(
        'project_class',
        'Project class',
        [{ when: rule('at_most', ['commercial_share', 'commercial_limit'], 'Commercial carpet is {a} of the whole, above the {b} a residential real estate project may have.', 'medium'), label: 'Not a residential real estate project', tone: 'warning' }],
        { label: 'Residential real estate project', tone: 'info' },
        { section: 'position' },
      ),
      mirror('completion_on', 'Occupancy certificate dated', 'date', EXISTING.occupancyDate, { section: 'position' }),
      rupees('gst_expected', 'GST that should have been charged', totalOf('shared.units', 'gst_expected'), { section: 'charged' }),
      rupees('gst_charged', 'GST charged to date', totalOf('shared.units', 'gst_charged'), { section: 'charged' }),
      rupees('gst_unpaid', 'GST payable, not yet paid', totalOf(SET.gstMonths, 'unpaid'), { section: 'charged' }),
      standing(
        'charge_standing',
        'Charged against expected',
        [{ when: rule('compare', ['gst_charged', 'gst_expected'], 'GST charged is {a} and {b} was expected: {divergence} apart.', 'medium', { tolerance: 0.005 }), label: 'Charged and expected differ', tone: 'warning' }],
        { label: 'Charged as expected', tone: 'good' },
        { section: 'charged' },
      ),
      only({ situation: 'started_under_old_scheme' }, choice('scheme', 'GST scheme', 'gst_scheme', { section: 'choice', control: 'tiles' })),
      only({ situation: 'started_under_old_scheme' }, day('option_filed_on', 'Option filed on', { section: 'choice' })),
      only({ situation: 'started_under_old_scheme' }, money('credit_reversed', 'Input credit reversed', { section: 'choice', required: false })),
    ],
    rules: [
      rule('at_most', ['commercial_share', 'commercial_limit'], 'Commercial carpet is {a} of the whole, above the {b} a residential real estate project may have.', 'medium'),
      rule('compare', ['gst_charged', 'gst_expected'], 'GST charged is {a} and {b} was expected: {divergence} apart.', 'medium', { tolerance: 0.005 }),
    ],
  },
  {
    id: SET.unitGst,
    fn: TAX,
    title: 'GST on the unit',
    v: 1,
    extends: 'shared.units',
    fields: [
      money('price_for_tax', 'Consideration, for GST', { required: false, from: 'Agreement for sale', fromTypes: [PAPER.unitAgreement], factKey: 'consideration' }),
      worked(
        'gst_rate',
        'GST rate on the consideration',
        when(
          {
            all: [
              { left: f('carpet_area'), is: 'lte', right: rate('gst_affordable_carpet_max') },
              { left: f('price_for_tax'), is: 'lte', right: rate('gst_affordable_price_max') },
            ],
          },
          rate('gst_flat_affordable'),
          rate('gst_flat_other'),
        ),
        { unit: '%' },
      ),
      money('demanded_for_tax', 'Demanded to date, before tax', { required: false, from: 'Demand letters' }),
      rupees('gst_expected', 'GST expected on what was demanded', pctOf(f('demanded_for_tax'), f('gst_rate'))),
      money('gst_charged', 'GST charged to date', { required: false, from: 'Tax invoices' }),
      standing(
        'gst_standing',
        'GST charged',
        [{ when: rule('compare', ['gst_charged', 'gst_expected'], 'GST charged on the unit is {a} and {b} was expected.', 'medium', { tolerance: 0.005 }), label: 'Differs from expected', tone: 'warning' }],
        { label: 'As expected', tone: 'good' },
      ),
    ],
    rules: [rule('compare', ['gst_charged', 'gst_expected'], 'GST charged on the unit is {a} and {b} was expected.', 'medium', { tolerance: 0.005 })],
  },
  {
    id: SET.gstMonths,
    fn: TAX,
    title: 'GST by month',
    v: 1,
    records: { of: 'month', titleField: 'month', summaryFields: ['tax_payable', 'month_standing'] },
    periodic: { every: 'month', by: 'month', due: { rate: 'gst_monthly_return_due_day' }, issuer: 'lead' },
    sections: [
      { key: 'out', label: 'Outward supplies and tax' },
      { key: 'in', label: 'Input tax' },
    ],
    fields: [
      day('month', 'Month beginning', { section: 'out' }),
      money('outward_per_books', 'Outward supplies per the books', { section: 'out', from: 'Sales ledger export' }),
      money('outward_per_return', 'Outward supplies per the outward return (GSTR-1)', { section: 'out', required: false }),
      money('tax_payable', 'Tax payable for the month', { section: 'out', from: 'Monthly return (GSTR-3B)' }),
      worked('due_on', 'Due on', addDays(addMonths(dateOf('month'), n(1)), minus(rate('gst_monthly_return_due_day'), n(1))), { section: 'out', yields: 'date' }),
      money('tax_paid', 'Tax paid', { section: 'out', required: false }),
      day('paid_on', 'Paid on', { section: 'out', required: false }),
      text('challan', 'Challan number', { section: 'out', required: false }),
      rupees('unpaid', 'Not yet paid', minus(f('tax_payable'), orZero('tax_paid')), { section: 'out' }),
      money('input_per_books', 'Input tax per the books', { section: 'in', required: false }),
      money('input_per_statement', 'Input tax per the supplier statement (GSTR-2B)', { section: 'in', required: false }),
      rupees('input_unmatched', 'Input tax not in the supplier statement', minus(f('input_per_books'), f('input_per_statement')), { section: 'in' }),
      standing(
        'month_standing',
        'Month',
        [
          { when: rule('before', ['paid_on', 'due_on'], 'Paid on {a}; it was due on {b}.', 'high'), label: 'Paid late', tone: 'critical' },
          { when: rule('compare', ['outward_per_books', 'outward_per_return'], 'The books show {a} of outward supplies and the return {b}.', 'medium', { tolerance: 0 }), label: 'Books and return differ', tone: 'warning' },
          { when: rule('at_most', ['unpaid'], '{a} of the month’s tax is not yet paid.', 'medium', { against: 0 }), label: 'Not yet paid', tone: 'warning' },
        ],
        { label: 'Filed and paid', tone: 'good' },
        { section: 'out' },
      ),
    ],
    rules: [
      rule('before', ['paid_on', 'due_on'], 'Paid on {a}; it was due on {b}.', 'high'),
      rule('compare', ['outward_per_books', 'outward_per_return'], 'The books show {a} of outward supplies and the return {b}.', 'medium', { tolerance: 0 }),
      rule('at_most', ['unpaid'], '{a} of the month’s tax is not yet paid.', 'medium', { against: 0 }),
      rule('compare', ['input_per_books', 'input_per_statement'], 'Input tax is {a} in the books and {b} in the supplier statement.', 'low', { tolerance: 0 }),
    ],
  },

  /* ================================================================== */
  /* GST on purchases                                                    */
  /* ================================================================== */
  {
    id: SET.purchaseYears,
    fn: TAX,
    title: 'Registered-supplier test by year',
    v: 1,
    records: { of: 'year', titleField: 'year_end', summaryFields: ['registered_share', 'test_standing'] },
    fields: [
      day('year_end', 'Financial year ending'),
      money('counted', 'Purchases counted for the test', { from: 'Purchase register', hint: 'Leaving out what the test leaves out, as the accountant classes it.' }),
      money('from_registered', 'Of which from registered suppliers', { from: 'Purchase register' }),
      share('registered_share', 'Share from registered suppliers', asPct(f('from_registered'), f('counted'))),
      share('required_share', 'Share required', rate('gst_registered_procurement_min', 'year_end')),
      rupees('shortfall', 'Shortfall', when({ field: 'from_registered', is: 'set' }, most(minus(pctOf(f('counted'), f('required_share')), f('from_registered')), n(0)), nothing)),
      rupees('tax_on_shortfall', 'Reverse charge on the shortfall', pctOf(f('shortfall'), rate('gst_rcm_shortfall', 'year_end'))),
      money('reverse_charge_paid', 'Reverse charge paid', { required: false, from: 'Returns' }),
      money('cement_unregistered', 'Cement bought from unregistered suppliers', { required: false, from: 'Purchase register' }),
      money('input_tax', 'Input tax in the year, carried as cost', { required: false, from: 'Purchase register' }),
      paper('working', 'Working'),
      standing(
        'test_standing',
        'Registered-supplier test',
        [
          { when: rule('at_least', ['registered_share', 'required_share'], '{a} of purchases came from registered suppliers; {b} is required.', 'high'), label: 'Short of the share required', tone: 'critical' },
          { when: rule('at_least', ['reverse_charge_paid', 'tax_on_shortfall'], 'Reverse charge of {a} is paid against {b} worked out.', 'medium'), label: 'Reverse charge not fully paid', tone: 'warning' },
        ],
        { label: 'Met', tone: 'good' },
      ),
    ],
    rules: [
      rule('at_least', ['registered_share', 'required_share'], '{a} of purchases came from registered suppliers; {b} is required.', 'high'),
      rule('at_least', ['reverse_charge_paid', 'tax_on_shortfall'], 'Reverse charge of {a} is paid against {b} worked out.', 'medium'),
      rule('at_most', ['from_registered', 'counted'], 'Purchases from registered suppliers are {a}, more than the {b} counted.', 'low'),
    ],
  },

  /* ================================================================== */
  /* Tax deducted at source                                              */
  /* ================================================================== */
  {
    id: SET.tds,
    fn: TAX,
    title: 'Tax deducted at source',
    v: 1,
    sections: [
      { key: 'firm', label: `Deducted by the firm: ${NOT_ADVICE}` },
      { key: 'buyers', label: 'Deducted by buyers', showWhen: { records: SET.buyerTds, is: 'any' } },
    ],
    fields: [
      link('deductor', 'Deductor', 'party', { section: 'firm' }),
      rupees('deducted', 'Deducted to date', totalOf(SET.tdsMonths, 'deducted'), { section: 'firm' }),
      rupees('undeposited', 'Deducted, not yet deposited', totalOf(SET.tdsMonths, 'undeposited'), { section: 'firm' }),
      worked('months_late', 'Months deposited late', tallyWhere(SET.tdsMonths, { column: 'days_late', is: 'gt', value: 0 }), { section: 'firm', precision: 0 }),
      standing(
        'deposit_standing',
        'Deposits',
        [
          { when: rule('at_most', ['months_late'], 'Months in which tax deducted was deposited late: {a}.', 'high', { against: 0 }), label: 'Deposited late', tone: 'critical' },
          { when: rule('at_most', ['undeposited'], '{a} deducted is not yet deposited.', 'medium', { against: 0 }), label: 'Held, not yet deposited', tone: 'warning' },
        ],
        { label: 'Deposited in time', tone: 'good' },
        { section: 'firm' },
      ),
      rupees('buyers_expected', 'Expected from buyers', totalOf(SET.buyerTds, 'expected'), { section: 'buyers' }),
      rupees('buyers_deducted', 'Deducted by buyers', totalOf(SET.buyerTds, 'deducted'), { section: 'buyers' }),
      rupees('credited', 'Credit in the tax statement', totalOf(SET.buyerTds, 'credited'), { section: 'buyers' }),
      rupees('not_credited', 'Deducted by buyers, not in the tax statement', totalOf(SET.buyerTds, 'not_credited'), { section: 'buyers' }),
      standing(
        'credit_standing',
        'Buyers’ deductions',
        [{ when: rule('at_most', ['not_credited'], '{a} deducted by buyers is not in the tax statement.', 'medium', { against: 0 }), label: 'Credits missing from the tax statement', tone: 'warning' }],
        { label: 'Credited', tone: 'good' },
        { section: 'buyers' },
      ),
    ],
    rules: [
      rule('at_most', ['months_late'], 'Months in which tax deducted was deposited late: {a}.', 'high', { against: 0 }),
      rule('at_most', ['undeposited'], '{a} deducted is not yet deposited.', 'medium', { against: 0 }),
      rule('at_most', ['not_credited'], '{a} deducted by buyers is not in the tax statement.', 'medium', { against: 0 }),
    ],
  },
  {
    id: SET.tdsMonths,
    fn: TAX,
    title: 'Tax deducted by month',
    v: 1,
    records: { of: 'month', titleField: 'month', summaryFields: ['deducted', 'month_standing'] },
    periodic: { every: 'month', by: 'month', due: { rate: 'tds_deposit_due_day' }, issuer: 'lead' },
    optionSets: [
      options('tds_month_kind', 'Month', [
        ['ordinary', 'Ordinary'],
        ['year_end', 'Last of the year'],
      ]),
    ],
    fields: [
      day('month', 'Month beginning'),
      choice('month_kind', 'Month', 'tds_month_kind', {
        control: 'segmented',
        defaults: [{ value: 'ordinary', from: 'catalog', cite: 'Eleven months of twelve; the last month of the year has a due day of its own in the rule table.' }],
      }),
      money('deducted', 'Deducted in the month', { from: 'Books' }),
      worked('due_on', 'Deposit due on', addDays(addMonths(dateOf('month'), n(1)), minus(rate('tds_deposit_due_day', undefined, { month: { field: 'month_kind' } }), n(1))), { yields: 'date' }),
      money('deposited', 'Deposited', { required: false, from: 'Challans' }),
      day('deposited_on', 'Deposited on', { required: false }),
      text('challan', 'Challan number', { required: false }),
      rupees('undeposited', 'Not yet deposited', minus(f('deducted'), orZero('deposited'))),
      worked(
        'days_late',
        'Days late',
        when({ field: 'deposited_on', is: 'set' }, minus(dateOf('deposited_on'), dateOf('due_on')), when({ left: f('undeposited'), is: 'gt', right: n(0) }, minus(today, dateOf('due_on')), n(0))),
        { unit: 'days', precision: 0 },
      ),
      standing('month_standing', 'Deposit', [{ when: rule('at_most', ['days_late'], 'The deposit is {a} late.', 'high', { against: 0 }), label: 'Late', tone: 'critical' }], { label: 'In time', tone: 'good' }),
    ],
    rules: [rule('at_most', ['days_late'], 'The deposit is {a} late.', 'high', { against: 0 })],
  },
  {
    id: SET.tdsStatements,
    fn: TAX,
    title: 'Quarterly statements of tax deducted',
    v: 1,
    records: { of: 'statement', titleField: 'quarter_end', summaryFields: ['filed_on'] },
    // What the statement is called holds from quarter to quarter; when it was filed and under what number is each quarter's own.
    periodic: { every: 'quarter', by: 'quarter_end', carry: ['statement_name'], due: { rate: 'tds_statement_due_days' }, issuer: 'lead' },
    fields: [
      day('quarter_end', 'Quarter ending'),
      text('statement_name', 'Statement, as the acknowledgement names it', { required: false }),
      day('filed_on', 'Filed on'),
      text('acknowledgement', 'Acknowledgement number'),
      tick('certificates_issued', 'Certificates issued to payees'),
      paper('paper', 'Acknowledgement'),
    ],
    rules: [rule('before', ['quarter_end', 'filed_on'], 'Filed on {b}, before the quarter ended on {a}.', 'low')],
  },
  {
    id: SET.propertyTds,
    fn: TAX,
    title: 'Tax deducted on property bought',
    v: 1,
    records: { of: 'purchase', titleField: 'seller', summaryFields: ['tax_due', 'purchase_standing'] },
    fields: [
      link('seller', 'Seller', 'party'),
      paper('deed', 'Sale deed', { viewer: 'deed' }),
      money('consideration', 'Consideration', { from: 'Sale deed' }),
      money('stamp_value', 'Stamp duty value', { required: false, from: 'Kaveri guidance value' }),
      day('paid_on', 'Paid or credited on'),
      rupees('threshold', 'Value from which tax is deducted', rate('tds_property_threshold', 'paid_on')),
      share('tax_rate', 'Rate', rate('tds_property_purchase', 'paid_on')),
      rupees('tax_due', 'Tax to deduct', when({ left: most(f('consideration'), f('stamp_value')), is: 'gte', right: f('threshold') }, pctOf(f('consideration'), f('tax_rate')), n(0))),
      money('tax_deducted', 'Tax deducted', { required: false }),
      text('acknowledgement', 'Acknowledgement of the challan-cum-statement', { required: false }),
      day('deposited_on', 'Deposited on', { required: false }),
      paper('certificate', 'Certificate issued to the seller'),
      standing(
        'purchase_standing',
        'Deduction',
        [
          { when: rule('compare', ['tax_deducted', 'tax_due'], '{a} was deducted and {b} is due.', 'high', { tolerance: 0.001 }), label: 'Deducted differs from what is due', tone: 'critical' },
          { when: rule('require_if', ['tax_deducted', 'deposited_on'], '{a} was deducted and no deposit is recorded.', 'medium'), label: 'Deducted, not shown as deposited', tone: 'warning' },
        ],
        { label: 'Deducted and deposited', tone: 'good' },
      ),
    ],
    rules: [
      rule('compare', ['tax_deducted', 'tax_due'], '{a} was deducted and {b} is due.', 'high', { tolerance: 0.001 }),
      rule('require_if', ['tax_deducted', 'deposited_on'], '{a} was deducted and no deposit is recorded.', 'medium'),
    ],
  },
  {
    id: SET.buyerTds,
    fn: TAX,
    title: 'Tax deducted by buyers',
    v: 1,
    records: { of: 'deduction', titleField: 'unit', summaryFields: ['deducted', 'deduction_standing'] },
    fields: [
      link('unit', 'Unit', 'unit'),
      link('buyer', 'Buyer', 'party', { required: false }),
      money('consideration', 'Consideration of the unit', { from: 'Agreement for sale' }),
      day('as_at', 'As at'),
      money('received', 'Received to date, before tax', { from: 'Receipts' }),
      rupees('expected', 'Tax expected', when({ left: f('consideration'), is: 'gte', right: rate('tds_property_threshold', 'as_at') }, pctOf(f('received'), rate('tds_property_purchase', 'as_at')), n(0))),
      money('deducted', 'Deducted by the buyer', { from: 'Buyer’s challan-cum-statement' }),
      text('acknowledgement', 'Acknowledgement number', { required: false }),
      paper('certificate', 'Certificate from the buyer'),
      money('credited', 'Credit in the tax statement', { required: false, from: 'Tax credit statement (26AS)' }),
      rupees('not_credited', 'Not in the tax statement', minus(f('deducted'), orZero('credited'))),
      standing(
        'deduction_standing',
        'Deduction',
        [
          { when: rule('compare', ['deducted', 'expected'], 'The buyer deducted {a} and {b} was expected.', 'medium', { tolerance: 0.01 }), label: 'Differs from what was expected', tone: 'warning' },
          { when: rule('at_most', ['not_credited'], '{a} deducted by the buyer is not in the tax statement.', 'medium', { against: 0 }), label: 'Not in the tax statement', tone: 'warning' },
        ],
        { label: 'Credited', tone: 'good' },
      ),
    ],
    rules: [
      rule('compare', ['deducted', 'expected'], 'The buyer deducted {a} and {b} was expected.', 'medium', { tolerance: 0.01 }),
      rule('at_most', ['not_credited'], '{a} deducted by the buyer is not in the tax statement.', 'medium', { against: 0 }),
    ],
  },

  /* ================================================================== */
  /* Stamp duty and registration                                         */
  /* ================================================================== */
  {
    id: SET.duty,
    fn: TAX,
    title: 'Stamp duty and registration',
    v: 1,
    sections: [{ key: 'duty', label: `Duty and fees: ${NOT_ADVICE}`, showWhen: { records: SET.instruments, is: 'any' } }],
    fields: [
      rupees('worked_out', 'Duty and fees worked out', totalOf(SET.instruments, 'total_duty'), { section: 'duty' }),
      rupees('paid', 'Duty and fees paid', totalOf(SET.instruments, 'paid'), { section: 'duty' }),
      rupees('paid_less_worked_out', 'Paid less worked out', minus(f('paid'), f('worked_out')), { section: 'duty' }),
      worked('priced_below_tolerance', 'Instruments priced below the stamp value, beyond the tolerance', tallyWhere(SET.instruments, { column: 'below_tolerance_by', is: 'gt', value: 0 }), { section: 'duty', precision: 0 }),
      mirror('guidance_rate_in_valuation', 'Guidance rate a square metre, held by Valuation', 'money', EXISTING.guidanceRate, { section: 'duty', dimension: 'money', currency: 'INR' }),
      standing(
        'duty_standing',
        'Duty',
        [
          { when: rule('at_most', ['priced_below_tolerance'], 'Instruments priced below the stamp value by more than the tolerance: {a}.', 'high', { against: 0 }), label: 'A price is below the stamp value tolerance', tone: 'critical' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'duty' },
      ),
    ],
    rules: [
      rule('at_most', ['priced_below_tolerance'], 'Instruments priced below the stamp value by more than the tolerance: {a}.', 'high', { against: 0 }),
    ],
  },
  {
    id: SET.instruments,
    fn: TAX,
    title: 'Duty by instrument',
    v: 1,
    records: { of: 'instrument', titleField: 'instrument', summaryFields: ['executed_on', 'total_duty', 'duty_standing'] },
    optionSets: [
      options('tax_instrument_kind', 'Instrument', [
        ['sale_deed', 'Sale deed'],
        ['agreement_to_sell', 'Agreement to sell'],
        ['joint_development_agreement', 'Joint development agreement'],
        ['power_of_attorney', 'Power of attorney'],
        ['mortgage', 'Mortgage deed'],
        ['deposit_of_title_deeds', 'Memorandum of deposit of title deeds'],
        ['lease', 'Lease'],
        ['rectification', 'Rectification deed'],
      ]),
      options('tax_locality_kind', 'Locality', [
        ['urban', 'Urban'],
        ['rural', 'Rural'],
      ]),
      options('duty_borne_by', 'Borne by', [
        ['firm', 'The firm'],
        ['buyer', 'The buyer'],
        ['landowner', 'The landowner'],
        ['shared', 'Shared'],
      ]),
    ],
    sections: [
      { key: 'instrument', label: 'Instrument' },
      { key: 'value', label: 'Value' },
      { key: 'duty', label: 'Duty and fees' },
    ],
    fields: [
      choice('instrument', 'Instrument', 'tax_instrument_kind', { section: 'instrument' }),
      paper('deed', 'Instrument as executed', { section: 'instrument', viewer: 'deed' }),
      day('executed_on', 'Executed on', { section: 'instrument' }),
      link('parcel', 'Parcel', 'parcel', { section: 'instrument', required: false }),
      choice('locality', 'Locality', 'tax_locality_kind', { section: 'instrument', control: 'segmented' }),
      choice('borne_by', 'Borne by', 'duty_borne_by', { section: 'instrument', required: false, control: 'segmented' }),
      money('consideration', 'Consideration', { section: 'value', from: 'The instrument' }),
      area('extent', 'Extent or area conveyed', { section: 'value', enterIn: ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare'], from: 'The instrument' }),
      money('guidance_rate', 'Guidance rate a square metre, on that day', { section: 'value', required: false, from: 'Kaveri guidance value' }),
      rupees('stamp_value', 'Stamp duty value', times(f('extent'), f('guidance_rate')), { section: 'value' }),
      rupees('dutiable_value', 'Value duty is charged on', most(f('consideration'), f('stamp_value')), { section: 'value' }),
      rupees(
        'below_tolerance_by',
        'Price below the stamp value, beyond the tolerance',
        minus(pctOf(f('stamp_value'), minus(n(100), rate('stamp_value_tolerance', 'executed_on'))), f('consideration')),
        { section: 'value' },
      ),
      rupees('stamp_duty', 'Stamp duty', pctOf(f('dutiable_value'), rate('ka_stamp_duty_sale', 'executed_on', { instrument: { field: 'instrument' }, dutiable_value: { field: 'dutiable_value' } })), { section: 'duty' }),
      rupees('cess', 'Cess', pctOf(f('stamp_duty'), rate('ka_cess', 'executed_on')), { section: 'duty' }),
      rupees('surcharge', 'Surcharge', pctOf(f('stamp_duty'), rate('ka_surcharge', 'executed_on', { locality: { field: 'locality' } })), { section: 'duty' }),
      rupees('registration_fee', 'Registration fee', pctOf(f('dutiable_value'), rate('ka_registration_fee', 'executed_on')), { section: 'duty' }),
      rupees('total_duty', 'Duty and fees in total', plus(f('stamp_duty'), f('cess'), f('surcharge'), f('registration_fee')), { section: 'duty' }),
      money('paid', 'Duty and fees paid', { section: 'duty', from: 'E-stamp certificate and registration receipt' }),
      standing(
        'duty_standing',
        'Duty',
        [
          { when: rule('at_most', ['below_tolerance_by'], 'The price is below the stamp duty value by {a} more than the tolerance allows.', 'high', { against: 0 }), label: 'Price below the stamp value tolerance', tone: 'critical' },
          { when: rule('compare', ['paid', 'total_duty'], '{a} was paid and {b} is worked out.', 'medium', { tolerance: 0.01 }), label: 'Paid differs from worked out', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'duty' },
      ),
    ],
    rules: [
      rule('at_most', ['below_tolerance_by'], 'The price is below the stamp duty value by {a} more than the tolerance allows.', 'high', { against: 0 }),
      rule('compare', ['paid', 'total_duty'], '{a} was paid and {b} is worked out.', 'medium', { tolerance: 0.01 }),
    ],
  },

  /* ================================================================== */
  /* Khata and property tax                                              */
  /* ================================================================== */
  {
    id: SET.properties,
    fn: TAX,
    title: 'Khata and assessed property',
    v: 1,
    records: { of: 'property', titleField: 'pid', summaryFields: ['khata', 'holder'] },
    optionSets: [
      options('tax_khata_kind', 'Khata', [
        ['A-Khata', 'A khata', 'good'],
        ['B-Khata', 'B khata', 'warning'],
        ['E-Khata', 'E-khata', 'good'],
        ['panchayat', 'Panchayat khata', 'info'],
      ]),
      options('property_tax_authority', 'Taxing authority', [
        ['city_corporation', 'City corporation'],
        ['city_municipal_council', 'City municipal council'],
        ['gram_panchayat', 'Gram panchayat'],
        ['development_authority', 'Development authority'],
        ['other', 'Other'],
      ]),
      options('property_assessed_use', 'Use assessed', [
        ['residential_self_occupied', 'Residential, self-occupied'],
        ['residential_let', 'Residential, let'],
        ['non_residential', 'Non-residential'],
        ['vacant_land', 'Vacant land'],
        ['under_construction', 'Under construction'],
      ]),
    ],
    fields: [
      text('pid', 'Property identification number', { from: 'Khata extract', fromTypes: [PAPER.khata, PAPER.taxReceipt] }),
      link('parcel', 'Parcel', 'parcel', { required: false }),
      link('building', 'Building', 'building', { required: false }),
      choice('authority', 'Taxing authority', 'property_tax_authority'),
      choice('khata', 'Khata', 'tax_khata_kind', { control: 'segmented', from: 'Khata certificate', fromTypes: [PAPER.khata], factKey: 'khata_type' }),
      link('holder', 'Khata in the name of', 'party'),
      choice('assessed_use', 'Use assessed', 'property_assessed_use'),
      area('assessed_area', 'Area assessed', { from: 'Self-assessment form' }),
      paper('khata_paper', 'Khata certificate and extract'),
    ],
    rules: [],
  },
  {
    id: SET.propertyTaxYears,
    fn: TAX,
    title: 'Property tax by year',
    v: 1,
    records: { of: 'year', titleField: 'year', summaryFields: ['paid', 'year_standing'] },
    // The year as the receipt writes it names the period; a property's demand is where the next year starts. Due within the year it is for.
    periodic: { every: 'year', by: 'year', per: ['property'], carry: ['demand'], due: { days: 0 }, issuer: 'lead' },
    fields: [
      text('year', 'Assessment year', { from: 'Property tax receipt', fromTypes: [PAPER.taxReceipt], factKey: 'tax_year' }),
      link('property', 'Property', { set: SET.properties }),
      money('demand', 'Demand for the year', { from: 'Demand or self-assessment' }),
      money('paid', 'Paid', { from: 'Property tax receipt', fromTypes: [PAPER.taxReceipt], factKey: 'tax_paid' }),
      day('paid_on', 'Paid on', { required: false, from: 'Property tax receipt', fromTypes: [PAPER.taxReceipt], factKey: 'tax_paid_on' }),
      rupees('arrears', 'Arrears', minus(f('demand'), orZero('paid'))),
      paper('receipt', 'Receipt'),
      standing('year_standing', 'Year', [{ when: rule('at_most', ['arrears'], '{a} of the year’s property tax is unpaid.', 'high', { against: 0 }), label: 'In arrears', tone: 'critical' }], { label: 'Paid', tone: 'good' }),
    ],
    rules: [rule('at_most', ['arrears'], '{a} of the year’s property tax is unpaid.', 'high', { against: 0 })],
  },

  /* ================================================================== */
  /* Joint development: the tax facts                                    */
  /* ================================================================== */
  {
    id: SET.jda,
    fn: TAX,
    title: 'Joint development: the facts',
    v: 1,
    optionSets: [
      options('jda_land_held_as', 'Owner holds the land as', [
        ['capital_asset', 'Capital asset'],
        ['stock_in_trade', 'Stock in trade'],
      ]),
      options('jda_sharing', 'Sharing', [
        ['area', 'Area'],
        ['revenue', 'Revenue'],
        ['both', 'Both'],
      ]),
    ],
    sections: [
      { key: 'agreement', label: `Agreement: ${NOT_ADVICE}`, showWhen: IF_JOINT },
      { key: 'owner', label: 'What the owner receives', showWhen: IF_JOINT },
    ],
    fields: [
      paper('agreement', 'Joint development agreement', { section: 'agreement', viewer: 'deed' }),
      day('executed_on', 'Executed on', { section: 'agreement', from: 'The agreement', fromTypes: [PAPER.jda] }),
      { key: 'registered', label: 'Registered', kind: 'boolean', control: 'switch', section: 'agreement', from: 'The agreement' },
      link('owner', 'Landowner', 'party', { section: 'agreement' }),
      choice('land_held_as', 'Owner holds the land as', 'jda_land_held_as', { section: 'agreement', required: false, control: 'segmented', from: 'Owner’s accountant' }),
      choice('sharing', 'Sharing', 'jda_sharing', { section: 'agreement', control: 'segmented', from: 'The agreement', fromTypes: [PAPER.jda] }),
      percent('owner_share', 'Owner’s share', { section: 'agreement', from: 'The agreement', fromTypes: [PAPER.jda] }),
      {
        key: 'owner_units',
        label: 'Units allotted to the owner',
        kind: 'table',
        section: 'owner',
        from: 'Allocation agreement',
        columns: [link('unit', 'Unit', 'unit'), money('stamp_value', 'Stamp duty value at completion')],
      },
      rupees('owner_units_value', 'Stamp duty value of the owner’s units', { op: 'sum', table: 'owner_units', column: 'stamp_value' }, { section: 'owner' }),
      rupees('paid_outright', 'Money paid to the owner, not refundable', totalWhere(SET.jdaPayments, 'amount', { column: 'kind', is: 'equals', value: 'non_refundable' }), { section: 'owner' }),
      rupees('owner_receives', 'What the owner receives, as the facts stand', plus(f('owner_units_value'), orZero('paid_outright')), { section: 'owner' }),
      mirror('completion_on', 'Completion or occupancy certificate dated', 'date', EXISTING.occupancyDate, { section: 'owner' }),
    ],
    rules: [rule('require_if', ['completion_on', 'owner_units'], 'Completion is dated {a} and the owner’s units are not listed.', 'medium', { when: IF_JOINT })],
  },
  {
    id: SET.jdaTax,
    fn: TAX,
    title: 'Joint development: tax at completion',
    v: 1,
    sections: [
      { key: 'values', label: `Values from the accountant: ${NOT_ADVICE}`, showWhen: IF_JOINT },
      { key: 'position', label: 'Position', showWhen: IF_JOINT },
    ],
    fields: [
      money('construction_value', 'Value of construction supplied to the owner', { section: 'values', from: 'Accountant’s valuation' }),
      money('gst_on_owner_units', 'GST on the owner’s units', { section: 'values', from: 'Accountant’s working' }),
      money('rights_value', 'Value of development rights received', { section: 'values', from: 'Accountant’s valuation' }),
      percent('unbooked_at_completion', 'Carpet area unbooked at completion', { section: 'values', required: false }),
      money('reverse_charge', 'Reverse charge on development rights', { section: 'values', required: false, from: 'Accountant’s working' }),
      mirror('completion_on', 'Completion or occupancy certificate dated', 'date', EXISTING.occupancyDate, { section: 'position' }),
      day('reverse_charge_paid_on', 'Reverse charge paid on', { section: 'position', required: false }),
      rupees('deduction_due', 'Tax to deduct on money paid to the owner', totalOf(SET.jdaPayments, 'tax_due'), { section: 'position' }),
      rupees('deduction_made', 'Tax deducted on money paid to the owner', totalOf(SET.jdaPayments, 'tax_deducted'), { section: 'position' }),
      paper('opinion', 'Accountant’s opinion', { section: 'position' }),
      standing(
        'position_standing',
        'Tax position',
        [
          { when: rule('require_if', ['completion_on', 'reverse_charge_paid_on'], 'Completion is dated {a} and the reverse charge on development rights is not shown as paid.', 'high'), label: 'Completion reached, reverse charge not shown as paid', tone: 'critical' },
          { when: rule('compare', ['deduction_made', 'deduction_due'], '{a} was deducted on money paid to the owner and {b} is due.', 'medium', { tolerance: 0.001 }), label: 'Tax deducted differs from what is due', tone: 'warning' },
          { when: rule('require', ['opinion'], 'There is no accountant’s opinion on the joint development on file.', 'medium'), label: 'No accountant’s opinion on file', tone: 'warning' },
        ],
        { label: 'Opinion on file', tone: 'good' },
        { section: 'position' },
      ),
    ],
    rules: [
      rule('require_if', ['completion_on', 'reverse_charge_paid_on'], 'Completion is dated {a} and the reverse charge on development rights is not shown as paid.', 'high', { when: IF_JOINT }),
      rule('compare', ['deduction_made', 'deduction_due'], '{a} was deducted on money paid to the owner and {b} is due.', 'medium', { tolerance: 0.001, when: IF_JOINT }),
      rule('require', ['opinion'], 'There is no accountant’s opinion on the joint development on file.', 'medium', { when: IF_JOINT }),
    ],
  },
  {
    id: SET.jdaPayments,
    fn: TAX,
    title: 'Money paid to the landowner',
    v: 1,
    records: { of: 'payment', titleField: 'paid_on', summaryFields: ['amount', 'kind'] },
    optionSets: [
      options('jda_payment_kind', 'Paid as', [
        ['non_refundable', 'Not refundable'],
        ['refundable_deposit', 'Refundable deposit'],
        ['adjustable_advance', 'Advance to be adjusted'],
      ]),
      options('jda_deduct_view', 'Accountant’s view', [
        ['deduct', 'Deduct'],
        ['do_not_deduct', 'Do not deduct'],
      ]),
    ],
    sections: [{ key: 'payment', label: 'Payment', showWhen: IF_JOINT }],
    fields: [
      day('paid_on', 'Paid on', { section: 'payment' }),
      money('amount', 'Amount', { section: 'payment', from: 'Voucher' }),
      choice('kind', 'Paid as', 'jda_payment_kind', { section: 'payment', control: 'segmented' }),
      only(
        { field: KIND_OF_PAYMENT, is: 'in', value: ['refundable_deposit', 'adjustable_advance'] },
        choice('accountant_view', 'Accountant’s view on deducting tax', 'jda_deduct_view', { section: 'payment', control: 'segmented', required: false }),
      ),
      share('tax_rate', 'Rate', rate('tds_jda_cash', 'paid_on'), { section: 'payment' }),
      rupees(
        'tax_due',
        'Tax to deduct',
        when(
          { any: [{ field: 'kind', is: 'equals', value: 'non_refundable' }, { field: 'accountant_view', is: 'equals', value: 'deduct' }] },
          pctOf(f('amount'), f('tax_rate')),
          when({ field: 'accountant_view', is: 'equals', value: 'do_not_deduct' }, n(0), nothing),
        ),
        { section: 'payment' },
      ),
      money('tax_deducted', 'Tax deducted', { section: 'payment', required: false }),
      text('challan', 'Challan number', { section: 'payment', required: false }),
      paper('voucher', 'Voucher', { section: 'payment' }),
      standing(
        'payment_standing',
        'Deduction',
        [
          { when: rule('compare', ['tax_deducted', 'tax_due'], '{a} was deducted and {b} is due.', 'high', { tolerance: 0.001 }), label: 'Deducted differs from what is due', tone: 'critical' },
          { when: rule('require_if', ['kind', 'accountant_view'], 'Paid as {a}: the accountant has not said whether tax is deducted.', 'medium', { whenIn: ['refundable_deposit', 'adjustable_advance'] }), label: 'Accountant’s view needed', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'payment' },
      ),
    ],
    rules: [
      rule('compare', ['tax_deducted', 'tax_due'], '{a} was deducted and {b} is due.', 'high', { tolerance: 0.001 }),
      rule('require_if', ['kind', 'accountant_view'], 'Paid as {a}: the accountant has not said whether tax is deducted.', 'medium', { whenIn: ['refundable_deposit', 'adjustable_advance'] }),
    ],
  },
  /* ================================================================== */
  /* The construction workers' welfare cess                              */
  /* ================================================================== */
  // Assessed on the cost of construction and paid by the employer. The site's establishment sheet reads what is unpaid from here.
  {
    id: SET.welfareCess,
    fn: TAX,
    title: 'Construction workers’ welfare cess',
    v: 1,
    fields: [
      money('cost_assessed', 'Cost of construction the cess is assessed on', { dueFrom: 'construction', from: 'Assessment order' }),
      // The rest follows the assessment, and stays out of sight until there is one.
      only(ASSESSED, share('cess_rate', 'Rate of cess', rate('bocw_welfare_cess_pct'))),
      only(ASSESSED, rupees('payable', 'Cess payable', pctOf(f('cost_assessed'), f('cess_rate')))),
      only(ASSESSED, money('cess_paid', 'Cess paid', { required: false, from: 'Challan' })),
      only(ASSESSED, day('paid_on', 'Paid on', { required: false, from: 'Challan' })),
      only(ASSESSED, rupees('unpaid', 'Assessed and not paid', minus(f('payable'), orZero('cess_paid')))),
      only(ASSESSED, paper('assessment_order', 'Assessment order')),
      only(ASSESSED, paper('challan', 'Challan')),
      only(
        ASSESSED,
        standing(
          'cess_standing',
          'Welfare cess',
          [{ when: rule('at_most', ['unpaid'], '{a} of welfare cess is assessed and not paid.', 'medium', { against: 0 }), label: 'Cess unpaid', tone: 'warning' }],
          { label: 'Paid', tone: 'good' },
        ),
      ),
    ],
    rules: [rule('at_most', ['unpaid'], '{a} of welfare cess is assessed and not paid.', 'medium', { against: 0 })],
  },
];
