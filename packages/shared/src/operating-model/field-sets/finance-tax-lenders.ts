/**
 * The field sets of Finance (funding, cash, the RERA account, receivables),
 * Tax, Lenders and Ledgers, and the rule rows their formulas read.
 *
 * Each department's sets are a file of its own under `finance/`, with the
 * rule rows beside them; this file is the one the index registers.
 */

import type { CheckFieldDef, CheckFormula, FieldAddress, FieldReportTemplate, FieldSet, ShowWhen } from '../types';
import { withLinks, type SetLinks } from './builders';
import { FUNDING_SETS } from './finance/funding';
import { LEDGER_SETS } from './finance/ledgers';
import { LENDER_SETS } from './finance/lenders';
import { TAX_SETS } from './finance/tax';

export { FINANCE_RULE_ROWS } from './finance/rule-rows';

/* ==================================================================== */
/* What Finance, Tax, Lenders and Ledgers read from other departments    */
/* ==================================================================== */

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
const INR = { dimension: 'money', currency: 'INR' } as const;
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });
/** A figure of the record a link of this record holds: the agreed value of this ledger's unit. */
const ofLinked = (via: string, address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address, via });
/** A figure summed over another department's records that name this record's own link: the receipts against this ledger's unit. */
const sumForOwn = (records: string, column: string, joinOn: string, own: string): CheckFormula => ({ op: 'sum_if', over: { records }, column, where: { column: joinOn, is: 'own', value: own } });
/** The working behind a rule: worked out, folded, never typed. */
const working = (key: string, label: string, formula: CheckFormula, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, tier: 'expert', ...more });

const DEMANDS = 'commercial.buyers.demands';
const SALES_KEEPS_DEMANDS: ShowWhen = { records: DEMANDS, is: 'any' };
const COLLECTIONS = (field: string) => at('commercial.buyers', 'commercial.buyers.collections', field);
const UNIT = (field: string) => at('shared', 'shared.units', field);
const JDA = (field: string) => at('legal.contracts', 'legal.contracts.jda', field);
const WITH_JDA: ShowWhen = { situation: 'joint_development' };

const each = (fn: string, set: string, fields: string[]): FieldAddress[] => fields.map((field) => at(fn, set, field));
const FUNDING = 'finance.funding';
const LENDERS = 'finance.lenders';
const TAX = 'finance.tax';

