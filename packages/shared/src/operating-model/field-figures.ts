/**
 * Figures other parts of the product already work out, for a field set to
 * read and never to hold.
 *
 * The schedule, the site log, the tender tracker, the cost register, the
 * monthly cost report, the comparable schedule and the valuation are modules
 * of their own, with their own records, screens and rules. A field set does
 * not copy what they keep and does not rewrite them. A computed field reads
 * a figure of theirs with `{ op: 'figure', key }`, worked out afresh each
 * time the sheet is read from the module's own function, so there is one
 * place a milestone, a bill, a comparable or a bid is entered and no second
 * box for it.
 *
 * Read-only by construction: a figure is a function of the project, and
 * nothing writes through it. A figure is a number. A day is given as a day
 * number (`dayNumber`), and the computed field that reads it says
 * `yields: 'date'`. A figure of one thing (a work package's award, its
 * budget) is asked with the id of that thing: the formula names the own link
 * that holds it in `of`. A figure that cannot be told is null, never zero:
 * no milestones is not nought per cent complete. The catalog test refuses a
 * formula naming a figure that is not here.
 *
 * This is the one door from the field system to those modules
 * (docs/fields.md, Formulas). A module that wants a figure read adds a row
 * to `PROJECT_FIGURES`.
 */

import { dayNumber, fieldStands } from './check-fields';
import { MIN_SCHEDULE, comparableSchedule } from './comparables';
import { costRegister, costSummary, packagePosition, standingCertification } from './cost';
import { costReportPeriodOrder, costReportsOf, costReportTotals, type CostReportPeriod } from './cost-report';
import { costReportChanges } from './cost-report-compare';
import { findingIsOpen } from './engineering';
import { scheduleWatch } from './milestone-schedule';
import { milestoneExtensions, progressSummary } from './progress';
import { tenderComparison, tenderStagesPastDue, tendersOf, variationOffersWaiting, type Tender } from './tenders';
import { approachIsUsable } from './valuation-model';
import { runValuationApproaches } from './valuation-run';
import { valueSummary, type ValueSummary } from './value-standing';
import type { CheckFieldValue, DdProject } from './types';

export interface ProjectFigure {
  label: string;
  /** The part of the product that keeps it, as a person knows it. */
  from: string;
  /** What it is a figure of, where it is of one thing and not of the project. */
  of?: 'package';
  /** `shared` lasts one reading of the project, so several figures of one module work it out once. */
  read(project: DdProject, at: Date, of: string | undefined, shared: Map<string, unknown>): number | null;
}

const day = (value: string | undefined): number | null => dayNumber(value);
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

/** The site log's entries of the days up to and including today, newest first. */
function entries(project: DdProject, at: Date, withinDays?: number) {
  const today = dayNumber(at.toISOString().slice(0, 10))!;
  return (project.siteLog ?? []).filter((entry) => {
    const on = dayNumber(entry.date);
    return on !== null && on <= today && (withinDays === undefined || today - on < withinDays);
  });
}

const workers = (entry: { manpower: Array<{ count: number }> }): number => entry.manpower.reduce((total, row) => total + row.count, 0);

/** Workers by day: one day's count is the most any one entry of that day reports, so two reports of a day do not double it. */
function workersByDay(project: DdProject, at: Date, withinDays?: number): number[] {
  const byDay = new Map<string, number>();
  for (const entry of entries(project, at, withinDays)) byDay.set(entry.date, Math.max(byDay.get(entry.date) ?? 0, workers(entry)));
  return [...byDay.values()];
}

const tenderOfPackage = (project: DdProject, packageId: string | undefined): Tender | undefined => tendersOf(project).find((tender) => tender.workPackageId === packageId);
const packageOf = (project: DdProject, packageId: string | undefined) => costRegister(project).workPackages.find((pack) => pack.id === packageId);
const contractOfPackage = (project: DdProject, packageId: string | undefined) => costRegister(project).contracts.find((contract) => packageId !== undefined && contract.workPackageIds.includes(packageId));

