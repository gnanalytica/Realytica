/**
 * Finance › Budget: what moved between two Cost Reports, and why.
 *
 * A Cost Report is read against the one issued before it: what each package
 * stood at then, what it stands at now, and what accounts for the difference.
 * Two things on the report can account for a change in a package's
 * anticipated cost. A variation logged on the current report against that
 * package accounts for its own amount. A package awarded since the last
 * report (no PO then, one now) accounts for the step from the last forecast
 * to the awarded value, and never for more of the change than that step.
 *
 * Whatever is left is `unexplained`, and is kept as its own figure on the
 * package it belongs to. It is not spread over other packages and a typed
 * reason does not take it away: the reason is shown beside it.
 *
 * A package on one report and not the other is `added` or `removed`. Its side
 * that does not exist is absent, not zero, and its coming or going is the
 * reason for its whole amount.
 */

import type { DdProject } from './types';
import { billPosition, costRegister, type CostBill } from './cost';
import { costReportIssuedBefore, costReportOf, costReportTotals, type CostReportPackageRow, type CostReportPeriod, type CostReportStatus } from './cost-report';

/** The figures of a package row that are compared, by the field that holds each. `variations` is the sum logged against it. */
export type CostReportFigure = 'budget' | 'poIssued' | 'variations' | 'amountPaid' | 'anticipatedCost';

export const COST_REPORT_FIGURES: readonly CostReportFigure[] = ['budget', 'poIssued', 'variations', 'amountPaid', 'anticipatedCost'];

/** One figure then and now. A side is absent where the package was not on that report. */
export interface CostReportMovement {
  previous?: number;
  current?: number;
  /** current − previous, with an absent side counted as nothing. */
  change: number;
}

/** A figure of the whole report then and now. */
export interface CostReportTotalMovement {
  previous: number;
  current: number;
  change: number;
}

export type CostReportPackageStatus = 'unchanged' | 'moved' | 'added' | 'removed';

/** What on the report accounts for part of a package's change in anticipated cost. */
export type CostReportChangeCause =
  | {
      kind: 'variation';
      variationId: string;
      description: string;
      amount: number;
      contingencyDrawn?: true;
      dated?: string;
    }
  | {
      kind: 'award';
      /** The PO issued, on a package that had none on the last report. */
      poIssued: number;
      /** How much of the change the award accounts for. */
      amount: number;
    };

export interface CostReportPackageChange {
  workPackageId: string;
  code?: string;
  name: string;
  status: CostReportPackageStatus;
  figures: Record<CostReportFigure, CostReportMovement>;
  causes: CostReportChangeCause[];
  /** The part of the change in anticipated cost that no cause accounts for. Nothing on a package that was added or removed. */
  unexplained: number;
  /** The one line a person typed against this change, kept on the current report. */
  reason?: string;
}

export interface CostReportSide {
  id: string;
  label: string;
  from: string;
  to: string;
  status: CostReportStatus;
  issuedAt?: string;
}

/** Running bills dated after the last report's period and up to the end of this one. */
export interface CostReportBilled {
  bills: number;
  /** Bills among them with no certificate standing, so nothing of theirs is in `certified`. */
  awaitingCertificate: number;
  claimed: number;
  /** Gross, under the certificates that stand. */
  certified: number;
  /** claimed − certified. */
  difference: number;
}

export interface CostReportComparison {
  previous: CostReportSide;
  current: CostReportSide;
  /** The current report's packages in its order, then the ones removed since the last. */
  packages: CostReportPackageChange[];
  totals: {
    figures: Record<CostReportFigure, CostReportTotalMovement>;
    /** Anticipated cost less budget, then and now: the forecast against the budget. */
    forecastAgainstBudget: CostReportTotalMovement;
    /** What variations and awards account for, on packages that are on both reports. */
    explained: number;
    /** Anticipated cost of the packages added, and of the packages removed. */
    added: number;
    removed: number;
    /** The sum of the packages' unexplained amounts, and how many packages have one. */
    unexplained: number;
    unexplainedPackages: number;
  };
  /** Variations on the current report that name no package. They are set against no package's change. */
  unassignedVariations: Array<Extract<CostReportChangeCause, { kind: 'variation' }>>;
  decisions: {
    /** Packages now expected to cost more than their budget. */
    overBudget: Array<{ workPackageId: string; code?: string; name: string; budget: number; anticipatedCost: number; over: number }>;
    /** Packages with no PO issued. */
    unawarded: Array<{ workPackageId: string; code?: string; name: string; budget: number }>;
  };
  /** Absent when no running bill is dated in the span. */
  billed?: CostReportBilled;
}