/** The quarter's statement of the designated account: cost, what may be withdrawn, what was deposited, and the certificates behind it. */
const RERA_ACCOUNT_REPORT: FieldReportTemplate = {
  id: 'finance.funding.rera_account.report',
  title: 'Designated account, the quarter',
  sections: [
    { heading: 'Project cost', fields: ['quarter_end', 'construction_estimated', 'construction_per_engineer', 'construction_per_books', 'construction_counted', 'total_estimated', 'total_incurred', 'balance_cost', 'cost_standing'] },
    { heading: 'Land and other development cost, by head', table: 'cost_rows' },
    { heading: 'Withdrawal', fields: each(FUNDING, 'finance.funding.rera_withdrawal', ['completion_by_cost', 'completion_by_architect', 'completion_gap', 'by_cost', 'withdrawable_certified', 'withdrawn_to_date', 'net_withdrawable', 'withdrawal_standing']) },
    { heading: 'Deposit', fields: each(FUNDING, 'finance.funding.rera_deposit', ['realised', 'deposited', 'deposit_share', 'required_share', 'receivable_sold', 'unsold_carpet', 'estimated_receivables', 'deposit_standing']) },
    { heading: 'Certificates', records: 'finance.funding.rera_certificates', columns: ['kind', 'period_end', 'signed_by', 'signed_on'] },
    { heading: 'Accountant’s remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

/** Funding and cash: the plan, where cash stands month by month, and what customers owe. */
const FUNDING_REPORT: FieldReportTemplate = {
  id: 'finance.funding.report',
  title: 'Funding and cash report',
  sections: [
    { heading: 'Funding plan', fields: each(FUNDING, 'finance.funding.plan', ['project_cost', 'planned_total', 'uncovered', 'brought_in_total', 'equity_planned', 'debt_planned', 'advances_planned', 'peak_funding', 'plan_standing']) },
    { heading: 'Sources of funds', records: 'finance.funding.sources', columns: ['kind', 'party', 'planned', 'brought_in'] },
    { heading: 'Cash', fields: ['as_at', 'opening_balance', 'net_to_date', 'bank_total', 'collections_to_date', 'net_against_plan', 'lowest_forecast', 'buyers_due_within_month', 'buyers_overdue', 'cash_standing'] },
    { heading: 'Net cash by month', chart: { of: { records: 'finance.funding.cash_months' }, x: 'month', y: 'net', mark: 'line' } },
    { heading: 'Receivables', fields: each(FUNDING, 'finance.funding.receivables', ['as_at', 'agreement_value', 'demanded', 'collected', 'outstanding', 'collection_efficiency', 'receivables_standing']) },
    { heading: 'Outstanding by age', chart: { of: at(FUNDING, 'finance.funding.receivables', 'ageing'), x: 'bucket', y: 'amount' } },
    { heading: 'Remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

/** The lender's pack: the loan, what is drawn against what is eligible, the covenants and the dates committed. */
const LENDER_REPORT: FieldReportTemplate = {
  id: 'finance.lenders.report',
  title: 'Lender’s pack',
  sections: [
    { heading: 'Facilities', records: 'finance.lenders.facilities', columns: ['name', 'lender', 'sanctioned_amount', 'rate_now', 'availability_end'] },
    { heading: 'Loan position', fields: ['drawn', 'repaid', 'outstanding', 'interest_paid', 'days_past_due', 'position_standing'] },
    { heading: 'Drawn against eligible', fields: each(LENDERS, 'finance.lenders.drawdown', ['sanctioned', 'drawn', 'undrawn', 'eligible', 'headroom', 'headroom_standing']) },
    { heading: 'Drawdowns', records: 'finance.lenders.drawdowns', columns: ['tranche', 'planned_on', 'requested_amount', 'disbursed_on', 'disbursed_amount'] },
    { heading: 'Security', fields: each(LENDERS, 'finance.lenders.security', ['security_value', 'outstanding', 'cover', 'value_per_valuation']) },
    { heading: 'Conditions and covenants', fields: each(LENDERS, 'finance.lenders.compliance', ['conditions_holding_drawdown', 'conditions_overdue', 'covenants_breached', 'covenant_standing']) },
    { heading: 'Covenants', records: 'finance.lenders.covenants', columns: ['covenant', 'threshold', 'actual', 'tested_on', 'covenant_standing'] },
    { heading: 'Completion and cost', fields: each(LENDERS, 'finance.lenders.limits', ['completion_committed', 'completion_forecast', 'deferment', 'completion_standing', 'overrun', 'overrun_standing']) },
    { heading: 'Remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

/** The tax position: GST charged against expected, tax deducted and deposited, and duty paid against duty worked out. A record for the accountant, not advice. */
const TAX_REPORT: FieldReportTemplate = {
  id: 'finance.tax.report',
  title: 'Tax position',
  sections: [
    { heading: 'GST on units sold', fields: ['scheme_generation', 'project_class', 'gst_expected', 'gst_charged', 'gst_unpaid', 'charge_standing'] },
    { heading: 'GST by month', records: 'finance.tax.gst_months', columns: ['month', 'tax_payable', 'tax_paid', 'paid_on', 'month_standing'] },
    { heading: 'Tax deducted at source', fields: each(TAX, 'finance.tax.tds', ['deducted', 'undeposited', 'months_late', 'deposit_standing', 'buyers_expected', 'buyers_deducted', 'credit_standing']) },
    { heading: 'Stamp duty and registration', fields: each(TAX, 'finance.tax.duty', ['worked_out', 'paid', 'paid_less_worked_out', 'duty_standing']) },
    { heading: 'Duty by instrument', records: 'finance.tax.instruments', columns: ['instrument', 'executed_on', 'consideration', 'total_duty', 'paid', 'duty_standing'] },
    { heading: 'Accountant’s remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds. This is a record, not advice.' } },
  ],
};

const LINKS: SetLinks[] = [
  /* --- Funding --------------------------------------------------------- */
  { set: 'finance.funding.rera_cost', reports: [RERA_ACCOUNT_REPORT] },
  { set: 'finance.tax.gst', reports: [TAX_REPORT] },
  { set: 'finance.lenders.position', reports: [LENDER_REPORT] },
  {
    set: 'finance.funding.plan',
    // The most the scheme is out of pocket is the appraisal's figure: the sources planned are held to it.
    fields: [mirror('peak_funding', 'Peak funding need, per the appraisal', 'money', at('finance.feasibility', 'finance.feasibility.returns', 'peak_funding'), { ...INR, section: 'cost', tier: 'situational', showWhen: { records: 'finance.feasibility.periods', is: 'any' } })],
    rules: [{ kind: 'at_least', fields: ['planned_total', 'peak_funding'], say: 'Sources of {a} are planned and the appraisal’s cash flow needs {b} at its deepest.', severity: 'high' }],
  },
  {
    set: 'finance.funding.cash',
    reports: [FUNDING_REPORT],
    fields: [
      mirror('buyers_due_within_month', 'Falling due from buyers within a month, per Collections', 'money', at('commercial.buyers', 'commercial.buyers.dues', 'due_within_month'), { ...INR, tier: 'situational', showWhen: SALES_KEEPS_DEMANDS }),
      mirror('buyers_overdue', 'Overdue from buyers, per Collections', 'money', at('commercial.buyers', 'commercial.buyers.dues', 'overdue'), { ...INR, tier: 'situational', showWhen: SALES_KEEPS_DEMANDS }),
    ],
  },
  {
    set: 'finance.funding.receivables',
    // Receivables are stated as at a day, from the sales register. Where Sales keeps its demands here, each total is held to them.
    rules: [
      { kind: 'compare', fields: ['agreement_value', 'booked'], at: { booked: at('commercial.inventory', 'commercial.inventory.bookings', 'value_booked') }, when: SALES_KEEPS_DEMANDS, say: 'Receivables carry {a} of agreement value and Sales’ units come to {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['demanded', 'demanded_per_sales'], at: { demanded_per_sales: COLLECTIONS('demanded') }, when: SALES_KEEPS_DEMANDS, say: 'Receivables carry {a} demanded and Collections’ demands come to {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['collected', 'received_per_sales'], at: { received_per_sales: COLLECTIONS('received') }, when: SALES_KEEPS_DEMANDS, say: 'Receivables carry {a} collected and Collections’ receipts come to {b}.', severity: 'high' },
    ],
  },
  {
    set: 'finance.funding.rera_deposit',
    fields: [
      working('receivable_per_sales', 'Receivable on units sold, per Sales', { op: 'subtract', left: { op: 'field', key: 'value_booked', at: at('commercial.inventory', 'commercial.inventory.bookings', 'value_booked') }, right: { op: 'field', key: 'received', at: COLLECTIONS('received') } }, { ...INR, section: 'ahead' }),
      mirror('unsold_carpet_per_sales', 'Carpet area in stock, per Sales', 'area', at('commercial.inventory', 'commercial.inventory.stock', 'unsold_carpet_area'), { dimension: 'area', section: 'ahead', tier: 'expert' }),
    ],
    rules: [
      { kind: 'compare', fields: ['receivable_sold', 'receivable_per_sales'], when: SALES_KEEPS_DEMANDS, tolerance: 0.02, say: 'The statement carries {a} receivable on units sold and Sales’ records come to {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['unsold_carpet', 'unsold_carpet_per_sales'], when: { records: 'shared.units', is: 'any', where: { column: 'sale_released', is: 'true' } }, tolerance: 0.02, say: 'The statement carries {a} of carpet area unsold and Sales’ units come to {b}.', severity: 'medium' },
    ],
  },
  {
    set: 'finance.funding.rera_cost',
    rules: [{ kind: 'compare', fields: ['balance_cost', 'cost_to_complete'], at: { cost_to_complete: at('finance.budget', 'finance.budget.to_complete', 'cost_to_complete') }, tolerance: 0.05, say: 'The certificate leaves {a} to complete and the budget’s forecast leaves {b}.', severity: 'medium' }],
  },

  /* --- Tax ------------------------------------------------------------- */
  {
    set: 'finance.tax.jda',
    // The agreement is Legal's: its date, the owners' share and the paper are read from there, not held a second time.
    replace: [
      mirror('agreement', 'Joint development agreement', 'evidence', JDA('agreement'), { section: 'agreement' }),
      mirror('executed_on', 'Executed on', 'date', JDA('jda_date'), { section: 'agreement' }),
      mirror('owner_share', 'Owner’s share', 'percent', JDA('owner_share'), { section: 'agreement' }),
    ],
    fields: [mirror('units_allotted_to_owner', 'Units allotted to the owners, per Legal', 'number', at('legal.contracts', 'legal.contracts.jda_delivery', 'owner_units'), { section: 'owner', tier: 'situational', showWhen: { all: [WITH_JDA, { records: 'shared.units', is: 'any', where: { column: 'allotted_to', is: 'equals', value: 'owner' } }] } })],
  },
  {
    set: 'finance.tax.gst',
    rules: [{ kind: 'before', fields: ['certificate_on', 'commenced_on'], at: { certificate_on: at('legal.approvals', 'legal.approvals.occupancy', 'commencement_on') }, say: 'The project is taken to have commenced on {b}, before the commencement certificate of {a}.', severity: 'medium' }],
  },
  {
    set: 'finance.tax.unit_gst',
    // The price and what has been demanded are Sales' and Collections' figures of the unit. Tax's are held to them.
    fields: [working('demanded_per_collections', 'Demanded on this unit, per Collections', { op: 'sum_if', over: { records: DEMANDS }, column: 'principal', where: { column: 'unit', is: 'own' } }, INR)],
    rules: [
      { kind: 'compare', fields: ['price_for_tax', 'sale_agreed_value'], say: 'GST is worked on {a} and the unit is agreed at {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['demanded_for_tax', 'demanded_per_collections'], when: SALES_KEEPS_DEMANDS, say: 'GST counts {a} demanded on this unit and Collections’ demands come to {b}.', severity: 'medium' },
    ],
  },
  {
    set: 'finance.tax.buyer_tds',
    fields: [
      working('agreed_value_of_unit', 'Agreed value of the unit, per Sales', ofLinked('unit', UNIT('sale_agreed_value')), INR),
      working('received_per_collections', 'Received on this unit, per Collections', sumForOwn(DEMANDS, 'received', 'unit', 'unit'), INR),
    ],
    rules: [
      { kind: 'compare', fields: ['consideration', 'agreed_value_of_unit'], say: 'Tax is tracked on a consideration of {a} and the unit is agreed at {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['received', 'received_per_collections'], when: SALES_KEEPS_DEMANDS, say: '{a} is taken as received on this unit and Collections’ receipts come to {b}.', severity: 'medium' },
    ],
  },
  {
    set: 'finance.tax.instruments',
    // The deed is Legal's record of the purchase: the instrument links to it. (The record is at its twenty fields, so the consideration is held to Legal's on the tax deducted, below.)
    fields: [{ key: 'purchase', label: 'Purchase, as Legal records it', kind: 'ref', target: { set: 'legal.contracts.purchases' }, required: false, section: 'instrument' }],
  },
  {
    set: 'finance.tax.property_tds',
    fields: [
      { key: 'purchase', label: 'Purchase, as Legal records it', kind: 'ref', target: { set: 'legal.contracts.purchases' }, required: false },
      working('consideration_per_deed', 'Consideration, per Legal’s record of the purchase', ofLinked('purchase', at('legal.contracts', 'legal.contracts.purchases', 'consideration')), INR),
    ],
    rules: [{ kind: 'compare', fields: ['consideration', 'consideration_per_deed'], say: 'Tax is deducted on a consideration of {a} and Legal records {b} for the purchase.', severity: 'high' }],
  },
  {
    set: 'finance.tax.properties',
    fields: [working('built_up_of_building', 'Built-up area of the building, per the Architect', ofLinked('building', at('shared', 'shared.buildings', 'built_up_area')), { dimension: 'area' })],
    rules: [{ kind: 'at_least', fields: ['assessed_area', 'built_up_of_building'], say: 'The property is assessed on {a} and the building is {b} built up.', severity: 'medium' }],
  },

  /* --- Lenders --------------------------------------------------------- */
  {
    set: 'finance.lenders.securities',
    // The charge a security creates is the one Title finds on the land: the two are one fact, linked.
    fields: [{ key: 'charge_on_title', label: 'Charge, as Title records it', kind: 'ref', target: { set: 'legal.title.charges' }, required: false, section: 'value' }],
  },
  {
    set: 'finance.lenders.security',
    fields: [mirror('value_per_valuation', 'Fair market value, per the valuation', 'money', at('finance.valuation', 'finance.valuation.conclusion', 'fair_market_value'), { ...INR, section: 'cover', tier: 'expert' })],
    rules: [{ kind: 'at_most', fields: ['security_value', 'value_per_valuation'], say: 'The security is carried at {a} and the valuation comes to {b}.', severity: 'medium' }],
  },
  {
    set: 'finance.lenders.limits',
    rules: [{ kind: 'before', fields: ['completion_committed', 'declared_to_rera'], at: { declared_to_rera: at('legal.rera', 'legal.rera.registration', 'declared_completion') }, say: 'Completion is committed to the lender for {a}, after the {b} declared to RERA.', severity: 'high' }],
  },

  /* --- Ledgers --------------------------------------------------------- */
  {
    set: 'finance.ledgers.payables',
    fields: [mirror('brokerage_unpaid', 'Brokerage invoiced and not paid, per Sales', 'money', at('commercial.inventory', 'commercial.inventory.brokerage', 'unpaid'), { ...INR, tier: 'situational', showWhen: { records: 'commercial.inventory.brokerage_invoices', is: 'any' } })],
  },
  {
    set: 'finance.ledgers.customer_ledgers',
    fields: [working('received_per_collections', 'Received on this unit, per Collections', sumForOwn(DEMANDS, 'received', 'unit', 'unit'), INR)],
    rules: [{ kind: 'compare', fields: ['received_per_register', 'received_per_collections'], when: SALES_KEEPS_DEMANDS, say: 'The ledger takes {a} from the sales register and Collections’ receipts on this unit come to {b}.', severity: 'medium' }],
  },
];

export const FINANCE_TAX_LENDERS_FIELD_SETS: FieldSet[] = withLinks([...FUNDING_SETS, ...TAX_SETS, ...LENDER_SETS, ...LEDGER_SETS], LINKS);
