/**
 * The owner pack: one paper for the owner, for a period, in place of a
 * status note and a cost report from several hands.
 *
 * It is made by code from the record, as the status report is, so asked
 * twice of the same record on the same day it is the same pack. No model
 * writes a line of it. Six sections, always in this order and always there:
 * where the project stands, time, cost, the decisions needed from the owner,
 * what was decided and who owes what, and the papers owed. A section with
 * nothing in it says so in one line.
 *
 * Every line names what it was read from: the Cost Report with who issued
 * it, the meeting whose notes it came out of, the milestone and the day it
 * was last reported, the checklist.
 *
 * Only what a named person has accepted is in it. Cost is read from a Cost
 * Report that was issued and never from a draft. A decision or an action out
 * of a meeting's notes is shown once a person has accepted its card; what
 * still waits on a card is counted in one line and not shown.
 *
 * The period governs what belongs to a period: which Cost Report, which
 * running bills, which meetings. Where the period has ended, how far along
 * the work is, the schedule and the functions' own fields are read as the
 * record stood when its last day ended (`projectAsAt`), and the pack says the
 * day: a pack for September made in October does not move with October's
 * site reports. The stage and the papers owed keep no past, and are told as
 * the record stands on the day the pack is made.
 */

import { asAtMoment, isPastDay, projectAsAt } from './as-at';
import { DECISION_STATUS_LABEL } from './catalogs';
import { checklistOwed } from './checklist';
import { costRegister, moneySaid } from './cost';
import { costReportIssuedBefore, costReportPeriodOrder, costReportsOf, costReportTotals, type CostReportPeriod } from './cost-report';
import { costReportBottomLine } from './cost-report-totals';
import { compareCostReports, costReportBilled, costReportDecisions, largestCostMovements, packageAwaitsNoAward, type CostReportChangeCause, type CostReportPackageChange } from './cost-report-compare';
import { DEPARTMENT_SHORT, stageAndStep } from './departments';
import { meetingCalled, meetingDay, meetingItemStands, meetingsHeld } from './meetings';
import { progressReadings, scheduleWatch, type MilestoneWatch, type ScheduleLevel } from './milestone-schedule';
import { progressSummary } from './progress';
import { quarterOfKey } from './quarters';
import { ownerPackPhotos } from './photo-report';
import { ownerPackFields } from './report-fields';
import { requirementSheet } from './requirement-sheet';
import { recordBehind, statusPeriodSaid, type StatusPeriod } from './status-report';
import { personSaid } from './team';
import type { DdProject, ResolvedReportBlock } from './types';

export type OwnerPackSectionKey = 'standing' | 'time' | 'cost' | 'decisions' | 'meetings' | 'papers';

export interface OwnerPackLine {
  what: string;
  /** The report, paper or register the line is read from. */
  source: string;
  /** The day it is of, or is due by. */
  when?: string;
  who?: string;
  /** Past its date. */
  overdue?: boolean;
  recordId?: string;
}

export interface OwnerPackPart {
  /** Absent where a section is one list. */
  heading?: string;
  lines: OwnerPackLine[];
  /** Said in one line where there are no lines. */
  empty: string;
  /** What the lines leave out, in one line. */
  note?: string;
  /** The lines past the few a page gives, in the same order: read behind “more”, and not printed. */
  more?: OwnerPackLine[];
  /** The whole part is detail: read behind “more”, and not printed. */
  detail?: boolean;
}

export interface OwnerPackSection {
  key: OwnerPackSectionKey;
  title: string;
  parts: OwnerPackPart[];
  /** What the section was read from, said once for the section. A line keeps its own source as well, for whoever asks of one line. */
  source?: string;
  /**
   * What the functions' own fields record of this section, each value with
   * where it stands and where it came from (`ownerPackFields`). Absent where
   * the project keeps none of them.
   */
  fields?: ResolvedReportBlock;
  /** The photo stations' shots for the period beside the period before (`ownerPackPhotos`). Absent where the project keeps no station. */
  photos?: ResolvedReportBlock;
}

export interface OwnerPack {
  period: StatusPeriod;
  /** The period in words: "September 2026". */
  periodSaid: string;
  /** The day the record was read on. */
  asOf: string;
  /** Where the period had ended by then: its last day, as at which the standing, the schedule and the functions' fields are read. */
  asAt?: string;
  /** The six sections, in their order. */
  sections: OwnerPackSection[];
}