export const PROJECT_FIGURES: Readonly<Record<string, ProjectFigure>> = {
  /* --- Progress and the schedule ------------------------------------- */
  'progress.percent': { label: 'Progress, by the weight of the milestones', from: 'Milestones', read: (project, at) => progressSummary(project, at).percent },
  'progress.milestones': { label: 'Milestones', from: 'Milestones', read: (project) => (project.milestones?.length ? project.milestones.length : null) },
  'progress.milestones_complete': { label: 'Milestones complete', from: 'Milestones', read: (project, at) => (project.milestones?.length ? progressSummary(project, at).complete : null) },
  'progress.milestones_late': { label: 'Milestones past their planned finish', from: 'Milestones', read: (project, at) => (project.milestones?.length ? progressSummary(project, at).late.length : null) },
  'schedule.planned_completion': { label: 'Planned completion', from: 'Schedule', read: (project, at) => day(scheduleWatch(project, at).plannedCompletion) },
  'schedule.projected_completion': { label: 'Completion at the current rate', from: 'Schedule', read: (project, at) => day(scheduleWatch(project, at).projectedCompletion) },
  'schedule.projected_days_late': {
    label: 'Days late at the current rate',
    from: 'Schedule',
    read: (project, at) => {
      const watch = scheduleWatch(project, at);
      // Told only once there is a rate to project from: before that it is not known, and not nought.
      return watch.projectedCompletion ? (watch.projectedDaysLate ?? 0) : null;
    },
  },

  /* --- What extensions of time granted do to the schedule ------------- */
  'schedule.extension_days': { label: 'Days the extensions granted move planned completion', from: 'Schedule', read: (project, at) => (project.milestones?.length ? (scheduleWatch(project, at).extensionDays ?? 0) : null) },
  'schedule.completion_before_extensions': { label: 'Planned completion before the extensions granted', from: 'Schedule', read: (project, at) => day(scheduleWatch(project, at).completionBeforeExtensions) },
  'schedule.extension_unplaced': { label: 'Days granted on contracts whose package serves no milestone', from: 'Schedule', read: (project, at) => scheduleWatch(project, at).extensionUnplaced ?? 0 },
  'schedule.extension_most': { label: 'Most days of extension granted on one contract', from: 'Time claims', read: (project) => milestoneExtensions(project).most },


  /* --- The site log --------------------------------------------------- */
  'site_log.days_reported': { label: 'Days with a site log', from: 'Site log', read: (project, at) => new Set(entries(project, at).map((entry) => entry.date)).size },
  'site_log.days_reported_recent': { label: 'Days with a site log, of the last thirty', from: 'Site log', read: (project, at) => new Set(entries(project, at, 30).map((entry) => entry.date)).size },
  'site_log.last_entry_day': { label: 'Last day reported', from: 'Site log', read: (project, at) => day(entries(project, at).map((entry) => entry.date).sort().at(-1)) },
  'site_log.workers_latest': {
    label: 'Workers on the last day reported',
    from: 'Site log',
    read: (project, at) => {
      const last = entries(project, at).map((entry) => entry.date).sort().at(-1);
      return last ? Math.max(...entries(project, at).filter((entry) => entry.date === last).map(workers)) : null;
    },
  },
  'site_log.workers_average_recent': {
    label: 'Workers a day, over the last thirty days reported',
    from: 'Site log',
    read: (project, at) => {
      const counts = workersByDay(project, at, 30);
      return counts.length ? counts.reduce((total, n) => total + n, 0) / counts.length : null;
    },
  },
  'site_log.worker_days': {
    label: 'Worker-days reported',
    from: 'Site log',
    read: (project, at) => {
      const counts = workersByDay(project, at);
      return counts.length ? counts.reduce((total, n) => total + n, 0) : null;
    },
  },
  'site_log.hindrances': { label: 'Hindrances reported from site', from: 'Site log', read: (project, at) => entries(project, at).reduce((total, entry) => total + entry.issues.length, 0) },

  /* --- Site visits and what was observed ------------------------------ */
  'observations.open': { label: 'Observations open', from: 'Observations', read: (project) => project.findings.filter(findingIsOpen).length },
  'observations.open_serious': { label: 'Observations open at high or critical', from: 'Observations', read: (project) => project.findings.filter((finding) => findingIsOpen(finding) && (finding.severity === 'high' || finding.severity === 'critical')).length },

  /* --- Tenders -------------------------------------------------------- */
  'tenders.count': { label: 'Tenders', from: 'Tenders', read: (project) => tendersOf(project).length },
  'tenders.awarded': { label: 'Packages with a letter of acceptance', from: 'Tenders', read: (project) => tendersOf(project).filter((tender) => tender.award).length },
  'tenders.contract_signed': { label: 'Tenders with the contract signed', from: 'Tenders', read: (project) => tendersOf(project).filter((tender) => tender.stages.find((stage) => stage.key === 'contract_signed')?.doneOn).length },
  'tenders.stages_late': { label: 'Tender stages past their date', from: 'Tenders', read: (project, at) => tenderStagesPastDue(project, at).length },

  /* --- The cost register ---------------------------------------------- */
  'cost.packages': { label: 'Work packages', from: 'Cost register', read: (project) => costRegister(project).workPackages.length },
  'cost.committed': { label: 'Committed under contracts', from: 'Cost register', read: (project) => (costRegister(project).contracts.length ? costSummary(project).committed : null) },
  'cost.certified': { label: 'Certified to date', from: 'Cost register', read: (project) => (costRegister(project).bills.length ? costSummary(project).certified : null) },
  'cost.retention_held': {
    label: 'Retention held on certified bills',
    from: 'Cost register',
    read: (project) => {
      const certificates = costRegister(project).bills.flatMap((bill) => standingCertification(bill) ?? []);
      return certificates.length ? certificates.reduce((total, certificate) => total + certificate.deductions.filter((d) => d.kind === 'retention').reduce((n, d) => n + d.amount, 0), 0) : null;
    },
  },

  /* --- One work package ----------------------------------------------- */
  'package.budget': { label: 'Budget of the package', from: 'Cost register', of: 'package', read: (project, _at, of) => packageOf(project, of)?.budget ?? null },
  'package.need_day': {
    label: 'Planned start of the milestone the package serves',
    from: 'Schedule',
    of: 'package',
    read: (project, _at, of) => day((project.milestones ?? []).find((milestone) => milestone.id === packageOf(project, of)?.milestoneId)?.plannedStart),
  },
  'package.estimate': { label: 'Pre-tender estimate', from: 'Tenders', of: 'package', read: (project, _at, of) => tenderOfPackage(project, of)?.estimate ?? null },
  'package.bids': {
    label: 'Bids priced',
    from: 'Tenders',
    of: 'package',
    read: (project, _at, of) => {
      const tender = tenderOfPackage(project, of);
      return tender ? tenderComparison(tender).bids.filter((bid) => bid.amount !== undefined).length : null;
    },
  },
  'package.lowest_bid': {
    label: 'Lowest bid',
    from: 'Tenders',
    of: 'package',
    read: (project, _at, of) => {
      const amounts = (tenderOfPackage(project, of) ? tenderComparison(tenderOfPackage(project, of)!).bids : []).flatMap((bid) => (bid.amount === undefined ? [] : [bid.amount]));
      return amounts.length ? Math.min(...amounts) : null;
    },
  },
  'package.award_value': { label: 'Value in the letter of acceptance', from: 'Tenders', of: 'package', read: (project, _at, of) => tenderOfPackage(project, of)?.award?.value ?? null },
  'package.award_day': { label: 'Letter of acceptance dated', from: 'Tenders', of: 'package', read: (project, _at, of) => day(tenderOfPackage(project, of)?.award?.letterOn) },
  'package.contract_value': { label: 'Value of the contract covering the package', from: 'Cost register', of: 'package', read: (project, _at, of) => contractOfPackage(project, of)?.value ?? null },
  'package.certified': { label: 'Certified against the package', from: 'Cost register', of: 'package', read: (project, _at, of) => (packageOf(project, of) ? packagePosition(project, of!).certified : null) },

  /* --- The project, the cost register, the cost report, the comparables, the valuation and the appraisal cash flow --- */
  'project.land_area': { label: 'Plot area on the project', from: 'project', read: (p) => positive(p.landAreaSqm) },
  'project.built_up_area': { label: 'Built-up area on the project', from: 'project', read: (p) => positive(p.builtUpAreaSqm) },
  'project.saleable_area': { label: 'Saleable area on the project', from: 'project', read: (p) => positive(p.saleableAreaSqm) },

  'cost.packages_unbudgeted': { label: 'Work packages with no budget', from: 'cost register', read: (p) => costRegister(p).workPackages.filter((pack) => pack.budget === undefined).length },
  'cost.budget': { label: 'Budget of the work packages', from: 'cost register', read: (p) => known(costSummary(p).budget) },
  'cost.contracts': { label: 'Contracts', from: 'cost register', read: (p) => costRegister(p).contracts.length },
  'cost.paid': { label: 'Paid to date', from: 'cost register', read: (p) => (costRegister(p).bills.length ? costSummary(p).paid : null) },
  'cost.outstanding': { label: 'Certified and not yet paid', from: 'cost register', read: (p) => (costRegister(p).bills.length ? costSummary(p).outstanding : null) },
  'cost.forecast': { label: 'Forecast final cost', from: 'cost register', read: (p) => known(costSummary(p).forecast) },

  'cost_report.count': { label: 'Cost reports', from: 'cost report', read: (p) => costReportsOf(p).length },
  'cost_report.period_end': { label: 'Latest cost report’s period ends', from: 'cost report', read: ofLatestReport((r) => dayNumber(r.to)) },
  'cost_report.budget': { label: 'Budget on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).budget) },
  'cost_report.po_issued': { label: 'Orders issued on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).poIssued) },
  'cost_report.amount_paid': { label: 'Paid on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).amountPaid) },
  'cost_report.anticipated': { label: 'Anticipated cost on the latest cost report', from: 'cost report', read: ofLatestReport((r) => costReportTotals(r).anticipatedCost) },
  'cost_report.variations': { label: 'Variations in the latest cost report’s period', from: 'cost report', read: ofLatestReport((r) => total((r.variations ?? []).map((v) => v.amount))) },
  'cost_report.basic_prices': { label: 'Basic price adjustments on the latest cost report', from: 'cost report', read: ofLatestReport((r) => total((r.basicPriceAdjustments ?? []).map((line) => line.amount ?? 0))) },
  'cost_report.variation_offers': { label: 'Approved variations waiting on Finance', from: 'cost report', read: (p) => variationOffersWaiting(p).length },
  'cost_report.variation_offers_value': { label: 'Approved variations not yet on the Cost Report', from: 'cost report', read: (p) => total(variationOffersWaiting(p).map((offer) => offer.amount)) },
  'cost_report.contingency_drawn': { label: 'Variations drawn from contingency, over every cost report',
    from: 'cost report',
    read: (p) => (costReportsOf(p).length ? total(costReportsOf(p).flatMap((r) => (r.variations ?? []).filter((v) => v.contingencyDrawn).map((v) => v.amount))) : null),
  },
  'cost_report.unexplained': { label: 'Movement since the last issued report that nothing explains',
    from: 'cost report',
    read: ofLatestReport((r, p) => {
      const changes = costReportChanges(p, r.id);
      return changes ? total(changes.packages.map((pack) => Math.abs(pack.unexplained))) : null;
    }),
  },

  'comparables.count': { label: 'Comparables in the schedule', from: 'comparable schedule', read: (p) => comparableSchedule(p)?.count ?? 0 },
  'comparables.short': { label: 'Comparables still needed for a schedule', from: 'comparable schedule', read: (p) => Math.max(MIN_SCHEDULE - (comparableSchedule(p)?.count ?? 0), 0) },
  'comparables.adjusted_rate': { label: 'Adjusted comparable rate', from: 'comparable schedule', read: (p) => known(comparableSchedule(p)?.adjustedRate) },
  'comparables.net_adjustment_pct': { label: 'Net adjustment on the comparables', from: 'comparable schedule', read: (p) => known(comparableSchedule(p)?.netAdjustmentPct) },

  'value.approaches_run': { label: 'Approaches that ran', from: 'valuation', read: (p, _at, _of, shared) => valued(p, shared).ran },
  'value.fair_market': { label: 'Fair market value', from: 'valuation', read: (p, _at, _of, shared) => known(valued(p, shared).summary.fairMarket) },
  'value.low': { label: 'Lower end of the range', from: 'valuation', read: (p, _at, _of, shared) => known(valued(p, shared).summary.low) },
  'value.high': { label: 'Upper end of the range', from: 'valuation', read: (p, _at, _of, shared) => known(valued(p, shared).summary.high) },
  'value.rate_per_sqm': { label: 'Value per sqm', from: 'valuation', read: (p, _at, _of, shared) => known(valued(p, shared).summary.ratePerSqm) },
  'value.guideline': { label: 'Guidance value of the plot, from the revenue map', from: 'valuation', read: (p, _at, _of, shared) => known(valued(p, shared).summary.guideline?.value) },

  'cash_flow.peak_funding': { label: 'Peak funding need before finance', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.peakFunding) },
  'cash_flow.peak_month': { label: 'Month of the peak', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.peakDay) },
  'cash_flow.payback_month': { label: 'Month the money is back', from: 'appraisal cash flow', read: (p) => known(appraisalCashFlow(p)?.paybackDay) },
};

/** A figure by its key, or null where there is none by that key or it cannot be told. `shared` is one reading's memo: pass the same map for every figure of that reading. */
export function projectFigure(project: DdProject, key: string, at: Date, of?: string, shared: Map<string, unknown> = new Map()): number | null {
  const figure = PROJECT_FIGURES[key];
  if (!figure) return null;
  const value = figure.read(project, at, of, shared);
  return value !== null && Number.isFinite(value) ? value : null;
}
