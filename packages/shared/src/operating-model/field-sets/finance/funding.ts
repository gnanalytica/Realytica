/**
 * Finance › Funding: how the project is paid for, its cash, the RERA
 * designated account, and what customers owe.
 *
 * Five functions of the catalog, each a few small sheets:
 *
 * - the funding plan: sources as records, and what they add up to;
 * - cash: the accounts (the shared record, with the bank's and the books'
 *   balance on it), a record for each month and each forecast week;
 * - the designated account: project cost as the accountant's certificate
 *   counts it, what may be withdrawn, and the share to deposit;
 * - the certificates and the annual statement of accounts, as records;
 * - receivables.
 *
 * The RERA sheets show only once an account is kept as the designated one.
 * Legal owns the filings and types none of these numbers; the form numbers
 * are in the state pack and in no label here.
 */

import type { FieldSet, ShowWhen } from '../../types';
import { DESIGNATED_ACCOUNT_KEPT, EXISTING, IF_DESIGNATED, IF_LENDER, LENDER_FUNDED, PAPER, SET } from './names';
import {
  SIGNED,
  FIN,
  addMonths,
  area,
  asPct,
  at,
  choice,
  count,
  countWhere,
  dateOf,
  day,
  f,
  far,
  link,
  lowerOfBoth,
  minus,
  mirror,
  money,
  n,
  nothing,
  only,
  options,
  orZero,
  paper,
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
  times,
  when,
  worked,
} from './kit';

/** The plan is its sources added up, and the cash position its accounts: neither has anything to show before the first of them is recorded. */
const ANY_SOURCE: ShowWhen = { records: SET.sources, is: 'any' };
const ANY_ACCOUNT: ShowWhen = { records: 'shared.accounts', is: 'any' };

const DESIGNATED = countWhere('shared.accounts', { column: 'purpose', is: 'equals', value: 'RERA designated' });

const PROMOTER = ['promoter_equity', 'promoter_loan'];
const DEBT = ['construction_loan', 'debentures'];
const AGE_BUCKETS = ['not yet due', 'up to 30 days', '31 to 60 days', '61 to 90 days', 'older'];

