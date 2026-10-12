/**
 * Finance › Ledgers: views and reconciliations, never books of account.
 *
 * The general ledger, the vouchers, the trial balance, the bank books and
 * the returns stay in the firm's accounting package, which is the source of
 * record. What is held here is the paper behind each balance, the project's
 * own figure for it, and a line that says whether the two agree and, where
 * they do not, why.
 *
 * Four functions of the catalog:
 *
 * - payables: an account for each contract, certified against paid against
 *   the books;
 * - retention and advances, on the same account;
 * - the customer ledger, a record for each unit: the register against the
 *   books against the bank;
 * - the monthly reconciliation with the books: a line for each control
 *   total, each difference with a reason, and who signed it off.
 */

import type { FieldSet } from '../../types';
import { EXISTING, IF_JOINT, JOINT_DEVELOPMENT, SET } from './names';
import {
  SIGNED,
  LED,
  at,
  choice,
  count,
  tallyWhere,
  dateOf,
  day,
  f,
  limitFor,
  link,
  minus,
  mirror,
  money,
  n,
  only,
  options,
  orZero,
  paper,
  rate,
  rule,
  rupees,
  sizeOf,
  standing,
  totalOf,
  totalWhere,
  text,
  tick,
  today,
  when,
  worked,
} from './kit';

const AGE_BUCKETS = ['not yet due', 'up to 30 days', '31 to 60 days', '61 to 90 days', 'older'];
const SETTLED_REASONS = ['timing', 'not_yet_in_books', 'not_yet_filed_here', 'classification'];
const DIFFERENCE = at(LED, SET.reconciliationLines, 'difference');
const MAPS_TO = at(LED, SET.ledgerMap, 'maps_to');

