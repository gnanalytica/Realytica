/**
 * The ids of the Finance, Tax, Lenders and Ledgers field sets, the
 * situations they answer to and the kinds of paper they read, each written
 * once so a formula in one file names a set in another without a typo.
 */

import type { FieldAddress, ShowWhen, Situation } from '../../types';

export const SET = {
  /* Finance: funding, cash and the RERA account */
  plan: 'finance.funding.plan',
  sources: 'finance.funding.sources',
  accountFacts: 'finance.funding.account_facts',
  cash: 'finance.funding.cash',
  cashMonths: 'finance.funding.cash_months',
  forecastWeeks: 'finance.funding.forecast_weeks',
  reraCost: 'finance.funding.rera_cost',
  reraWithdrawal: 'finance.funding.rera_withdrawal',
  reraDeposit: 'finance.funding.rera_deposit',
  reraCertificates: 'finance.funding.rera_certificates',
  reraYears: 'finance.funding.rera_years',
  receivables: 'finance.funding.receivables',
  /* Tax */
  partyTax: 'finance.tax.party_registrations',
  gst: 'finance.tax.gst',
  unitGst: 'finance.tax.unit_gst',
  gstMonths: 'finance.tax.gst_months',
  purchaseYears: 'finance.tax.purchase_years',
  tds: 'finance.tax.tds',
  tdsMonths: 'finance.tax.tds_months',
  tdsStatements: 'finance.tax.tds_statements',
  propertyTds: 'finance.tax.property_tds',
  buyerTds: 'finance.tax.buyer_tds',
  duty: 'finance.tax.duty',
  instruments: 'finance.tax.instruments',
  properties: 'finance.tax.properties',
  propertyTaxYears: 'finance.tax.property_tax_years',
  jda: 'finance.tax.jda',
  jdaTax: 'finance.tax.jda_tax',
  jdaPayments: 'finance.tax.jda_payments',
  /* Lenders */
  facilities: 'finance.lenders.facilities',
  securities: 'finance.lenders.securities',
  security: 'finance.lenders.security',
  guarantees: 'finance.lenders.guarantees',
  unitReleases: 'finance.lenders.unit_releases',
  conditions: 'finance.lenders.conditions',
  covenants: 'finance.lenders.covenants',
  papersOwed: 'finance.lenders.papers_owed',
  letters: 'finance.lenders.letters',
  compliance: 'finance.lenders.compliance',
  limits: 'finance.lenders.limits',
  drawdowns: 'finance.lenders.drawdowns',
  drawdown: 'finance.lenders.drawdown',
  costStated: 'finance.lenders.cost_incurred_stated',
  tests: 'finance.lenders.tests',
  engineerReports: 'finance.lenders.engineer_reports',
  observations: 'finance.lenders.observations',
  escrow: 'finance.lenders.escrow',
  repayments: 'finance.lenders.repayments',
  position: 'finance.lenders.position',
  /* Ledgers */
  partyLedger: 'finance.ledgers.supplier_facts',
  contractAccounts: 'finance.ledgers.contract_accounts',
  payables: 'finance.ledgers.payables',
  customerLedgers: 'finance.ledgers.customer_ledgers',
  collections: 'finance.ledgers.collections',
  reconciliation: 'finance.ledgers.reconciliation',
  reconciliationLines: 'finance.ledgers.reconciliation_lines',
  ledgerMap: 'finance.ledgers.ledger_map',
} as const;

/** The kinds of paper these sets read, as the register names them (`document-parse.ts`). */
export const PAPER = {
  sanction: 'Loan sanction letter',
  bankStatement: 'Bank statement',
  reraAccountant: 'RERA withdrawal certificate',
  lenderEngineer: 'Independent engineer report',
  saleDeed: 'Sale deed',
  agreement: 'Agreement to sell',
  jda: 'Joint development agreement',
  khata: 'Khata certificate and extract',
  taxReceipt: 'Property tax receipt',
  commencement: 'Commencement certificate',
} as const;

/* --- fields of other functions that exist today, read by address ------- */

export const EXISTING = {
  budgetSanctioned: { fn: 'finance.budget', set: 'cost_quantity.budget_current', field: 'sanctioned_budget' },
  budgetForecast: { fn: 'finance.budget', set: 'cost_quantity.budget_current', field: 'current_forecast' },
  forecastAtCompletion: { fn: 'finance.budget', set: 'cost_quantity.forecast', field: 'forecast_at_completion' },
  certified: { fn: 'finance.budget', set: 'cost_quantity.commitments', field: 'certified' },
  guidanceRate: { fn: 'finance.valuation', set: 'indicative_valuation.subject', field: 'guideline_rate_per_sqm' },
  occupancyDate: { fn: 'legal.approvals', set: 'regulatory.occupancy', field: 'oc_date' },
  chargesOnEc: { fn: 'legal.title', set: 'legal.encumbrances', field: 'subsisting_charges' },
  forecastCompletion: { fn: 'construction.progress', set: 'schedule_progress.forecast_completion', field: 'forecast_completion' },
  unitsSold: { fn: 'commercial.market', set: 'commercial_market.absorption', field: 'units_sold' },
  actualProgress: { fn: 'construction.progress', set: 'schedule_progress.planned_vs_actual', field: 'actual_percent' },
} as const satisfies Record<string, FieldAddress>;

/* --- situations ------------------------------------------------------- */

/**
 * In play once an account of the project is kept as its RERA designated
 * account: nobody is asked. It stands in for "RERA registered", whose home is
 * Legal, until the two are joined.
 */
export const DESIGNATED_ACCOUNT_KEPT: Situation = {
  key: 'designated_account_kept',
  label: 'RERA designated account kept',
  scope: 'project',
  hint: 'One of the project’s accounts is its RERA designated account.',
  derive: { records: 'shared.accounts', is: 'any', where: { column: 'purpose', is: 'equals', value: 'RERA designated' } },
};

/** In play once a facility is recorded: nobody is asked. Its home is Lenders. */
export const LENDER_FUNDED: Situation = {
  key: 'lender_funded',
  label: 'Lender funded',
  scope: 'project',
  hint: 'A lender has sanctioned a facility for the project.',
  derive: { records: SET.facilities, is: 'any' },
};

/** Joint development is declared by Legal, which holds the agreement; Tax and Ledgers answer to it by its key. */
export const JOINT_DEVELOPMENT_KEY = 'joint_development';

export const IF_DESIGNATED: ShowWhen = { situation: DESIGNATED_ACCOUNT_KEPT.key };
export const IF_LENDER: ShowWhen = { situation: LENDER_FUNDED.key };
export const IF_JOINT: ShowWhen = { situation: JOINT_DEVELOPMENT_KEY };

/** What every Tax sheet says of itself, in its first section's name. */
export const NOT_ADVICE = 'a record for the firm’s accountant to confirm, not tax advice';