/** A milestone planned to finish within this many days is due soon. */
export const OWNER_PACK_DUE_DAYS = 30;
/** How many package movements the cost section gives. */
export const OWNER_PACK_MOVEMENTS = 3;
/** How many papers are listed under one party; the rest are counted. */
export const OWNER_PACK_PAPERS_SHOWN = 8;
/** How many lines a part of the pack gives on the page; the rest are behind “more”. */
export const OWNER_PACK_LINES_SHOWN = 5;
/** How many parties the papers owed are summed up for on the page. */
export const OWNER_PACK_PARTIES_SHOWN = 6;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const titled = (title: string): string => `“${title.replace(/[.\s]+$/, '')}”`;
const packageLabel = (pack: { code?: string; name: string }): string => [pack.code, pack.name].filter(Boolean).join(' · ');

/**
 * The period a pack is asked for: a month by `YYYY-MM`, a quarter by its key
 * (`FY2026-Q2` of the financial year, `2026-Q3` of the calendar year), or two
 * days, both taken in. The month the pack is made in when none is given or
 * readable.
 */
export function ownerPackPeriod(asked: { month?: string | null; quarter?: string | null; from?: string | null; to?: string | null }, now = new Date()): StatusPeriod {
  const month = (year: number, at: number): StatusPeriod => ({ from: new Date(Date.UTC(year, at, 1)).toISOString(), to: new Date(Date.UTC(year, at + 1, 1)).toISOString() });
  const named = /^(\d{4})-(\d{2})$/.exec(asked.month ?? '');
  if (named && Number(named[2]) >= 1 && Number(named[2]) <= 12) return month(Number(named[1]), Number(named[2]) - 1);
  const quarter = quarterOfKey(asked.quarter);
  if (quarter) return quarter;
  const [from, to] = [Date.parse(`${asked.from}T00:00:00.000Z`), Date.parse(`${asked.to}T00:00:00.000Z`)];
  if (DAY.test(asked.from ?? '') && DAY.test(asked.to ?? '') && from <= to) return { from: new Date(from).toISOString(), to: new Date(to + DAY_MS).toISOString() };
  return month(now.getUTCFullYear(), now.getUTCMonth());
}

/** What a pack is called: the project and the period. */
export function ownerPackTitle(project: Pick<DdProject, 'name'>, period: StatusPeriod): string {
  return `Owner pack — ${project.name}, ${statusPeriodSaid(period)}`;
}

/**
 * The Cost Report a pack reads for a period: the latest one issued whose own
 * period ends on or before the pack's last day, so a pack for October reads
 * September's report while October's is not issued, and one pack shows cost
 * and time for the same month. A report for a later period is never read into
 * an earlier pack, and a draft is never read.
 */
export function ownerPackCostReport(project: Pick<DdProject, 'costReports'>, period: StatusPeriod): CostReportPeriod | undefined {
  const last = new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10);
  return costReportsOf(project)
    .filter((report) => report.status === 'issued' && report.to <= last)
    .sort(costReportPeriodOrder)
    .at(-1);
}

/** Whether a Cost Report is of a pack's own period: its period takes in a day of it. */
function costReportOfPeriod(report: CostReportPeriod, period: StatusPeriod): boolean {
  const [first, last] = [period.from.slice(0, 10), new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10)];
  return report.from <= last && report.to >= first;
}

const LEVEL_ORDER: Record<ScheduleLevel, number> = { late: 0, behind: 1, slipping: 2 };

/** The first few lines for the page, and the rest behind “more”. */
function shown(lines: OwnerPackLine[], most = OWNER_PACK_LINES_SHOWN): Pick<OwnerPackPart, 'lines' | 'more'> {
  return lines.length > most ? { lines: lines.slice(0, most), more: lines.slice(most) } : { lines };
}

/** Several things in one phrase: "a, b and c". */
const listed = (items: string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''));

