/**
 * Figures the field system reads from the modules that keep them.
 *
 * The cost register, the monthly cost report, the comparable schedule and
 * the valuation's approaches each hold their figures in a module of their
 * own, with their own screens and their own rules. A field set does not
 * hold those figures a second time and does not rewrite the module: a
 * computed field names one with `{ op: 'figure', of: 'cost.budget' }`, and
 * the figure is read here, from the module, every time the sheet is read.
 *
 * Read-only by construction: a figure is a function of the project, nothing
 * writes through it, and one that the module cannot give yet is null, never
 * zero. A date is given as a day number, for a computed field that yields a
 * date. The catalog test refuses a formula naming a figure that is not here.
 */

import { dayNumber, fieldStands } from './check-fields';
import { MIN_SCHEDULE, comparableSchedule } from './comparables';
import { costRegister, costSummary } from './cost';
import { costReportPeriodOrder, costReportsOf, costReportTotals, type CostReportPeriod } from './cost-report';
import { costReportChanges } from './cost-report-compare';
import { approachIsUsable } from './valuation-model';
import { runValuationApproaches } from './valuation-run';
import { valueSummary, type ValueSummary } from './value-standing';
import type { CheckFieldValue, DdProject } from './types';

export interface ProjectFigure {
  key: string;
  /** What it is, as the module that keeps it calls it. */
  label: string;
  /** The module it is read from. */
  from: string;
  /** `shared` lasts one reading of the project, so several figures of one module work it out once. */
  read(project: DdProject, shared: Map<string, unknown>): number | null;
}

const known = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const positive = (n: number | null | undefined): number | null => (typeof n === 'number' && n > 0 ? n : null);
const total = (amounts: readonly number[]): number => Math.round(amounts.reduce((sum, n) => sum + n, 0) * 100) / 100;

/** The cost report for the latest period, issued or not. */
function latestReport(project: DdProject): CostReportPeriod | undefined {
  return [...costReportsOf(project)].sort(costReportPeriodOrder).at(-1);
}

const ofLatestReport = (read: (report: CostReportPeriod, project: DdProject) => number | null) => (project: DdProject) => {
  const report = latestReport(project);
  return report ? read(report, project) : null;
};

/** The valuation as it stands, worked out once for a reading however many of its figures a sheet names. */
function valued(project: DdProject, shared: Map<string, unknown>): { summary: ValueSummary; ran: number } {
  const held = shared.get('valuation') as { summary: ValueSummary; ran: number } | undefined;
  if (held) return held;
  const working = runValuationApproaches(project);
  const next = { summary: valueSummary(project, working), ran: working.runs.filter(approachIsUsable).length };
  shared.set('valuation', next);
  return next;
}

/* --- The appraisal's cash flow, month by month ------------------------- */

/** The set that keeps the appraisal's months, and the columns of each: money in, and the heads of money out before finance. */
export const CASH_FLOW_SET = 'finance.feasibility.periods';
export const CASH_FLOW_MONTH = 'month';
export const CASH_FLOW_IN = 'collections';
export const CASH_FLOW_OUT = ['land', 'approvals', 'construction', 'fees_overheads', 'marketing', 'taxes'] as const;

export interface CashFlowPosition {
  /** The most the scheme is out of pocket before any finance: the deepest the running total goes below nothing. */
  peakFunding: number;
  /** The month it is deepest, as a day number. Absent where it never goes below nothing. */
  peakDay?: number;
  /** The first month after the deepest that the running total is back to nothing or better. */
  paybackDay?: number;
}

/** The running total of dated nets, and where it is deepest. Null with no dated month. */
export function cashFlowPosition(rows: ReadonlyArray<{ day: number; net: number }>): CashFlowPosition | null {
  if (!rows.length) return null;
  const ordered = [...rows].sort((a, b) => a.day - b.day);
  let running = 0;
  let deepest = 0;
  let peakDay: number | undefined;
  let paybackDay: number | undefined;
  for (const row of ordered) {
    running += row.net;
    if (running < deepest) {
      deepest = running;
      peakDay = row.day;
      paybackDay = undefined;
    } else if (peakDay !== undefined && paybackDay === undefined && running >= 0) paybackDay = row.day;
  }
  return { peakFunding: Math.round(-deepest * 100) / 100, ...(peakDay !== undefined ? { peakDay } : {}), ...(paybackDay !== undefined ? { paybackDay } : {}) };
}

function appraisalCashFlow(project: DdProject): CashFlowPosition | null {
  const amount = (value: CheckFieldValue | undefined) => (fieldStands(value) && typeof value?.value === 'number' ? value.value : 0);
  const rows = (project.fieldSheets?.[CASH_FLOW_SET]?.records ?? []).flatMap((record) => {
    const month = record.values[CASH_FLOW_MONTH];
    const day = !record.removed && fieldStands(month) ? dayNumber(month?.value) : null;
    return day === null ? [] : [{ day, net: amount(record.values[CASH_FLOW_IN]) - total(CASH_FLOW_OUT.map((key) => amount(record.values[key]))) }];
  });
  return cashFlowPosition(rows);
}

/* --- The figures ------------------------------------------------------- */