function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

const sum = (amounts: readonly number[]): number => amounts.reduce((paise, amount) => paise + inPaise(amount), 0) / 100;
const less = (a: number, b: number): number => (inPaise(a) - inPaise(b)) / 100;

function sideOf(report: CostReportPeriod): CostReportSide {
  return {
    id: report.id,
    label: report.label,
    from: report.from,
    to: report.to,
    status: report.status,
    ...(report.issuedAt ? { issuedAt: report.issuedAt } : {}),
  };
}

function variationCauses(report: CostReportPeriod, workPackageId: string | undefined): Array<Extract<CostReportChangeCause, { kind: 'variation' }>> {
  return (report.variations ?? [])
    .filter((v) => v.workPackageId === workPackageId)
    .map((v) => ({
      kind: 'variation' as const,
      variationId: v.id,
      description: v.description,
      amount: v.amount,
      ...(v.contingencyDrawn ? { contingencyDrawn: true as const } : {}),
      ...(v.dated ? { dated: v.dated } : {}),
    }));
}

function figuresOf(report: CostReportPeriod, row: CostReportPackageRow): Record<CostReportFigure, number> {
  return {
    budget: row.budget,
    poIssued: row.poIssued,
    variations: sum(variationCauses(report, row.workPackageId).map((v) => v.amount)),
    amountPaid: row.amountPaid,
    anticipatedCost: row.anticipatedCost,
  };
}

/**
 * How much of what is left of a change an award accounts for: the step from
 * the last forecast to the awarded value, where the change goes the same way,
 * and no more of the change than there is.
 */
function awardShare(left: number, step: number): number {
  if (left === 0 || step === 0 || Math.sign(left) !== Math.sign(step)) return 0;
  return Math.sign(left) * Math.min(Math.abs(left), Math.abs(step));
}

/** The decisions a Cost Report's own figures ask for: packages forecast over their budget, and packages with no PO issued. */
export function costReportDecisions(report: Pick<CostReportPeriod, 'rows'>): CostReportComparison['decisions'] {
  return {
    overBudget: report.rows
      .filter((row) => row.anticipatedCost > row.budget)
      .map((row) => ({
        workPackageId: row.workPackageId,
        ...(row.code ? { code: row.code } : {}),
        name: row.name,
        budget: row.budget,
        anticipatedCost: row.anticipatedCost,
        over: less(row.anticipatedCost, row.budget),
      })),
    unawarded: report.rows
      .filter((row) => row.poIssued === 0)
      .map((row) => ({ workPackageId: row.workPackageId, ...(row.code ? { code: row.code } : {}), name: row.name, budget: row.budget })),
  };
}

/** What the running bills dated after one day and up to another claim, and what stands certified on them. Nothing when none is dated there. */
export function costReportBilled(bills: readonly CostBill[], after: string, upTo: string): CostReportBilled | undefined {
  const dated = bills.filter((bill) => bill.date > after && bill.date <= upTo).map(billPosition);
  if (!dated.length) return undefined;
  const claimed = sum(dated.map((bill) => bill.claimed));
  const certified = sum(dated.map((bill) => bill.gross ?? 0));
  return { bills: dated.length, awaitingCertificate: dated.filter((bill) => bill.gross === undefined).length, claimed, certified, difference: less(claimed, certified) };
}

/**
 * Compare two Cost Reports of one project: `previous` is the earlier one.
 * `bills` are the project's running bills, for what was claimed and certified
 * between the two periods.
 */