export const FUNDING_SETS: FieldSet[] = [
  /* ================================================================== */
  /* The funding plan                                                    */
  /* ================================================================== */
  {
    id: SET.plan,
    fn: FIN,
    title: 'Funding plan',
    v: 1,
    situations: [LENDER_FUNDED],
    sections: [
      { key: 'cost', label: 'Cost and sources', showWhen: ANY_SOURCE },
      { key: 'mix', label: 'Promoter and debt', showWhen: ANY_SOURCE },
      { key: 'lender', label: 'Lender’s minimum', showWhen: { all: [IF_LENDER, ANY_SOURCE] } },
    ],
    fields: [
      mirror('project_cost', 'Project cost, as budgeted', 'money', EXISTING.budgetSanctioned, { section: 'cost', dimension: 'money', currency: 'INR' }),
      rupees('planned_total', 'Sources planned', totalOf(SET.sources, 'planned'), { section: 'cost' }),
      rupees('uncovered', 'Cost no source covers yet', minus(f('project_cost'), f('planned_total')), { section: 'cost' }),
      rupees('brought_in_total', 'Brought in to date', totalOf(SET.sources, 'brought_in'), { section: 'cost' }),
      rupees('forecast_uncovered', 'Forecast cost no source covers', minus(far(EXISTING.forecastAtCompletion), f('planned_total')), { section: 'cost', tier: 'expert' }),
      rupees('equity_planned', 'Promoter contribution planned', totalWhere(SET.sources, 'planned', { column: 'kind', is: 'in', value: PROMOTER }), { section: 'mix' }),
      rupees('equity_in', 'Promoter contribution brought in', totalWhere(SET.sources, 'brought_in', { column: 'kind', is: 'in', value: PROMOTER }), { section: 'mix' }),
      rupees('debt_planned', 'Debt planned', totalWhere(SET.sources, 'planned', { column: 'kind', is: 'in', value: DEBT }), { section: 'mix' }),
      rupees('advances_planned', 'Customer advances relied on', totalWhere(SET.sources, 'planned', { column: 'kind', is: 'equals', value: 'customer_advances' }), { section: 'mix' }),
      share('promoter_share', 'Promoter contribution, share of cost', asPct(f('equity_planned'), f('project_cost')), { section: 'mix' }),
      worked('debt_to_equity', 'Debt to equity', { op: 'divide', left: f('debt_planned'), right: f('equity_planned') }, { section: 'mix', unit: 'times' }),
      only(IF_LENDER, share('lender_minimum_share', 'Lender’s minimum promoter contribution', { op: 'records', set: SET.facilities, reduce: 'max', field: 'min_promoter_share' }, { section: 'lender' })),
      standing(
        'plan_standing',
        'Funding plan',
        [
          { when: rule('at_least', ['promoter_share', 'lender_minimum_share'], 'Promoter contribution is {a} of cost and the lender’s minimum is {b}.', 'high'), label: 'Promoter contribution below the lender’s minimum', tone: 'critical' },
          { when: rule('compare', ['planned_total', 'project_cost'], 'Sources add up to {a} and the project cost is {b}: {divergence} apart.', 'medium', { tolerance: 0.01 }), label: 'Sources do not add up to the cost', tone: 'warning' },
        ],
        { label: 'Sources cover the cost', tone: 'good' },
        { section: 'cost' },
      ),
    ],
    rules: [
      rule('at_least', ['promoter_share', 'lender_minimum_share'], 'Promoter contribution is {a} of cost and the lender’s minimum is {b}.', 'high', { when: IF_LENDER }),
      rule('compare', ['planned_total', 'project_cost'], 'Sources add up to {a} and the project cost is {b}: {divergence} apart.', 'medium', { tolerance: 0.01 }),
    ],
  },
  {
    id: SET.sources,
    fn: FIN,
    title: 'Sources of funds',
    v: 1,
    records: { of: 'source', titleField: 'kind', summaryFields: ['party', 'planned', 'brought_in'] },
    optionSets: [
      options('funding_source', 'Source of funds', [
        ['promoter_equity', 'Promoter equity'],
        ['promoter_loan', 'Promoter unsecured loan'],
        ['customer_advances', 'Customer advances'],
        ['construction_loan', 'Construction loan'],
        ['debentures', 'Debentures or structured debt'],
        ['other', 'Other'],
      ]),
    ],
    fields: [
      choice('kind', 'Source', 'funding_source'),
      link('party', 'From', 'party', { required: false }),
      money('planned', 'Planned', { from: 'Sanction letter, or the plan' }),
      money('brought_in', 'Brought in to date', { required: false, proof: 'expected', from: 'Accountant’s certificate of contribution, or the bank statement' }),
      percent('cost_a_year', 'Cost a year', { required: false, tier: 'expert' }),
      paper('proof', 'Paper'),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Cash                                                                */
  /* ================================================================== */
  {
    id: SET.accountFacts,
    fn: FIN,
    title: 'Account',
    v: 1,
    extends: 'shared.accounts',
    fields: [
      text('last_four', 'Last four digits of the number', { required: false, hint: 'Never the whole number.' }),
      day('opened_on', 'Opened on', { required: false }),
      money('bank_balance', 'Balance per the bank', { ...SIGNED, required: false, from: 'Bank statement', fromTypes: [PAPER.bankStatement], factKey: 'closing_balance' }),
      day('balance_as_at', 'Balance as at', { required: false, from: 'Bank statement', fromTypes: [PAPER.bankStatement], factKey: 'statement_to' }),
      money('book_balance', 'Balance per the books', { ...SIGNED, required: false, from: 'Bank book export' }),
      rupees('unreconciled', 'Books less the bank', minus(f('book_balance'), f('bank_balance'))),
      count('unreconciled_items', 'Items not yet reconciled', { required: false }),
      day('last_reconciled_on', 'Last reconciled on', { required: false }),
      paper('statement', 'Latest statement'),
    ],
    rules: [rule('compare', ['book_balance', 'bank_balance'], 'The books show {a} and the bank {b}.', 'medium', { tolerance: 0 })],
  },
  {
    id: SET.cash,
    fn: FIN,
    title: 'Cash position',
    v: 1,
    optionSets: [
      options('cash_figures_from', 'Figures taken from', [
        ['package', 'Accounting package', 'good'],
        ['statements', 'Bank statements', 'info'],
        ['typed', 'Typed', 'warning'],
      ]),
      options('cash_gap_cover', 'To be covered by', [
        ['promoter', 'Promoter funds'],
        ['drawdown', 'A drawdown'],
        ['collections', 'Faster collections'],
        ['deferral', 'Putting payments off', 'warning'],
        ['not_covered', 'Not covered yet', 'critical'],
      ]),
    ],
    situations: [
      { key: 'cash_gap_ahead', label: 'Cash falls short within the forecast', scope: 'function', derive: { field: at(FIN, SET.cash, 'lowest_forecast'), is: 'lt', value: 0 } },
    ],
    sections: [
      { key: 'position', label: 'To date', showWhen: ANY_ACCOUNT },
      { key: 'plan', label: 'Against plan', showWhen: ANY_ACCOUNT },
      { key: 'forecast', label: 'Thirteen-week forecast', showWhen: ANY_ACCOUNT },
      { key: 'gap', label: 'Shortfall', showWhen: { situation: 'cash_gap_ahead' } },
    ],
    fields: [
      day('as_at', 'As at', { section: 'position' }),
      choice('figures_from', 'Figures taken from', 'cash_figures_from', { section: 'position', control: 'segmented' }),
      money('opening_balance', 'Opening balance', { ...SIGNED, section: 'position', from: 'Bank statement' }),
      rupees('net_to_date', 'Net cash to date', totalOf(SET.cashMonths, 'net'), { section: 'position' }),
      rupees('closing_by_months', 'Closing balance, by the months', plus(f('opening_balance'), f('net_to_date')), { section: 'position' }),
      rupees('bank_total', 'Balances per the banks', totalOf('shared.accounts', 'bank_balance'), { section: 'position' }),
      rupees('months_less_banks', 'Months less the banks', minus(f('closing_by_months'), f('bank_total')), { section: 'position' }),
      rupees('collections_to_date', 'Collections to date', totalOf(SET.cashMonths, 'collections'), { section: 'plan' }),
      rupees('plan_net_to_date', 'Net cash planned to date', totalOf(SET.cashMonths, 'plan_net'), { section: 'plan' }),
      rupees('net_against_plan', 'Net cash less plan', minus(f('net_to_date'), f('plan_net_to_date')), { section: 'plan' }),
      rupees('lowest_forecast', 'Lowest forecast balance', { op: 'records', set: SET.forecastWeeks, reduce: 'min', field: 'closing' }, { section: 'forecast' }),
      standing(
        'cash_standing',
        'Cash',
        [
          { when: rule('at_least', ['lowest_forecast'], 'The forecast balance falls to {a}.', 'high', { against: 0 }), label: 'Short within the forecast', tone: 'critical' },
          { when: rule('compare', ['closing_by_months', 'bank_total'], 'The months close at {a} and the banks hold {b}.', 'medium', { tolerance: 0.005 }), label: 'Months and banks differ', tone: 'warning' },
        ],
        { label: 'Covered through the forecast', tone: 'good' },
        { section: 'forecast' },
      ),
      only({ situation: 'cash_gap_ahead' }, rupees('gap_amount', 'Shortfall at the lowest point', minus(n(0), f('lowest_forecast')), { section: 'gap' })),
      only({ situation: 'cash_gap_ahead' }, choice('gap_cover', 'To be covered by', 'cash_gap_cover', { section: 'gap', control: 'tiles' })),
    ],
    rules: [
      rule('at_least', ['lowest_forecast'], 'The forecast balance falls to {a}.', 'high', { against: 0 }),
      rule('compare', ['closing_by_months', 'bank_total'], 'The months close at {a} and the banks hold {b}.', 'medium', { tolerance: 0.005 }),
    ],
  },
  {
    id: SET.cashMonths,
    fn: FIN,
    title: 'Cash by month',
    v: 1,
    records: { of: 'month', titleField: 'month', summaryFields: ['net', 'plan_net'] },
    // Kept by the month: closed a week after it ends, by a lead. The month's collections are held against the receipts dated in it.
    periodic: {
      every: 'month',
      by: 'month',
      due: { days: 7 },
      issuer: 'lead',
      attribute: [{ field: 'collections', rows: { records: 'commercial.buyers.demands', table: 'settled_by' }, date: 'received_on', amount: 'amount', label: 'Receipts on demands', of: 'amount' }],
      reasons: 'period_unexplained',
    },
    optionSets: [
      options('period_unexplained', 'Why it is not explained', [
        ['dated_in_another_period', 'Dated in another period'],
        ['earlier_period_corrected', 'An earlier period corrected'],
        ['outside_these_records', 'Outside these records'],
        ['rounding', 'Rounding'],
        ['not_yet_reconciled', 'Not yet reconciled', 'warning'],
      ]),
    ],
    sections: [
      { key: 'month', label: 'Month' },
      { key: 'in', label: 'Money in' },
      { key: 'out', label: 'Money out' },
      { key: 'net', label: 'Net' },
    ],
    fields: [
      day('month', 'Month beginning', { section: 'month' }),
      paper('cash_book', 'Cash book or statement', { section: 'month' }),
      money('collections', 'Collections', { section: 'in' }),
      money('loan_drawn', 'Loan drawn', { section: 'in', required: false }),
      money('equity_in', 'Promoter funds in', { section: 'in', required: false }),
      money('other_in', 'Other money in', { section: 'in', required: false }),
      money('contractors', 'Contractors and suppliers', { section: 'out' }),
      money('land_and_approvals', 'Land and approvals', { section: 'out', required: false }),
      money('taxes', 'Taxes', { section: 'out', required: false }),
      money('interest', 'Interest', { section: 'out', required: false }),
      money('loan_repaid', 'Loan repaid', { section: 'out', required: false }),
      money('overheads', 'Overheads', { section: 'out', required: false }),
      money('other_out', 'Other money out', { section: 'out', required: false }),
      rupees('inflow', 'Money in', plus(f('collections'), orZero('loan_drawn'), orZero('equity_in'), orZero('other_in')), { section: 'net' }),
      rupees('outflow', 'Money out', plus(f('contractors'), orZero('land_and_approvals'), orZero('taxes'), orZero('interest'), orZero('loan_repaid'), orZero('overheads'), orZero('other_out')), { section: 'net' }),
      rupees('net', 'Net', minus(f('inflow'), f('outflow')), { section: 'net' }),
      money('plan_net', 'Net planned', { ...SIGNED, section: 'net', required: false, from: 'Feasibility cash flow' }),
    ],
    rules: [],
  },
  {
    id: SET.forecastWeeks,
    fn: FIN,
    title: 'Forecast by week',
    v: 1,
    records: { of: 'week', titleField: 'week_beginning', summaryFields: ['net', 'closing'] },
    periodic: { every: 'week', by: 'week_beginning', due: { days: 2 }, issuer: 'lead' },
    fields: [
      day('week_beginning', 'Week beginning'),
      money('receipts', 'Receipts due'),
      money('drawdown', 'Drawdown expected', { required: false }),
      money('payments', 'Contractor payments'),
      money('statutory', 'Statutory dues', { required: false }),
      money('debt_service', 'Interest and repayment', { required: false }),
      rupees('net', 'Net', minus(plus(f('receipts'), orZero('drawdown')), plus(f('payments'), orZero('statutory'), orZero('debt_service')))),
      money('closing', 'Closing balance forecast', { ...SIGNED, from: 'Forecast workbook' }),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* The RERA designated account                                         */
  /* ================================================================== */
  {
    id: SET.reraCost,
    fn: FIN,
    title: 'RERA project cost',
    v: 1,
    situations: [DESIGNATED_ACCOUNT_KEPT],
    optionSets: [
      options('rera_cost_head', 'Head of cost', [
        ['land_acquisition', 'Land: acquisition'],
        ['development_rights', 'Land: development rights'],
        ['approvals_and_duties', 'Land: approvals and duties'],
        ['onsite', 'On-site expenditure'],
        ['taxes_and_fees', 'Taxes, cess, fees and premiums'],
        ['interest', 'Interest on construction borrowing'],
      ]),
    ],
    sections: [
      { key: 'construction', label: 'Construction cost', showWhen: IF_DESIGNATED },
      { key: 'other', label: 'Land and other development cost', showWhen: IF_DESIGNATED },
      { key: 'totals', label: 'Totals', showWhen: IF_DESIGNATED },
    ],
    fields: [
      day('quarter_end', 'Quarter ending', { section: 'construction', from: 'Accountant’s certificate', fromTypes: [PAPER.reraAccountant] }),
      money('construction_estimated', 'Construction cost estimated by the engineer', { section: 'construction', from: 'Engineer’s certificate', fromTypes: [PAPER.reraAccountant] }),
      money('construction_per_engineer', 'Construction cost incurred, per the engineer', { section: 'construction', from: 'Engineer’s certificate', fromTypes: [PAPER.reraAccountant] }),
      money('construction_per_books', 'Construction cost incurred, per the books', { section: 'construction', from: 'Books of account, as the accountant verified them', fromTypes: [PAPER.reraAccountant] }),
      rupees('construction_counted', 'Construction cost counted: the lower of the two', lowerOfBoth(f('construction_per_engineer'), f('construction_per_books')), { section: 'construction' }),
      {
        key: 'cost_rows',
        label: 'Land and other development cost, by head',
        kind: 'table',
        section: 'other',
        from: 'Accountant’s certificate',
        columns: [choice('head', 'Head', 'rera_cost_head'), money('estimated', 'Estimated'), money('incurred', 'Incurred')],
      },
      rupees('other_estimated', 'Land and other cost, estimated', { op: 'sum', table: 'cost_rows', column: 'estimated' }, { section: 'other' }),
      rupees('other_incurred', 'Land and other cost, incurred', { op: 'sum', table: 'cost_rows', column: 'incurred' }, { section: 'other' }),
      rupees('total_estimated', 'Total estimated cost', plus(f('other_estimated'), f('construction_estimated')), { section: 'totals' }),
      rupees('total_incurred', 'Total cost incurred, as counted', plus(f('other_incurred'), f('construction_counted')), { section: 'totals' }),
      rupees('balance_cost', 'Balance cost to complete', minus(f('total_estimated'), f('total_incurred')), { section: 'totals' }),
      standing(
        'cost_standing',
        'Cost counted',
        [
          { when: rule('at_most', ['total_incurred', 'total_estimated'], 'Cost incurred is {a}, above the estimate of {b}.', 'high'), label: 'Incurred above the estimate', tone: 'critical' },
          { when: rule('at_most', ['construction_per_books', 'construction_per_engineer'], 'The books show {a} of construction cost and the engineer certifies {b}: the lower is counted.', 'medium'), label: 'Books above the engineer’s figure', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'totals' },
      ),
    ],
    rules: [
      rule('at_most', ['total_incurred', 'total_estimated'], 'Cost incurred is {a}, above the estimate of {b}.', 'high'),
      rule('at_most', ['construction_per_books', 'construction_per_engineer'], 'The books show {a} of construction cost and the engineer certifies {b}: the lower is counted.', 'medium'),
      rule('compare', ['total_estimated', 'budget'], 'The estimated cost on the accountant’s certificate is {a} and the budget is {b}: {divergence} apart.', 'low', { tolerance: 0.05, at: { budget: EXISTING.budgetSanctioned } }),
    ],
  },
  {
    id: SET.reraWithdrawal,
    fn: FIN,
    title: 'Withdrawal from the designated account',
    v: 1,
    situations: [DESIGNATED_ACCOUNT_KEPT],
    optionSets: [
      options('rera_withdrawal_basis', 'Worked on', [
        ['cost_incurred', 'Cost incurred'],
        ['lower_with_architect', 'Lower of cost and the architect’s completion'],
        ['other', 'Another basis'],
      ]),
    ],
    sections: [
      { key: 'completion', label: 'Completion', showWhen: IF_DESIGNATED },
      { key: 'amount', label: 'Amount', showWhen: IF_DESIGNATED },
    ],
    fields: [
      share('completion_by_cost', 'Completion by cost, per the accountant', asPct(far(at(FIN, SET.reraCost, 'total_incurred')), far(at(FIN, SET.reraCost, 'total_estimated'))), { section: 'completion' }),
      percent('completion_by_architect', 'Completion certified by the architect', { section: 'completion', from: 'Architect’s certificate' }),
      worked('completion_gap', 'Accountant’s completion above the architect’s', minus(f('completion_by_cost'), f('completion_by_architect')), { section: 'completion', unit: 'points' }),
      rupees('by_cost', 'Cost incurred, as counted', far(at(FIN, SET.reraCost, 'total_incurred')), { section: 'amount' }),
      money('withdrawable_certified', 'Amount that can be withdrawn, per the accountant’s certificate', { section: 'amount', proof: 'expected', from: 'Accountant’s certificate', fromTypes: [PAPER.reraAccountant] }),
      choice('basis', 'Worked by the accountant on', 'rera_withdrawal_basis', { section: 'amount', control: 'segmented', required: false, hint: 'The certificate’s own wording for this row is unclear. The accountant says which basis was used.' }),
      money('withdrawn_to_date', 'Withdrawn to date', { section: 'amount', from: 'Designated account statement', fromTypes: [PAPER.reraAccountant] }),
      rupees('net_withdrawable', 'Net amount that can be withdrawn now', minus(f('withdrawable_certified'), f('withdrawn_to_date')), { section: 'amount' }),
      rupees('by_cost_less_withdrawn', 'Cost incurred less withdrawn, before the accountant confirms', minus(f('by_cost'), f('withdrawn_to_date')), { section: 'amount' }),
      standing(
        'withdrawal_standing',
        'Withdrawal',
        [
          { when: rule('at_most', ['withdrawn_to_date', 'withdrawable_certified'], '{a} has been withdrawn and the certificate allows {b}.', 'critical'), label: 'Withdrawn beyond the certificate', tone: 'critical' },
          { when: rule('compare', ['withdrawable_certified', 'by_cost'], 'The certificate allows {a} and cost incurred comes to {b}: {divergence} apart.', 'medium', { tolerance: 0.01 }), label: 'Certificate and cost incurred differ', tone: 'warning' },
          { when: rule('require', ['basis'], 'The accountant has not said how the amount that can be withdrawn was worked.', 'medium'), label: 'Basis not confirmed by the accountant', tone: 'warning' },
        ],
        { label: 'Within the certificate', tone: 'good' },
        { section: 'amount' },
      ),
    ],
    rules: [
      rule('at_most', ['withdrawn_to_date', 'withdrawable_certified'], '{a} has been withdrawn and the certificate allows {b}.', 'critical'),
      rule('compare', ['withdrawable_certified', 'by_cost'], 'The certificate allows {a} and cost incurred comes to {b}: {divergence} apart.', 'medium', { tolerance: 0.01 }),
      rule('require', ['basis'], 'The accountant has not said how the amount that can be withdrawn was worked.', 'medium'),
      rule('at_most', ['completion_gap'], 'The accountant’s completion is {a} above the architect’s.', 'low', { against: 10 }),
    ],
  },
  {
    id: SET.reraDeposit,
    fn: FIN,
    title: 'Deposit into the designated account',
    v: 1,
    situations: [DESIGNATED_ACCOUNT_KEPT],
    sections: [
      { key: 'quarter', label: 'In the quarter', showWhen: IF_DESIGNATED },
      { key: 'ahead', label: 'Receivables against cost to complete', showWhen: IF_DESIGNATED },
      { key: 'rule', label: 'Share to deposit', showWhen: IF_DESIGNATED },
    ],
    fields: [
      mirror('quarter_end', 'Quarter ending', 'date', at(FIN, SET.reraCost, 'quarter_end'), { section: 'quarter' }),
      money('realised', 'Realised from allottees in the quarter', { section: 'quarter', from: 'Sales register and the books' }),
      money('deposited', 'Deposited in the designated account in the quarter', { section: 'quarter', from: 'Designated account statement', fromTypes: [PAPER.bankStatement] }),
      // What Collections recorded as received in the same three months, receipt by receipt off every demand. Read beside the figure from the books, and never in its place.
      rupees(
        'receipts_in_quarter',
        'Receipts Collections recorded in the quarter',
        {
          op: 'sum_if',
          over: { records: 'commercial.buyers.demands', table: 'settled_by' },
          column: 'amount',
          where: { column: 'amount', is: 'set' },
          between: { column: 'received_on', from: { op: 'add_months', date: { op: 'add_days', date: { op: 'date', key: 'quarter_end' }, days: n(1) }, months: n(-3) }, to: { op: 'date', key: 'quarter_end' } },
        },
        { section: 'quarter', tier: 'situational', showWhen: { records: 'commercial.buyers.demands', is: 'any' } },
      ),
      share('deposit_share', 'Share deposited', asPct(f('deposited'), f('realised')), { section: 'quarter' }),
      money('receivable_sold', 'Receivable from units sold', { section: 'ahead', from: 'Accountant’s certificate, statement of units sold', fromTypes: [PAPER.reraAccountant] }),
      area('unsold_carpet', 'Carpet area unsold', { section: 'ahead', from: 'Accountant’s certificate, statement of units unsold', fromTypes: [PAPER.reraAccountant] }),
      mirror('guidance_rate', 'Guidance rate a square metre, from Valuation', 'money', EXISTING.guidanceRate, { section: 'ahead', dimension: 'money', currency: 'INR' }),
      rupees('unsold_value', 'Value of the unsold area', times(f('unsold_carpet'), f('guidance_rate')), { section: 'ahead' }),
      rupees('estimated_receivables', 'Estimated receivables', plus(f('receivable_sold'), f('unsold_value')), { section: 'ahead' }),
      rupees('balance_cost', 'Balance cost to complete', far(at(FIN, SET.reraCost, 'balance_cost')), { section: 'ahead' }),
      share(
        'required_share',
        'Share to deposit from now',
        when({ left: f('estimated_receivables'), is: 'gt', right: f('balance_cost') }, rate('rera_deposit_share', 'quarter_end'), rate('rera_deposit_share_stressed', 'quarter_end')),
        { section: 'rule' },
      ),
      standing(
        'deposit_standing',
        'Deposit rule',
        [{ when: rule('at_least', ['deposit_share', 'required_share'], '{a} of what was realised was deposited; {b} is required.', 'critical'), label: 'Short of the share to deposit', tone: 'critical' }],
        { label: 'Deposited as required', tone: 'good' },
        { section: 'rule' },
      ),
      worked('designated_accounts', 'Designated accounts kept', when({ left: DESIGNATED, is: 'gt', right: n(0) }, DESIGNATED, nothing), { section: 'rule', tier: 'expert', precision: 0 }),
    ],
    rules: [
      rule('at_least', ['deposit_share', 'required_share'], '{a} of what was realised was deposited; {b} is required.', 'critical'),
      rule('at_most', ['designated_accounts'], 'Accounts kept as the RERA designated account: {a}. A registration has one.', 'high', { against: 1 }),
      rule('compare', ['realised', 'receipts_in_quarter'], 'The books show {a} realised in the quarter and Collections’ receipts in it come to {b}: {divergence} apart.', 'medium', { tolerance: 0.01 }),
    ],
  },
  {
    id: SET.reraCertificates,
    fn: FIN,
    title: 'RERA certificates',
    v: 1,
    records: { of: 'certificate', titleField: 'kind', summaryFields: ['period_end', 'signed_on'] },
    // One of each kind a quarter, signed by an outside professional: the same people sign the next, so they are carried.
    periodic: { every: 'quarter', by: 'period_end', per: ['kind'], carry: ['signed_by', 'membership_no'], due: { rate: 'rera_quarterly_filing_days' }, issuer: 'consultant' },
    optionSets: [
      options('rera_certificate_kind', 'Certificate', [
        ['accountant_withdrawal', 'Accountant: withdrawal'],
        ['architect_progress', 'Architect: progress'],
        ['engineer_cost', 'Engineer: cost'],
        ['auditor_annual', 'Auditor: annual statement of accounts'],
      ]),
    ],
    fields: [
      choice('kind', 'Certificate', 'rera_certificate_kind'),
      day('period_end', 'Period ending'),
      link('signed_by', 'Signed by', 'party'),
      text('membership_no', 'Membership or licence number', { required: false }),
      only(
        { field: at(FIN, SET.reraCertificates, 'kind'), is: 'in', value: ['accountant_withdrawal', 'auditor_annual'] },
        text('document_id', 'Unique document identification number', { from: 'The certificate' }),
      ),
      only({ field: at(FIN, SET.reraCertificates, 'kind'), is: 'equals', value: 'architect_progress' }, day('inspected_on', 'Site inspected on')),
      day('signed_on', 'Signed on'),
      paper('paper', 'Certificate as signed'),
    ],
    rules: [rule('before', ['inspected_on', 'signed_on'], 'The site was inspected on {a}, after the certificate was signed on {b}.', 'medium')],
  },
  {
    id: SET.reraYears,
    fn: FIN,
    title: 'Annual statement of accounts',
    v: 1,
    records: { of: 'year', titleField: 'year_end', summaryFields: ['excess_withdrawn', 'year_standing'] },
    periodic: { every: 'year', by: 'year_end', carry: ['auditor'], cumulative: ['collected_to_date', 'withdrawn_to_date'], due: { rate: 'rera_annual_report_months' }, issuer: 'consultant' },
    fields: [
      day('year_end', 'Financial year ending'),
      worked('report_due', 'Report due', addMonths(dateOf('year_end'), rate('rera_annual_report_months')), { yields: 'date' }),
      day('report_signed_on', 'Report signed on', { required: false }),
      link('auditor', 'Statutory auditor', 'party'),
      percent('completed', 'Project completed, per the report'),
      money('collected_in_year', 'Collected in the year'),
      money('collected_to_date', 'Collected to date'),
      money('withdrawn_in_year', 'Withdrawn in the year'),
      money('withdrawn_to_date', 'Withdrawn to date'),
      money('excess_withdrawn', 'Withdrawn beyond what was eligible'),
      paper('report', 'Report as signed'),
      standing(
        'year_standing',
        'Annual statement',
        [
          { when: rule('at_most', ['excess_withdrawn'], 'The auditor reports {a} withdrawn beyond what was eligible.', 'critical', { against: 0 }), label: 'Excess withdrawal reported', tone: 'critical' },
          { when: rule('before', ['report_signed_on', 'report_due'], 'The report was signed on {a} and was due on {b}.', 'medium'), label: 'Signed after it was due', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
      ),
    ],
    rules: [
      rule('at_most', ['excess_withdrawn'], 'The auditor reports {a} withdrawn beyond what was eligible.', 'critical', { against: 0 }),
      rule('before', ['report_signed_on', 'report_due'], 'The report was signed on {a} and was due on {b}.', 'medium'),
      rule('at_most', ['withdrawn_in_year', 'withdrawn_to_date'], 'Withdrawn in the year is {a}, more than the {b} withdrawn to date.', 'medium'),
    ],
  },

  /* ================================================================== */
  /* Receivables                                                         */
  /* ================================================================== */
  {
    id: SET.receivables,
    fn: FIN,
    title: 'Receivables',
    v: 1,
    situations: [
      {
        key: 'sales_begun',
        label: 'Units are being sold',
        scope: 'function',
        hint: 'A customer ledger is kept, or the absorption check counts a unit sold.',
        derive: { any: [{ records: SET.customerLedgers, is: 'any' }, { field: EXISTING.unitsSold, is: 'gt', value: 0 }] },
      },
    ],
    sections: [
      { key: 'totals', label: 'What customers owe', showWhen: { situation: 'sales_begun' } },
      { key: 'age', label: 'By age', showWhen: { situation: 'sales_begun' } },
    ],
    fields: [
      day('as_at', 'As at', { section: 'totals' }),
      money('agreement_value', 'Agreement value of units sold', { section: 'totals', from: 'Sales register' }),
      money('demanded', 'Demanded to date', { section: 'totals', from: 'Demand register' }),
      money('collected', 'Collected to date', { section: 'totals', from: 'Receipts and the collection account' }),
      rupees('outstanding', 'Outstanding against demands', minus(f('demanded'), f('collected')), { section: 'totals' }),
      rupees('not_yet_demanded', 'Not yet demanded', minus(f('agreement_value'), f('demanded')), { section: 'totals' }),
      share('collection_efficiency', 'Collected, as a share of demanded', asPct(f('collected'), f('demanded')), { section: 'totals' }),
      {
        key: 'ageing',
        label: 'Outstanding by age',
        kind: 'table',
        display: 'chart',
        chart: { x: 'bucket', y: 'amount', mark: 'bar' },
        section: 'age',
        from: 'Demand register',
        columns: [{ key: 'bucket', label: 'Age', kind: 'enum', options: AGE_BUCKETS }, count('units', 'Units'), money('amount', 'Amount')],
      },
      rupees('ageing_total', 'Outstanding, by the ages', { op: 'sum', table: 'ageing', column: 'amount' }, { section: 'age' }),
      rupees('oldest', 'Outstanding in the oldest age', { op: 'sum_if', over: { table: 'ageing' }, column: 'amount', where: { column: 'bucket', is: 'equals', value: 'older' } }, { section: 'age' }),
      share('oldest_share', 'Oldest age, as a share of demanded', asPct(f('oldest'), f('demanded')), { section: 'age' }),
      standing(
        'receivables_standing',
        'Receivables',
        [
          { when: rule('compare', ['ageing_total', 'outstanding'], 'The ages add up to {a} and the outstanding is {b}.', 'medium', { tolerance: 0.01 }), label: 'Ages do not add up to the outstanding', tone: 'warning' },
          { when: rule('at_most', ['oldest_share'], '{a} of what was demanded is in the oldest age.', 'medium', { against: 5 }), label: 'Old dues are building up', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'totals' },
      ),
    ],
    rules: [
      rule('compare', ['ageing_total', 'outstanding'], 'The ages add up to {a} and the outstanding is {b}.', 'medium', { tolerance: 0.01 }),
      rule('at_most', ['oldest_share'], '{a} of what was demanded is in the oldest age.', 'medium', { against: 5 }),
      rule('at_most', ['collected', 'demanded'], 'Collected is {a}, more than the {b} demanded.', 'low'),
    ],
  },
];