export const LEDGER_SETS: FieldSet[] = [
  {
    id: SET.partyLedger,
    fn: LED,
    title: 'Supplier',
    v: 1,
    extends: 'shared.parties',
    fields: [
      tick('small_enterprise', 'Registered micro or small enterprise', { from: 'Udyam registration certificate' }),
      text('udyam_no', 'Udyam registration number', { required: false, from: 'Udyam registration certificate' }),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Payables, retention and advances                                    */
  /* ================================================================== */
  {
    id: SET.contractAccounts,
    fn: LED,
    title: 'Contractor accounts',
    v: 1,
    records: { of: 'account', titleField: 'contract', summaryFields: ['payable', 'retention_balance', 'account_standing'] },
    sections: [
      { key: 'payable', label: 'Certified and paid' },
      { key: 'retention', label: 'Retention' },
      { key: 'advance', label: 'Advances' },
    ],
    fields: [
      link('contract', 'Contract', 'contract', { section: 'payable' }),
      day('as_at', 'As at', { section: 'payable' }),
      money('certified_net', 'Certified to date, net of deductions', { section: 'payable', from: 'Payment certificates' }),
      money('paid', 'Paid to date', { section: 'payable', from: 'Bank advices and vouchers' }),
      rupees('payable', 'Certified and unpaid', minus(f('certified_net'), f('paid')), { section: 'payable' }),
      money('payable_per_books', 'Payable per the books', { section: 'payable', from: 'Creditors ledger export' }),
      rupees('books_less_certificates', 'Books less certificates', minus(f('payable_per_books'), f('payable')), { section: 'payable' }),
      paper('statement', 'Contractor statement', { section: 'payable' }),
      money('retention_held', 'Retention held', { section: 'retention', required: false, from: 'Payment certificates' }),
      money('retention_released', 'Retention released', { section: 'retention', required: false, from: 'Vouchers' }),
      rupees('retention_balance', 'Retention still held', minus(f('retention_held'), orZero('retention_released')), { section: 'retention' }),
      day('defects_period_ends', 'Defects period ends', { section: 'retention', required: false, expires: { leadDays: 30 }, from: 'Contract and completion certificate' }),
      money('advance_paid', 'Advance paid', { section: 'advance', required: false, from: 'Vouchers' }),
      money('advance_recovered', 'Advance recovered', { section: 'advance', required: false, from: 'Payment certificates' }),
      rupees('advance_balance', 'Advance outstanding', minus(f('advance_paid'), orZero('advance_recovered')), { section: 'advance' }),
      money('advance_guarantee', 'Advance guarantee held', { section: 'advance', required: false, from: 'Bank guarantee' }),
      standing(
        'account_standing',
        'Account',
        [
          { when: rule('at_least', ['payable'], 'Paid beyond what is certified: the balance stands at {a}.', 'high', { against: 0 }), label: 'Paid beyond certified', tone: 'critical' },
          { when: rule('at_most', ['advance_balance', 'advance_guarantee'], 'The advance outstanding is {a} and the guarantee covers {b}.', 'high'), label: 'Advance not covered by the guarantee', tone: 'critical' },
          { when: rule('compare', ['payable_per_books', 'payable'], 'The books show {a} payable and the certificates less payments {b}.', 'medium', { tolerance: 0.001 }), label: 'Books and certificates differ', tone: 'warning' },
        ],
        { label: 'Agrees with the books', tone: 'good' },
        { section: 'payable' },
      ),
    ],
    rules: [
      rule('at_least', ['payable'], 'Paid beyond what is certified: the balance stands at {a}.', 'high', { against: 0 }),
      rule('at_most', ['advance_balance', 'advance_guarantee'], 'The advance outstanding is {a} and the guarantee covers {b}.', 'high'),
      rule('compare', ['payable_per_books', 'payable'], 'The books show {a} payable and the certificates less payments {b}.', 'medium', { tolerance: 0.001 }),
      rule('at_most', ['retention_released', 'retention_held'], 'Retention released is {a}, more than the {b} held.', 'medium'),
    ],
  },
  {
    id: SET.payables,
    fn: LED,
    title: 'Payables',
    v: 1,
    situations: [
      {
        key: 'small_enterprise_supplier',
        label: 'A supplier is a micro or small enterprise',
        scope: 'function',
        hint: 'A party on the project is recorded as a registered micro or small enterprise.',
        derive: { records: 'shared.parties', is: 'any', where: { column: 'small_enterprise', is: 'true' } },
      },
    ],
    sections: [
      { key: 'totals', label: 'Owed to contractors and suppliers', showWhen: { records: SET.contractAccounts, is: 'any' } },
      { key: 'age', label: 'By age', showWhen: { records: SET.contractAccounts, is: 'any' } },
      { key: 'small', label: 'Micro and small enterprises', showWhen: { situation: 'small_enterprise_supplier' } },
    ],
    fields: [
      rupees('payable', 'Certified and unpaid', totalOf(SET.contractAccounts, 'payable'), { section: 'totals' }),
      rupees('payable_per_books', 'Payable per the books', totalOf(SET.contractAccounts, 'payable_per_books'), { section: 'totals' }),
      rupees('books_less_certificates', 'Books less certificates', minus(f('payable_per_books'), f('payable')), { section: 'totals' }),
      rupees('retention_balance', 'Retention still held', totalOf(SET.contractAccounts, 'retention_balance'), { section: 'totals' }),
      rupees('advance_balance', 'Advances outstanding', totalOf(SET.contractAccounts, 'advance_balance'), { section: 'totals' }),
      mirror('certified_on_check', 'Certified to date, on the commitments check', 'money', EXISTING.certified, { section: 'totals', dimension: 'money', currency: 'INR' }),
      {
        key: 'ageing',
        label: 'Certified and unpaid, by age',
        kind: 'table',
        display: 'chart',
        chart: { x: 'bucket', y: 'amount', mark: 'bar' },
        section: 'age',
        from: 'Creditors ledger export',
        columns: [{ key: 'bucket', label: 'Age', kind: 'enum', options: AGE_BUCKETS }, count('payees', 'Payees'), money('amount', 'Amount')],
      },
      rupees('ageing_total', 'Unpaid, by the ages', { op: 'sum', table: 'ageing', column: 'amount' }, { section: 'age' }),
      standing(
        'payables_standing',
        'Payables',
        [
          { when: rule('compare', ['payable_per_books', 'payable'], 'The books show {a} payable and the certificates less payments {b}.', 'medium', { tolerance: 0.001 }), label: 'Books and certificates differ', tone: 'warning' },
          { when: rule('compare', ['ageing_total', 'payable'], 'The ages add up to {a} and the unpaid is {b}.', 'low', { tolerance: 0.01 }), label: 'Ages do not add up to the unpaid', tone: 'warning' },
        ],
        { label: 'Agrees with the books', tone: 'good' },
        { section: 'totals' },
      ),
      only({ situation: 'small_enterprise_supplier' }, money('small_enterprise_unpaid', 'Unpaid to micro and small enterprises', { section: 'small', from: 'Creditors ledger export' })),
      only({ situation: 'small_enterprise_supplier' }, count('small_enterprise_oldest', 'Oldest unpaid bill to one, in days', { section: 'small', from: 'Creditors ledger export' })),
      only({ situation: 'small_enterprise_supplier' }, worked('small_enterprise_allowed', 'Days allowed to pay one', limitFor('small_enterprise_oldest', rate('small_enterprise_payment_days')), { section: 'small', unit: 'days', precision: 0 })),
    ],
    rules: [
      rule('compare', ['payable_per_books', 'payable'], 'The books show {a} payable and the certificates less payments {b}.', 'medium', { tolerance: 0.001 }),
      rule('compare', ['ageing_total', 'payable'], 'The ages add up to {a} and the unpaid is {b}.', 'low', { tolerance: 0.01 }),
      rule('at_most', ['small_enterprise_oldest', 'small_enterprise_allowed'], 'A micro or small enterprise has waited {a} days to be paid; {b} are allowed.', 'high', { when: { situation: 'small_enterprise_supplier' } }),
    ],
  },

  /* ================================================================== */
  /* The customer ledger                                                 */
  /* ================================================================== */
  {
    id: SET.customerLedgers,
    fn: LED,
    title: 'Customer ledgers',
    v: 1,
    records: { of: 'ledger', titleField: 'unit', summaryFields: ['received_per_books', 'ledger_standing'] },
    fields: [
      link('unit', 'Unit', 'unit'),
      link('buyer', 'Buyer', 'party', { required: false }),
      paper('agreement', 'Agreement for sale', { viewer: 'deed' }),
      money('received_per_register', 'Received, per the sales register', { from: 'Sales register' }),
      money('received_per_books', 'Received, per the books', { from: 'Customer ledger export' }),
      rupees('books_less_register', 'Books less register', minus(f('received_per_books'), f('received_per_register'))),
      money('banked', 'Seen in the collection account', { required: false, from: 'Collection account statement' }),
      rupees('not_banked', 'Received and not yet seen in the bank', minus(f('received_per_register'), f('banked'))),
      paper('statement', 'Statement of account sent'),
      tick('no_dues_checked', 'No-dues checked before possession'),
      standing(
        'ledger_standing',
        'Ledger',
        [
          { when: rule('compare', ['received_per_books', 'received_per_register'], 'The books show {a} received and the sales register {b}.', 'medium', { tolerance: 0.0005 }), label: 'Books and register differ', tone: 'warning' },
          { when: rule('at_most', ['not_banked'], '{a} received is not yet seen in the collection account.', 'medium', { against: 0 }), label: 'A receipt is not in the bank', tone: 'warning' },
        ],
        { label: 'Agrees', tone: 'good' },
      ),
    ],
    rules: [
      rule('compare', ['received_per_books', 'received_per_register'], 'The books show {a} received and the sales register {b}.', 'medium', { tolerance: 0.0005 }),
      rule('at_most', ['not_banked'], '{a} received is not yet seen in the collection account.', 'medium', { against: 0 }),
    ],
  },
  {
    id: SET.collections,
    fn: LED,
    title: 'Collections',
    v: 1,
    situations: [JOINT_DEVELOPMENT],
    sections: [
      { key: 'totals', label: 'Received from customers', showWhen: { records: SET.customerLedgers, is: 'any' } },
      { key: 'owner', label: 'Landowner’s account', showWhen: IF_JOINT },
    ],
    fields: [
      rupees('received_per_register', 'Received, per the sales register', totalOf(SET.customerLedgers, 'received_per_register'), { section: 'totals' }),
      rupees('received_per_books', 'Received, per the books', totalOf(SET.customerLedgers, 'received_per_books'), { section: 'totals' }),
      rupees('books_less_register', 'Books less register', minus(f('received_per_books'), f('received_per_register')), { section: 'totals' }),
      rupees('not_banked', 'Received and not yet seen in the bank', totalOf(SET.customerLedgers, 'not_banked'), { section: 'totals' }),
      standing(
        'collections_standing',
        'Collections',
        [
          { when: rule('compare', ['received_per_books', 'received_per_register'], 'The books show {a} received from customers and the sales register {b}.', 'medium', { tolerance: 0.0005 }), label: 'Books and register differ', tone: 'warning' },
          { when: rule('at_most', ['not_banked'], '{a} received from customers is not yet seen in the collection account.', 'medium', { against: 0 }), label: 'Receipts not in the bank', tone: 'warning' },
        ],
        { label: 'Agrees with the books and the bank', tone: 'good' },
        { section: 'totals' },
      ),
      only(IF_JOINT, rupees('owner_deposit_paid', 'Refundable deposit paid to the landowner', totalWhere(SET.jdaPayments, 'amount', { column: 'kind', is: 'equals', value: 'refundable_deposit' }), { section: 'owner' })),
      only(IF_JOINT, money('owner_deposit_per_books', 'Landowner’s deposit per the books', { section: 'owner', from: 'Ledger export' })),
    ],
    rules: [
      rule('compare', ['received_per_books', 'received_per_register'], 'The books show {a} received from customers and the sales register {b}.', 'medium', { tolerance: 0.0005 }),
      rule('at_most', ['not_banked'], '{a} received from customers is not yet seen in the collection account.', 'medium', { against: 0 }),
      rule('compare', ['owner_deposit_per_books', 'owner_deposit_paid'], 'The books show {a} deposited with the landowner and the payments recorded come to {b}.', 'medium', { tolerance: 0.001, when: IF_JOINT }),
    ],
  },

  /* ================================================================== */
  /* Reconciliation with the accounting package                          */
  /* ================================================================== */
  {
    id: SET.reconciliation,
    fn: LED,
    title: 'Reconciliation with the books',
    v: 1,
    optionSets: [
      options('accounting_package', 'Accounting package', [
        ['tally', 'Tally Prime'],
        ['zoho_books', 'Zoho Books'],
        ['sap_business_one', 'SAP Business One'],
        ['busy', 'Busy'],
        ['marg', 'Marg'],
        ['dynamics', 'Microsoft Dynamics'],
        ['other', 'Other'],
      ]),
    ],
    sections: [
      { key: 'books', label: 'The books' },
      { key: 'month', label: 'The month' },
    ],
    fields: [
      choice('package', 'Accounting package', 'accounting_package', { section: 'books' }),
      day('imported_on', 'Books last imported on', { section: 'books' }),
      worked('import_age', 'Age of the import', minus(today, dateOf('imported_on')), { section: 'books', unit: 'days', precision: 0 }),
      paper('trial_balance', 'Trial balance', { section: 'books' }),
      worked('ledgers_unmapped', 'Ledgers with a balance and no mapping', tallyWhere(SET.ledgerMap, { column: 'unmapped_balance', is: 'gt', value: 0 }), { section: 'books', precision: 0 }),
      day('as_at', 'Reconciled as at', { section: 'month', required: false }),
      worked('lines_open', 'Differences open', tallyWhere(SET.reconciliationLines, { column: 'open_amount', is: 'gt', value: 0 }), { section: 'month', precision: 0 }),
      rupees('open_value', 'Value of the differences open', totalOf(SET.reconciliationLines, 'open_amount'), { section: 'month' }),
      standing(
        'reconciliation_standing',
        'Reconciliation',
        [
          { when: rule('at_most', ['lines_open'], 'Differences with the books still open: {a}.', 'high', { against: 0 }), label: 'Differences open', tone: 'critical' },
          { when: rule('at_most', ['ledgers_unmapped'], 'Ledgers holding a balance and mapped to nothing: {a}.', 'medium', { against: 0 }), label: 'A ledger is not mapped', tone: 'warning' },
          { when: rule('at_most', ['import_age'], 'The books were last imported {a} ago.', 'medium', { against: 35 }), label: 'Books not imported lately', tone: 'warning' },
        ],
        { label: 'No difference open', tone: 'good' },
        { section: 'month' },
      ),
      link('signed_off_by', 'Signed off by', 'party', { section: 'month', required: false }),
      day('signed_off_on', 'Signed off on', { section: 'month', required: false }),
    ],
    rules: [
      rule('at_most', ['lines_open'], 'Differences with the books still open: {a}.', 'high', { against: 0 }),
      rule('at_most', ['ledgers_unmapped'], 'Ledgers holding a balance and mapped to nothing: {a}.', 'medium', { against: 0 }),
      rule('at_most', ['import_age'], 'The books were last imported {a} ago.', 'medium', { against: 35 }),
      rule('require_if', ['signed_off_on', 'signed_off_by'], 'Signed off on {a}, and nobody is named.', 'medium'),
      rule('before', ['as_at', 'signed_off_on'], 'Signed off on {b}, before the day it is reconciled to, {a}.', 'low'),
    ],
  },
  {
    id: SET.reconciliationLines,
    fn: LED,
    title: 'Reconciliation lines',
    v: 1,
    records: { of: 'line', titleField: 'item', summaryFields: ['as_at', 'difference', 'line_standing'] },
    optionSets: [
      options('ledger_control_total', 'Control total', [
        ['creditors', 'Creditors'],
        ['retention_payable', 'Retention payable'],
        ['advances_to_contractors', 'Advances to contractors'],
        ['customer_advances', 'Customer advances'],
        ['loan_outstanding', 'Loan outstanding'],
        ['interest_paid', 'Interest paid'],
        ['gst_payable', 'GST payable'],
        ['tds_payable', 'Tax deducted, payable'],
        ['tds_receivable', 'Tax deducted, receivable'],
        ['project_cost', 'Project cost incurred'],
        ['bank_balances', 'Bank balances'],
      ]),
      options('ledger_difference_reason', 'Reason', [
        ['timing', 'Timing', 'info'],
        ['not_yet_in_books', 'Not yet entered in the books', 'info'],
        ['not_yet_filed_here', 'Not yet filed here', 'info'],
        ['classification', 'Classification', 'info'],
        ['error', 'Error', 'critical'],
        ['under_query', 'Under query', 'warning'],
      ]),
    ],
    fields: [
      choice('item', 'Control total', 'ledger_control_total'),
      day('as_at', 'As at'),
      money('per_books', 'Per the books', { ...SIGNED, from: 'Trial balance' }),
      money('per_project', 'Per the project’s record', { ...SIGNED, hint: 'As the project’s own figure stood on that day.' }),
      rupees('difference', 'Books less the project’s record', minus(f('per_books'), f('per_project'))),
      only({ any: [{ field: DIFFERENCE, is: 'gt', value: 0 }, { field: DIFFERENCE, is: 'lt', value: 0 }] }, choice('reason', 'Reason for the difference', 'ledger_difference_reason')),
      only({ any: [{ field: DIFFERENCE, is: 'gt', value: 0 }, { field: DIFFERENCE, is: 'lt', value: 0 }] }, paper('explained_by', 'Paper that explains it')),
      rupees(
        'open_amount',
        'Still open',
        when({ field: 'reason', is: 'set' }, when({ field: 'reason', is: 'in', value: SETTLED_REASONS }, n(0), sizeOf(f('difference'))), sizeOf(f('difference'))),
      ),
      standing(
        'line_standing',
        'Line',
        [
          { when: rule('at_most', ['open_amount'], '{a} of the difference is open.', 'high', { against: 0 }), label: 'Open', tone: 'critical' },
          { when: rule('compare', ['per_books', 'per_project'], 'The books show {a} and the project’s record {b}.', 'low', { tolerance: 0 }), label: 'Explained', tone: 'info' },
        ],
        { label: 'Agrees', tone: 'good' },
      ),
    ],
    rules: [rule('at_most', ['open_amount'], '{a} of the difference is open.', 'high', { against: 0 })],
  },
  {
    id: SET.ledgerMap,
    fn: LED,
    title: 'Ledger mapping',
    v: 1,
    records: { of: 'ledger', titleField: 'ledger', summaryFields: ['maps_to', 'balance'] },
    optionSets: [
      options('ledger_maps_to', 'Maps to', [
        ['package', 'A work package'],
        ['party', 'A party'],
        ['account', 'An account'],
        ['control_total', 'A control total'],
      ]),
    ],
    fields: [
      text('ledger', 'Ledger or cost centre, as the books name it', { from: 'Ledger export' }),
      money('balance', 'Balance in the books', { ...SIGNED, required: false, from: 'Trial balance' }),
      choice('maps_to', 'Maps to', 'ledger_maps_to', { required: false, control: 'segmented' }),
      only({ field: MAPS_TO, is: 'equals', value: 'package' }, link('package', 'Work package', 'package')),
      only({ field: MAPS_TO, is: 'equals', value: 'party' }, link('party', 'Party', 'party')),
      only({ field: MAPS_TO, is: 'equals', value: 'account' }, link('account', 'Account', 'account')),
      only({ field: MAPS_TO, is: 'equals', value: 'control_total' }, choice('control_total', 'Control total', 'ledger_control_total')),
      rupees('unmapped_balance', 'Balance mapped to nothing', when({ field: 'maps_to', is: 'set' }, n(0), sizeOf(f('balance'))), { tier: 'expert' }),
    ],
    rules: [],
  },
];