export function compareCostReports(previous: CostReportPeriod, current: CostReportPeriod, bills: readonly CostBill[] = []): CostReportComparison {
  const before = new Map(previous.rows.map((row) => [row.workPackageId, row]));
  const now = new Set(current.rows.map((row) => row.workPackageId));
  const reasons = current.changeReasons ?? {};
  const packages: CostReportPackageChange[] = [];

  for (const row of current.rows) {
    const held = before.get(row.workPackageId);
    const said = { workPackageId: row.workPackageId, ...(row.code ? { code: row.code } : {}), name: row.name };
    const reason = reasons[row.workPackageId];
    const variations = variationCauses(current, row.workPackageId);
    const currentFigures = figuresOf(current, row);
    if (!held) {
      packages.push({
        ...said,
        status: 'added',
        figures: Object.fromEntries(COST_REPORT_FIGURES.map((f) => [f, { current: currentFigures[f], change: currentFigures[f] }])) as Record<CostReportFigure, CostReportMovement>,
        causes: variations,
        unexplained: 0,
        ...(reason ? { reason } : {}),
      });
      continue;
    }
    const previousFigures = figuresOf(previous, held);
    const figures = Object.fromEntries(
      COST_REPORT_FIGURES.map((f) => [f, { previous: previousFigures[f], current: currentFigures[f], change: less(currentFigures[f], previousFigures[f]) }]),
    ) as Record<CostReportFigure, CostReportMovement>;
    const causes: CostReportChangeCause[] = [...variations];
    let left = less(figures.anticipatedCost.change, sum(variations.map((v) => v.amount)));
    if (held.poIssued === 0 && row.poIssued > 0) {
      const amount = awardShare(left, less(row.poIssued, held.anticipatedCost));
      causes.push({ kind: 'award', poIssued: row.poIssued, amount });
      left = less(left, amount);
    }
    packages.push({
      ...said,
      status: COST_REPORT_FIGURES.some((f) => figures[f].change !== 0) ? 'moved' : 'unchanged',
      figures,
      causes,
      unexplained: left,
      ...(reason ? { reason } : {}),
    });
  }

  for (const row of previous.rows) {
    if (now.has(row.workPackageId)) continue;
    const previousFigures = figuresOf(previous, row);
    const reason = reasons[row.workPackageId];
    packages.push({
      workPackageId: row.workPackageId,
      ...(row.code ? { code: row.code } : {}),
      name: row.name,
      status: 'removed',
      figures: Object.fromEntries(COST_REPORT_FIGURES.map((f) => [f, { previous: previousFigures[f], change: less(0, previousFigures[f]) }])) as Record<CostReportFigure, CostReportMovement>,
      causes: [],
      unexplained: 0,
      ...(reason ? { reason } : {}),
    });
  }

  const then = costReportTotals(previous);
  const today = costReportTotals(current);
  const total = (a: number, b: number): CostReportTotalMovement => ({ previous: a, current: b, change: less(b, a) });
  const allVariations = (report: CostReportPeriod): number => sum((report.variations ?? []).map((v) => v.amount));
  const stayed = packages.filter((p) => p.status === 'moved' || p.status === 'unchanged');
  const unexplained = packages.filter((p) => p.unexplained !== 0);

  const billed = costReportBilled(bills, previous.to, current.to);

  return {
    previous: sideOf(previous),
    current: sideOf(current),
    packages,
    totals: {
      figures: {
        budget: total(then.budget, today.budget),
        poIssued: total(then.poIssued, today.poIssued),
        variations: total(allVariations(previous), allVariations(current)),
        amountPaid: total(then.amountPaid, today.amountPaid),
        anticipatedCost: total(then.anticipatedCost, today.anticipatedCost),
      },
      forecastAgainstBudget: total(then.anticipatedVariance, today.anticipatedVariance),
      explained: sum(stayed.flatMap((p) => p.causes.map((cause) => cause.amount))),
      added: sum(packages.filter((p) => p.status === 'added').map((p) => p.figures.anticipatedCost.change)),
      removed: sum(packages.filter((p) => p.status === 'removed').map((p) => p.figures.anticipatedCost.previous ?? 0)),
      unexplained: sum(unexplained.map((p) => p.unexplained)),
      unexplainedPackages: unexplained.length,
    },
    unassignedVariations: variationCauses(current, undefined),
    decisions: costReportDecisions(current),
    ...(billed ? { billed } : {}),
  };
}

/** The report a Cost Report is read against: the last one issued for an earlier period. */
export function previousCostReport(project: Pick<DdProject, 'costReports'>, reportId: string): CostReportPeriod | undefined {
  return costReportIssuedBefore(project, costReportOf(project, reportId));
}

/** What moved on a Cost Report since the one issued before it. Absent when none was. */
export function costReportChanges(project: Pick<DdProject, 'costReports' | 'cost'>, reportId: string): CostReportComparison | undefined {
  const previous = previousCostReport(project, reportId);
  return previous ? compareCostReports(previous, costReportOf(project, reportId), costRegister(project).bills) : undefined;
}

/** The packages whose anticipated cost moved most, largest first. */
export function largestCostMovements(comparison: Pick<CostReportComparison, 'packages'>, count = 3): CostReportPackageChange[] {
  return comparison.packages
    .filter((p) => p.figures.anticipatedCost.change !== 0)
    .sort((a, b) => Math.abs(b.figures.anticipatedCost.change) - Math.abs(a.figures.anticipatedCost.change))
    .slice(0, count);
}