/** The pack for a period, read from the record as it stands at `now`. */
export function ownerPack(project: DdProject, period: StatusPeriod, now = new Date()): OwnerPack {
  const today = now.toISOString().slice(0, 10);
  const [firstDay, lastDay] = [period.from.slice(0, 10), new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10)];
  const periodSaid = statusPeriodSaid(period);
  const money = (amount: number): string => moneySaid(amount, project.currency);
  const signed = (amount: number): string => `${amount > 0 ? '+' : ''}${money(amount)}`;
  // Who issued something, by the name the team gives them, else the name part of their address. With sign-in off there is
  // nobody to name, and a paper for the owner names nobody: never the machine's own address.
  const named = (actor: string | undefined): string | undefined => (actor && !/@localhost$/i.test(actor.trim()) ? personSaid(project, actor) : undefined);

  /* ---- 1. Where the project stands ---- */
  // A period that has ended is read as the record stood when its last day ended in India; one still running, as it stands.
  const asAt = isPastDay(lastDay, now) ? lastDay : undefined;
  const read = asAt ? projectAsAt(project, asAt) : project;
  const at = asAt ? asAtMoment(asAt) : now;
  const progress = progressSummary(read, at);
  const watch = scheduleWatch(read, at);
  const milestones = read.milestones ?? [];
  /** The last day progress was reported of each milestone: a re-plan moves its dates and is no report. */
  const reportedOn = new Map(milestones.map((m) => [m.id, progressReadings(read, m).at(-1)?.on]));
  const lastReported = [...reportedOn.values()].filter((on): on is string => Boolean(on)).sort().at(-1);
  const schedule = `the schedule: ${counted(milestones.length, 'milestone', 'milestones')} on the progress board${lastReported ? `, last reported ${meetingDay(lastReported)}` : ''}`;
  const standing: OwnerPackLine[] = [{ what: `Stage: ${stageAndStep(project.currentStage)}.`, source: 'the project record' }];
  /** Read as at a past day: the milestones nothing was reported of on or before it, which are not dated as done by then. */
  const unread = milestones.filter((m) => m.unread);
  const noReading = asAt && unread.length > 0 && unread.length === milestones.filter((m) => m.percent < 100).length;
  if (progress.percent === null) {
    standing.push({ what: 'No milestones are on the schedule, so there is no percent complete and no completion date.', source: 'the progress board' });
  } else if (noReading) {
    // Nothing was reported of any unfinished milestone by the period's end: no percent is made up for it, and no late count.
    standing.push({
      what: `No reading for ${periodSaid}: no progress is dated on or before ${meetingDay(asAt!)} for ${counted(unread.length, 'milestone', 'milestones')}. ${progress.complete} of ${counted(progress.milestones, 'milestone', 'milestones')} ${progress.complete === 1 ? 'is' : 'are'} dated as finished by then.`,
      source: schedule,
    });
    if (watch.plannedCompletion) standing.push({ what: `Planned completion: ${meetingDay(watch.plannedCompletion)}.`, when: watch.plannedCompletion, source: schedule });
  } else {
    standing.push({
      what: `${progress.percent}% complete: ${progress.complete} of ${counted(progress.milestones, 'milestone', 'milestones')} finished, each weighted by its share of the work.${unread.length ? ` ${counted(unread.length, 'milestone has', 'milestones have')} no reading for ${periodSaid} and ${unread.length === 1 ? 'is' : 'are'} counted as not begun.` : ''}`,
      source: schedule,
    });
    standing.push(
      watch.plannedCompletion
        ? { what: `Planned completion: ${meetingDay(watch.plannedCompletion)}.`, when: watch.plannedCompletion, source: schedule }
        : { what: 'No milestone has a planned finish, so there is no planned completion.', source: schedule },
    );
    if (watch.plannedCompletion) {
      standing.push(
        watch.projectedCompletion
          ? {
              what: `Projected completion at the current rate: ${meetingDay(watch.projectedCompletion)}, ${watch.projectedDaysLate ? `about ${counted(watch.projectedDaysLate, 'day', 'days')} after the planned date` : 'no later than the planned date'}.`,
              when: watch.projectedCompletion,
              source: schedule,
            }
          : { what: 'No completion is projected: no unfinished milestone has progress reported on two days to take a rate from.', source: schedule },
      );
      standing.push({
        what: watch.extensionLikely
          ? `An extension of time is likely: ${watch.projectedDaysLate ? `at the current rate the work finishes about ${counted(watch.projectedDaysLate, 'day', 'days')} late` : 'the planned completion date has passed with work unfinished'}.`
          : 'No extension of time is indicated.',
        source: schedule,
      });
    }
  }

  /* ---- 2. Time ---- */
  const milestoneSource = (m: MilestoneWatch): string => (reportedOn.get(m.id) ? `the milestone, last reported ${meetingDay(reportedOn.get(m.id)!)}` : 'the milestone, with no progress reported yet');
  const warned = watch.milestones
    .filter((m): m is MilestoneWatch & { level: ScheduleLevel } => Boolean(m.level))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.daysToFinish ?? 0) - (b.daysToFinish ?? 0));
  const soon = watch.milestones
    .filter((m) => m.percent < 100 && !m.unread && m.daysToFinish !== undefined && m.daysToFinish >= 0 && m.daysToFinish <= OWNER_PACK_DUE_DAYS)
    .sort((a, b) => a.daysToFinish! - b.daysToFinish!);
  const time: OwnerPackPart[] = [
    {
      heading: 'Late, behind or slipping',
      ...shown(warned.map((m) => ({ what: `${m.name}: ${m.say}`, when: m.plannedFinish, overdue: m.level === 'late', source: milestoneSource(m), recordId: m.id }))),
      empty: !milestones.length ? 'No milestones are on the schedule.' : unread.length ? 'No milestone with a reading is late, behind or slipping.' : 'No milestone is late, behind or slipping.',
      ...(unread.length ? { note: `No reading for ${periodSaid}: ${listed(unread.map((m) => m.name))}. Nothing is said of ${unread.length === 1 ? 'it' : 'them'} here.` } : {}),
    },
    {
      heading: `Due in the next ${OWNER_PACK_DUE_DAYS} days`,
      ...shown(soon.map((m) => ({ what: `${m.name}: planned to finish ${meetingDay(m.plannedFinish!)}, now at ${m.percent}%.`, when: m.plannedFinish, source: milestoneSource(m), recordId: m.id }))),
      empty: `No milestone is planned to finish in the next ${OWNER_PACK_DUE_DAYS} days.`,
    },
  ];

  /* ---- 3. Cost ---- */
  const report = ownerPackCostReport(project, period);
  const cost: OwnerPackPart[] = [];
  const reportSaid = (held: CostReportPeriod): string => `Cost Report ${held.label}, issued ${meetingDay(held.issuedAt ?? held.updatedAt)}${named(held.issuedBy) ? ` by ${named(held.issuedBy)}` : ''}`;
  const against = (anticipated: number, budget: number): string => {
    const over = Math.round((anticipated - budget) * 100) / 100;
    return `forecast ${money(anticipated)} against a budget of ${money(budget)}, ${over > 0 ? `${money(over)} over` : over < 0 ? `${money(-over)} under` : 'on budget'}`;
  };
  if (!report) {
    const draft = costReportsOf(project).find((held) => held.status === 'draft' && held.from <= lastDay && held.to >= firstDay);
    const last = costReportsOf(project).filter((held) => held.status === 'issued').sort(costReportPeriodOrder).at(-1);
    cost.push({
      lines: [],
      empty: [`No Cost Report has been issued for ${periodSaid}.`, draft ? `The one for ${draft.label} is a draft, and a draft's figures are not given.` : '', last ? `The last one issued is ${last.label}.` : ''].filter(Boolean).join(' '),
    });
  } else {
    const source = reportSaid(report);
    const previous = costReportIssuedBefore(project, report);
    const bills = costRegister(project).bills;
    const comparison = previous ? compareCostReports(previous, report, bills) : undefined;
    const totals = costReportTotals(report);
    const forecast: OwnerPackLine[] = [];
    // Which report this is, where it is not of the pack's own period: said first, so nobody reads August's figures as October's.
    if (!costReportOfPeriod(report, period)) {
      const draft = costReportsOf(project).find((held) => held.status === 'draft' && held.from <= lastDay && held.to >= firstDay);
      forecast.push({ what: `No Cost Report is issued for ${periodSaid}${draft ? ' (the one for it is a draft, and a draft’s figures are not given)' : ''}. What follows is the latest issued before it: ${report.label}, for the period to ${meetingDay(report.to)}.`, source });
    }
    forecast.push({ what: `${costReportOfPeriod(report, period) ? 'Now' : `As at ${report.label}`}: ${against(totals.anticipatedCost, totals.budget)}.`, source });
    if (previous && comparison) {
      const then = costReportTotals(previous);
      const moved = comparison.totals.figures.anticipatedCost.change;
      forecast.push({ what: `At the last report: ${against(then.anticipatedCost, then.budget)}. The forecast has ${moved ? `moved ${signed(moved)} since` : 'not moved since'}.`, source: reportSaid(previous) });
    } else {
      forecast.push({ what: `No Cost Report was issued before ${report.label}, so there is no earlier forecast to set beside it.`, source });
    }
    // The line an owner reads a cost report for: the total with GST, and what is certified, where the report holds them.
    const bottom = costReportBottomLine(project, report);
    const withGst = bottom.gst && bottom.afterGst ? `With GST at ${bottom.gst.ratePct}%${bottom.gst.rule.verified ? '' : ' (rate not checked)'}: forecast ${money(bottom.afterGst.anticipatedCost)} against a budget of ${money(bottom.afterGst.budget)}` : '';
    const certified = bottom.beforeGst.certified !== undefined ? `Certified to date: ${money(bottom.beforeGst.certified)}` : '';
    if (withGst || certified) forecast.push({ what: `${[withGst, certified].filter(Boolean).join('. ')}.`, source });
    cost.push({ heading: 'Forecast against budget', lines: forecast, empty: '' });

    const causeSaid = (cause: CostReportChangeCause): string =>
      cause.kind === 'variation' ? `Variation ${titled(cause.description)}${cause.contingencyDrawn ? ', drawn from contingency' : ''}: ${signed(cause.amount)}` : `Awarded at ${money(cause.poIssued)}, which accounts for ${signed(cause.amount)}`;
    const movementSaid = (change: CostReportPackageChange): string => {
      const { previous: was, current: is, change: by } = change.figures.anticipatedCost;
      const head =
        change.status === 'added' ? `new on the report at ${money(is ?? 0)}` : change.status === 'removed' ? `no longer on the report, was ${money(was ?? 0)}` : `${signed(by)}, from ${money(was ?? 0)} to ${money(is ?? 0)}`;
      return [
        `${packageLabel(change)}: ${head}`,
        ...change.causes.map(causeSaid),
        change.unexplained !== 0 ? `Unexplained: ${signed(change.unexplained)}` : '',
        // A movement a variation or an award accounts for needs no reason; one with a part unexplained says that none was given.
        change.reason ? `Reason given: ${change.reason.replace(/[.\s]+$/, '')}` : change.unexplained !== 0 ? 'No reason given' : '',
      ]
        .filter(Boolean)
        .join('. ')
        .concat('.');
    };
    cost.push({
      heading: 'Largest package movements',
      lines: comparison ? largestCostMovements(comparison, OWNER_PACK_MOVEMENTS).map((change) => ({ what: movementSaid(change), source })) : [],
      empty: previous ? `No package's forecast has moved since ${previous.label}.` : 'Nothing to compare with: this is the first Cost Report issued.',
    });

    const unexplained = comparison?.packages.filter((change) => change.unexplained !== 0) ?? [];
    cost.push({
      heading: 'Unexplained',
      lines: unexplained.length
        ? [
            {
              what: `${counted(unexplained.length, 'package has', 'packages have')} a change no variation or award accounts for, ${signed(comparison!.totals.unexplained)} in all: ${unexplained.map((change) => `${packageLabel(change)} ${signed(change.unexplained)}`).join(', ')}.`,
              source,
            },
          ]
        : [],
      empty: previous ? 'Nothing is unexplained: variations and awards account for every change.' : 'Nothing to compare with: this is the first Cost Report issued.',
    });

    const billed = costReportBilled(bills, previous?.to ?? '', report.to);
    const span = `${previous ? `after ${meetingDay(previous.to)} and ` : ''}up to ${meetingDay(report.to)}`;
    cost.push({
      heading: 'Claimed against certified',
      lines: billed
        ? [
            {
              what: `Running bills dated ${span}: ${money(billed.claimed)} claimed on ${counted(billed.bills, 'bill', 'bills')}, ${money(billed.certified)} certified, ${money(billed.difference)} not certified${billed.awaitingCertificate ? `; ${counted(billed.awaitingCertificate, 'bill awaits', 'bills await')} a certificate` : ''}.`,
              source: 'the register of running bills and their certificates',
            },
          ]
        : [],
      empty: `No running bill is dated ${span}.`,
    });
  }

  /* ---- 4. Decisions needed from the owner ---- */
  // By kind, the most money first, a few of each on the page. A contingency, a fee or an allowance awaits no award.
  const overBudget: OwnerPackLine[] = [];
  const toAward: OwnerPackLine[] = [];
  let toAwardNote: string | undefined;
  if (report) {
    const asks = costReportDecisions(report);
    const source = reportSaid(report);
    for (const pack of [...asks.overBudget].sort((x, y) => y.over - x.over)) overBudget.push({ what: `Over budget: ${packageLabel(pack)}, ${against(pack.anticipatedCost, pack.budget)}.`, source });
    const unawarded = asks.unawarded.filter((pack) => !packageAwaitsNoAward(pack.name) && pack.budget > 0).sort((x, y) => y.budget - x.budget);
    for (const pack of unawarded) toAward.push({ what: `Not awarded: ${packageLabel(pack)}, budget ${money(pack.budget)}, no PO issued.`, source });
    // Awarded to a party the report names, with no PO figure typed: awarded, and said so. It is a figure to enter, not a decision.
    for (const pack of asks.awardedNoPo) toAward.push({ what: `Awarded, PO value not entered: ${packageLabel(pack)}, to ${pack.awardedTo}, budget ${money(pack.budget)}.`, source });
    if (unawarded.length > OWNER_PACK_LINES_SHOWN) toAwardNote = `${counted(unawarded.length, 'package', 'packages')} not awarded, ${money(unawarded.reduce((total, pack) => total + pack.budget, 0))} of budget in all.`;
  }
  const extension: OwnerPackLine[] = [];
  if (watch.extensionLikely && watch.plannedCompletion) {
    const planned = meetingDay(watch.plannedCompletion);
    extension.push({
      what: `Extension of time: ${watch.projectedDaysLate ? `at the current rate the work finishes about ${counted(watch.projectedDaysLate, 'day', 'days')} after the planned completion of ${planned}` : `the planned completion of ${planned} has passed with work unfinished`}.`,
      source: schedule,
    });
  }
  const undecided: OwnerPackLine[] = [];
  for (const decision of project.decisions) {
    if (decision.status !== 'pending') continue;
    undecided.push({
      what: `To be decided: ${titled(decision.title)}.`,
      when: decision.createdAt.slice(0, 10),
      ...(decision.decisionMaker ? { who: decision.decisionMaker } : {}),
      source: recordBehind(project, decision, 'the decision register').behind,
      recordId: decision.id,
    });
  }
  const needed: OwnerPackPart[] = [
    { heading: 'Over budget', ...shown(overBudget), empty: '' },
    { heading: 'Packages to award', ...shown(toAward), empty: '', ...(toAwardNote ? { note: toAwardNote } : {}) },
    { heading: 'Time', lines: extension, empty: '' },
    { heading: 'Open decisions', ...shown(undecided), empty: '' },
  ].filter((part) => part.lines.length);
  const decisions: OwnerPackPart[] = needed.length ? needed : [{ lines: [], empty: 'Nothing on the record needs a decision from the owner.' }];

  /* ---- 5. What was decided in the period, and who owes what ---- */
  const held = meetingsHeld(project)
    .map((meeting) => ({ meeting, on: meeting.heldOn ?? meeting.keptAt.slice(0, 10) }))
    .filter(({ on }) => on >= firstDay && on <= lastDay)
    .sort((a, b) => a.on.localeCompare(b.on));
  const decided: OwnerPackLine[] = [];
  const owed: OwnerPackLine[] = [];
  let waiting = 0;
  for (const { meeting, on } of held) {
    const source = `${meetingCalled(meeting)}, its notes on file`;
    for (const item of meeting.items) {
      const stands = meetingItemStands(project, item);
      if (stands.standing === 'waiting') waiting += 1;
      if (stands.standing !== 'recorded' || !stands.recordId) continue;
      const decision = project.decisions.find((record) => record.id === stands.recordId);
      if (decision && decision.status !== 'pending') {
        decided.push({ what: `${titled(decision.title)} (${DECISION_STATUS_LABEL[decision.status].toLowerCase()}).`, when: on, source, recordId: decision.id });
        continue;
      }
      const action = project.actions.find((record) => record.id === stands.recordId);
      if (!action || action.status === 'closed') continue;
      const due = action.dueDate?.slice(0, 10);
      const overdue = Boolean(due && due < today);
      owed.push({
        what: `${overdue ? `Overdue since ${meetingDay(due!)}` : due ? `Due ${meetingDay(due)}` : 'No date given'}: ${titled(action.title)}.`,
        ...(due ? { when: due } : {}),
        who: action.owner || 'nobody named',
        ...(overdue ? { overdue: true } : {}),
        source,
        recordId: action.id,
      });
    }
  }
  // Overdue first, the longest overdue at the top; then by the date ahead; then what has no date.
  const rank = (line: OwnerPackLine): number => (line.overdue ? 0 : line.when ? 1 : 2);
  owed.sort((a, b) => rank(a) - rank(b) || (a.when ?? '').localeCompare(b.when ?? ''));
  const noMeeting = `No meeting's notes are kept for ${periodSaid}.`;
  const onCards = waiting ? `${counted(waiting, 'thing', 'things')} read from the notes ${waiting === 1 ? 'waits on a card' : 'wait on cards'}, not yet accepted, and ${waiting === 1 ? 'is' : 'are'} not shown.` : undefined;
  const meetings: OwnerPackPart[] = [
    { heading: 'Decided', ...shown(decided), empty: held.length ? 'No decision from the meetings of the period is on the record.' : noMeeting, ...(onCards ? { note: onCards } : {}) },
    { heading: 'Who owes what', ...shown(owed), empty: held.length ? 'No action from the meetings of the period is open.' : noMeeting },
  ];

  /* ---- 6. Papers owed ---- */
  const parties = new Map<string, { owedBy?: string; lines: OwnerPackLine[] }>();
  // A paper is owed once somebody has been asked for it, as Overview counts it: a line nobody was asked for is on the list and not yet owed.
  const unasked = new WeakSet<OwnerPackLine>();
  const owe = (owedBy: string | undefined, line: OwnerPackLine, wasAsked: boolean): void => {
    const key = (owedBy ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const party = parties.get(key) ?? { ...(owedBy ? { owedBy } : {}), lines: [] };
    parties.set(key, party);
    party.lines.push(line);
    if (!wasAsked) unasked.add(line);
  };
  const asked = (dueAt: string | undefined, overdue: boolean | undefined): string => `asked for${dueAt ? `, due ${meetingDay(dueAt)}${overdue ? ' (overdue)' : ''}` : ''}`;
  const checklist = checklistOwed(project, { now: now.toISOString() });
  for (const party of checklist.parties) {
    for (const line of party.lines) {
      const where = [line.item.stage, line.item.package].filter(Boolean).join(' · ');
      owe(party.owedBy, {
        what: `${line.item.title}${where ? ` (${where})` : ''}: ${line.status === 'requested' ? asked(line.dueAt, line.overdue) : 'not asked'}.`,
        ...(line.dueAt ? { when: line.dueAt.slice(0, 10) } : {}),
        ...(line.overdue ? { overdue: true } : {}),
        source: `Papers owed, ${DEPARTMENT_SHORT[line.item.department]}`,
        recordId: line.item.id,
      }, line.status === 'requested');
    }
  }
  const sheet = requirementSheet(project, { now: now.toISOString() });
  for (const item of sheet.groups.flatMap((group) => group.items)) {
    if (item.status === 'received') continue;
    owe(item.askedOf, {
      what: `${item.title}: ${item.status === 'requested' ? asked(item.dueAt, item.overdue) : 'not asked'}.`,
      ...(item.dueAt ? { when: item.dueAt.slice(0, 10) } : {}),
      ...(item.overdue ? { overdue: true } : {}),
      source: `Papers owed${item.checks[0] ? `, expected by the check ${titled(item.checks[0].title)}` : ''}`,
      ...(item.evidenceId ? { recordId: item.evidenceId } : {}),
    }, item.status === 'requested');
  }
  const groups = [...parties.values()].sort((a, b) => Number(!a.owedBy) - Number(!b.owedBy) || b.lines.length - a.lines.length);
  const nothingOwed = checklist.total + sheet.total ? 'Every paper owed is in hand.' : 'No list of papers is loaded, and the checks on the file expect no documents.';
  // On the page, a line for each party: how many it owes and how many are overdue. The papers themselves are behind “more”.
  const partyLine = (party: { owedBy?: string; lines: OwnerPackLine[] }): OwnerPackLine => {
    const overdue = party.lines.filter((line) => line.overdue).length;
    const oldest = party.lines.filter((line) => line.overdue && line.when).map((line) => line.when!).sort()[0];
    const waiting = party.lines.filter((line) => unasked.has(line)).length;
    const owed = party.lines.length - waiting;
    return {
      what: owed
        ? `${party.owedBy ?? 'Nobody named'}: ${counted(owed, 'paper', 'papers')} owed${overdue ? `, ${overdue} overdue${oldest ? `, the oldest since ${meetingDay(oldest)}` : ''}` : ''}${waiting ? `; ${waiting} more not yet asked for` : ''}.`
        : `${party.owedBy ?? 'Nobody named'}: ${counted(waiting, 'paper', 'papers')} on the list, not yet asked for.`,
      ...(overdue ? { overdue: true } : {}),
      source: 'Papers owed',
    };
  };
  const papers: OwnerPackPart[] = groups.length
    ? [
        { heading: 'By who owes them', ...shown(groups.map(partyLine), OWNER_PACK_PARTIES_SHOWN), empty: '' },
        ...groups.map((party): OwnerPackPart => {
          const first = [...party.lines].sort((a, b) => Number(!a.overdue) - Number(!b.overdue));
          const more = first.length - OWNER_PACK_PAPERS_SHOWN;
          return {
            heading: `${party.owedBy ?? 'Nobody named'} · ${first.length}`,
            lines: first.slice(0, OWNER_PACK_PAPERS_SHOWN),
            empty: '',
            detail: true,
            ...(more > 0 ? { note: `And ${more} more.` } : {}),
          };
        }),
      ]
    : [{ lines: [], empty: nothingOwed }];

  // What each section was read from, said once.
  const earlier = report ? costReportIssuedBefore(project, report) : undefined;
  const costSource = report ? listed([reportSaid(report), ...(earlier ? [reportSaid(earlier)] : []), 'the register of running bills']) : 'the Cost Reports issued';
  const decisionSource = listed([...(report && (overBudget.length || toAward.length) ? [reportSaid(report)] : []), ...(extension.length ? [schedule] : []), ...(undecided.length ? ['the decision register'] : [])]);
  const meetingSource = held.length ? `${listed(held.slice(0, 3).map(({ meeting }) => meetingCalled(meeting)))}${held.length > 3 ? ` and ${counted(held.length - 3, 'more meeting', 'more meetings')}` : ''}, their notes on file` : undefined;

  const timeFields = ownerPackFields(project, 'time', now, asAt);
  const costFields = ownerPackFields(project, 'cost', now, asAt);
  const timePhotos = ownerPackPhotos(project, period, now);
  return {
    period,
    periodSaid,
    asOf: today,
    ...(asAt ? { asAt } : {}),
    sections: [
      { key: 'standing', title: 'Where the project stands', parts: [{ lines: standing, empty: '' }], source: milestones.length ? `the project record and ${schedule}` : 'the project record' },
      { key: 'time', title: 'Time', parts: time, ...(milestones.length ? { source: schedule } : {}), ...(timeFields ? { fields: timeFields } : {}), ...(timePhotos ? { photos: timePhotos } : {}) },
      { key: 'cost', title: 'Cost', parts: cost, source: costSource, ...(costFields ? { fields: costFields } : {}) },
      { key: 'decisions', title: 'Decisions needed from the owner', parts: decisions, ...(decisionSource ? { source: decisionSource } : {}) },
      { key: 'meetings', title: 'Decided in the period, and who owes what', parts: meetings, ...(meetingSource ? { source: meetingSource } : {}) },
      { key: 'papers', title: 'Papers owed', parts: papers, ...(groups.length ? { source: 'the lists of papers owed, and what the checks on the file expect' } : {}) },
    ],
  };
}