export const PROJECT_FIGURES: readonly ProjectFigure[] = [
  { key: 'project.land_area', label: 'Plot area on the project', from: 'project', read: (p) => positive(p.landAreaSqm) },
  { key: 'project.built_up_area', label: 'Built-up area on the project', from: 'project', read: (p) => positive(p.builtUpAreaSqm) },
  { key: 'project.saleable_area', label: 'Saleable area on the project', from: 'project', read: (p) => positive(p.saleableAreaSqm) },

  { key: 'cost.packages', label: 'Work packages', from: 'cost register', read: (p) => costRegister(p).workPackages.length },
  { key: 'cost.packages_unbudgeted', label: 'Work packages with no budget', from: 'cost register', read: (p) => costRegister(p).workPackages.filter((pack) => pack.budget === undefined).length },
  { key: 'cost.budget', label: 'Budget of the work packages', from: 'cost register', read: (p) => known(costSummary(p).budget) },
  { key: 'cost.contracts', label: 'Contracts', from: 'cost register', read: (p) => costRegister(p).contracts.length },
  { key: 'cost.committed', label: 'Committed under contracts', from: 'cost register', read: (p) => (costRegister(p).contracts.length ? costSummary(p).committed : null) },
  { key: 'cost.certified', label: 'Certified to date', from: 'cost register', read: (p) => (costRegister(p).bills.length ? costSummary(p).certified : null) },
  { key: 'cost.paid', label: 'Paid to date', from: 'cost register', read: (p) => (costRegister(p).bills.length ? costSummary(p).paid : null) },
  { key: 'cost.outstanding', label: 'Certified and not yet paid', from: 'cost register', read: (p) => (costRegister(p).bills.length ? costSummary(p).outstanding : null) },
  { key: 'cost.forecast', label: 'Forecast final cost', from: 'cost register', read: (p) => known(costSummary(p).forecast) },

  { key: 'cost_report.count', label: 'Cost reports', from: 'cost report', read: (p) => costReportsOf(p).length },
  { key: 'cost_report.period_end', label: 'Latest cost report’s period ends', from: 'cost report', read: ofLatestReport((r) => dayNumber(r.to)) },
  { key: 'cost_report.budget', label: 'Budget on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).budget) },
  { key: 'cost_report.po_issued', label: 'Orders issued on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).poIssued) },
  { key: 'cost_report.amount_paid', label: 'Paid on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).amountPaid) },
  { key: 'cost_report.anticipated', label: 'Anticipated cost on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).anticipatedCost) },
  { key: 'cost_report.variations', label: 'Variations in the latest cost report’s period', from: 'cost report', read: ofLatestReport((r) => total((r.variations ?? []).map((v) => v.amount))) },
  { key: 'cost_report.basic_prices', label: 'Basic price adjustments on the latest cost report', from: 'cost report', read: ofLatestReport((r) => total((r.basicPriceAdjustments ?? []).map((line) => line.amount ?? 0))) },
  {
    key: 'cost_report.contingency_drawn',
    label: 'Variations drawn from contingency, over every cost report',
    from: 'cost report',
    read: (p) => (costReportsOf(p).length ? total(costReportsOf(p).flatMap((r) => (r.variations ?? []).filter((v) => v.contingencyDrawn).map((v) => v.amount))) : null),
  },
  {
    key: 'cost_report.unexplained',
    label: 'Movement since the last issued report that nothing explains',
    from: 'cost report',
    read: ofLatestReport((r, p) => {
      const changes = costReportChanges(p, r.id);
      return changes ? total(changes.packages.map((pack) => Math.abs(pack.unexplained))) : null;
    }),
  },

  { key: 'comparables.count', label: 'Comparables in the schedule', from: 'comparable schedule', read: (p) => comparableSchedule(p)?.count ?? 0 },
  { key: 'comparables.short', label: 'Comparables still needed for a schedule', from: 'comparable schedule', read: (p) => Math.max(MIN_SCHEDULE - (comparableSchedule(p)?.count ?? 0), 0) },
  { key: 'comparables.adjusted_rate', label: 'Adjusted comparable rate', from: 'comparable schedule', read: (p) => known(comparableSchedule(p)?.adjustedRate) },
  { key: 'comparables.net_adjustment_pct', label: 'Net adjustment on the comparables', from: 'comparable schedule', read: (p) => known(comparableSchedule(p)?.netAdjustmentPct) },

  { key: 'value.approaches_run', label: 'Approaches that ran', from: 'valuation', read: (p, shared) => valued(p, shared).ran },
  { key: 'value.fair_market', label: 'Fair market value', from: 'valuation', read: (p, shared) => known(valued(p, shared).summary.fairMarket) },
  { key: 'value.low', label: 'Lower end of the range', from: 'valuation', read: (p, shared) => known(valued(p, shared).summary.low) },
  { key: 'value.high', label: 'Upper end of the range', from: 'valuation', read: (p, shared) => known(valued(p, shared).summary.high) },
  { key: 'value.rate_per_sqm', label: 'Value per sqm', from: 'valuation', read: (p, shared) => known(valued(p, shared).summary.ratePerSqm) },
  { key: 'value.guideline', label: 'Guidance value of the plot, from the revenue map', from: 'valuation', read: (p, shared) => known(valued(p, shared).summary.guideline?.value) },

  { key: 'cash_flow.peak_funding', label: 'Peak funding need before finance', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.peakFunding) },
  { key: 'cash_flow.peak_month', label: 'Month of the peak', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.peakDay) },
  { key: 'cash_flow.payback_month', label: 'Month the money is back', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.paybackDay) },
];

const BY_KEY = new Map(PROJECT_FIGURES.map((figure) => [figure.key, figure]));

export function projectFigureDef(key: string): ProjectFigure | undefined {
  return BY_KEY.get(key);
}

/** A reader of the project's figures by key, for one reading of the project. A figure its module cannot give yet is null. */
export function projectFigures(project: DdProject): (key: string) => number | null {
  const shared = new Map<string, unknown>();
  const read = new Map<string, number | null>();
  return (key) => {
    if (!read.has(key)) read.set(key, BY_KEY.get(key)?.read(project, shared) ?? null);
    return read.get(key) ?? null;
  };
}
