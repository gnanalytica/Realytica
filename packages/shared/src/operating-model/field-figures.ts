/**
 * Figures other parts of the product already work out, for a field set to
 * read and never to hold.
 *
 * The schedule, the site log, the tender tracker and the cost register are
 * modules of their own, with their own records and their own screens. A
 * field set does not copy what they keep. It reads a figure of theirs with
 * `{ op: 'figure', key }`, worked out afresh each time from the module's own
 * function, so there is one place a milestone, a site entry or a bid is
 * entered and no second box for it.
 *
 * A figure is a number. A day is given as a day number (`dayNumber`), and
 * the computed field that reads it says `yields: 'date'`. A figure of one
 * thing (a work package's award, its budget) is asked with the id of that
 * thing: the formula names the link that holds it in `of`.
 *
 * A figure that cannot be told is null, never zero: no milestones is not
 * nought per cent complete.
 */

import { dayNumber } from './check-fields';
import { costRegister, costSummary, packagePosition, standingCertification } from './cost';
import { findingIsOpen } from './engineering';
import { scheduleWatch } from './milestone-schedule';
import { progressSummary } from './progress';
import { tenderComparison, tenderStagesPastDue, tendersOf, type Tender } from './tenders';
import type { DdProject } from './types';

export interface ProjectFigure {
  label: string;
  /** The part of the product that keeps it, as a person knows it. */
  from: string;
  /** What it is a figure of, where it is of one thing and not of the project. */
  of?: 'package';
  read(project: DdProject, at: Date, of?: string): number | null;
}

const day = (value: string | undefined): number | null => dayNumber(value);

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
};

/** A figure by its key, or null where there is none by that key or it cannot be told. */
export function projectFigure(project: DdProject, key: string, at: Date, of?: string): number | null {
  const figure = PROJECT_FIGURES[key];
  if (!figure) return null;
  const value = figure.read(project, at, of);
  return value !== null && Number.isFinite(value) ? value : null;
}
