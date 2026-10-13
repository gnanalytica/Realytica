/**
 * Finance › Budget: the bottom line of a Cost Report as its owner reads it.
 *
 * A consultant's cost report ends in three lines: the total of its packages,
 * GST on that, and the grand total with GST, with the cost for each square
 * foot built beside them. The ledger holds the packages; these are worked
 * out from them and typed by nobody.
 *
 * - **GST** is the total at the rate a rule row gives for a works contract on
 *   the last day of the report's period (`gst_works_contract`). The row is
 *   cited with the figure, and said to be unverified until a person has
 *   checked it. Where no row applies, no GST is worked out: none is assumed.
 * - **Cost per unit area** is the total before GST over the built-up area on
 *   the project's file. Where no area is on file there is none.
 */

import type { DdProject, RuleCitation } from './types';
import { costReportTotals, type CostReportPeriod } from './cost-report';
import { ruleRowsFor } from './firm-fields';
import { ruleCitation, ruleRow } from './rule-tables';
import { SQM_PER_SQFT } from './units';

/** The rule row a works contract's GST is read from. */
export const GST_WORKS_CONTRACT_RULE = 'gst_works_contract';

export interface CostReportBottomLine {
  /** The packages added up: what the ledger's own totals row says. */
  beforeGst: { budget: number; anticipatedCost: number; certified?: number };
  /** GST on the total, at the rule row's rate. Absent where no row applies. */
  gst?: { ratePct: number; rule: RuleCitation; budget: number; anticipatedCost: number };
  /** The total with GST. Absent with `gst`. */
  afterGst?: { budget: number; anticipatedCost: number };
  /** Cost before GST over the built-up area on file. Absent where no area is. */
  perArea?: { areaSqm: number; areaSqft: number; budgetPerSqft: number; anticipatedPerSqft: number };
}

function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

const toThePaisa = (amount: number): number => inPaise(amount) / 100;

export function costReportBottomLine(
  project: Pick<DdProject, 'builtUpAreaSqm' | 'jurisdiction' | 'city' | 'tenantId'>,
  report: Pick<CostReportPeriod, 'rows' | 'to'>,
): CostReportBottomLine {
  const totals = costReportTotals(report);
  const beforeGst = { budget: totals.budget, anticipatedCost: totals.anticipatedCost, ...(totals.certified !== undefined ? { certified: totals.certified } : {}) };
  const out: CostReportBottomLine = { beforeGst };
  const row = ruleRow(ruleRowsFor(project), GST_WORKS_CONTRACT_RULE, { state: project.jurisdiction, city: project.city }, report.to);
  if (row && typeof row.value === 'number') {
    const gst = { ratePct: row.value, rule: ruleCitation(row), budget: toThePaisa((totals.budget * row.value) / 100), anticipatedCost: toThePaisa((totals.anticipatedCost * row.value) / 100) };
    out.gst = gst;
    out.afterGst = { budget: toThePaisa(totals.budget + gst.budget), anticipatedCost: toThePaisa(totals.anticipatedCost + gst.anticipatedCost) };
  }
  const areaSqm = project.builtUpAreaSqm;
  if (typeof areaSqm === 'number' && areaSqm > 0) {
    const areaSqft = areaSqm / SQM_PER_SQFT;
    out.perArea = { areaSqm, areaSqft: Math.round(areaSqft), budgetPerSqft: toThePaisa(totals.budget / areaSqft), anticipatedPerSqft: toThePaisa(totals.anticipatedCost / areaSqft) };
  }
  return out;
}
