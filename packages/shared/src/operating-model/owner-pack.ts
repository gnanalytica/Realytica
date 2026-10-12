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
 * running bills, which meetings. Where the project stands, the schedule and
 * the papers owed are told as the record stands on the day the pack is made,
 * because the record keeps how far along a milestone is now and not how far
 * along it was (the status report's rule for what waits).
 */

import { DECISION_STATUS_LABEL } from './catalogs';
import { checklistOwed } from './checklist';
import { costRegister, moneySaid } from './cost';
import { costReportIssuedBefore, costReportPeriodOrder, costReportsOf, costReportTotals, type CostReportPeriod } from './cost-report';
import { compareCostReports, costReportBilled, costReportDecisions, largestCostMovements, type CostReportChangeCause, type CostReportPackageChange } from './cost-report-compare';
import { DEPARTMENT_SHORT, stageAndStep } from './departments';
import { meetingCalled, meetingDay, meetingItemStands, meetingsHeld } from './meetings';
import { progressReadings, scheduleWatch, type MilestoneWatch, type ScheduleLevel } from './milestone-schedule';
import { progressSummary } from './progress';
import { quarterOfKey } from './quarters';
import { requirementSheet } from './requirement-sheet';
import { recordBehind, statusPeriodSaid, type StatusPeriod } from './status-report';
import { sameEmail } from './tenancy';
import type { DdProject } from './types';

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
}

export interface OwnerPackSection {
  key: OwnerPackSectionKey;
  title: string;
  parts: OwnerPackPart[];
}

export interface OwnerPack {
  period: StatusPeriod;
  /** The period in words: "September 2026". */
  periodSaid: string;
  /** The day the record was read on. */
  asOf: string;
  /** The six sections, in their order. */
  sections: OwnerPackSection[];
}

/** A milestone planned to finish within this many days is due soon. */
export const OWNER_PACK_DUE_DAYS = 30;
/** How many package movements the cost section gives. */
export const OWNER_PACK_MOVEMENTS = 3;
/** How many papers are listed under one party; the rest are counted. */
export const OWNER_PACK_PAPERS_SHOWN = 8;

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

/** The Cost Report a pack reads for a period: the last one issued whose own period takes in a day of it. A draft is never read. */
export function ownerPackCostReport(project: Pick<DdProject, 'costReports'>, period: StatusPeriod): CostReportPeriod | undefined {
  const [first, last] = [period.from.slice(0, 10), new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10)];
  return costReportsOf(project)
    .filter((report) => report.status === 'issued' && report.from <= last && report.to >= first)
    .sort(costReportPeriodOrder)
    .at(-1);
}

const LEVEL_ORDER: Record<ScheduleLevel, number> = { late: 0, behind: 1, slipping: 2 };

/** The pack for a period, read from the record as it stands at `now`. */
export function ownerPack(project: DdProject, period: StatusPeriod, now = new Date()): OwnerPack {
  const today = now.toISOString().slice(0, 10);
  const [firstDay, lastDay] = [period.from.slice(0, 10), new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10)];
  const periodSaid = statusPeriodSaid(period);
  const money = (amount: number): string => moneySaid(amount, project.currency);
  const signed = (amount: number): string => `${amount > 0 ? '+' : ''}${money(amount)}`;
  const named = (actor: string | undefined): string | undefined => (actor ? ((project.team ?? []).find((member) => member.name && sameEmail(member.email, actor))?.name ?? actor) : undefined);

  /* ---- 1. Where the project stands ---- */
  const progress = progressSummary(project, now);
  const watch = scheduleWatch(project, now);
  const milestones = project.milestones ?? [];
  /** The last day progress was reported of each milestone: a re-plan moves its dates and is no report. */
  const reportedOn = new Map(milestones.map((m) => [m.id, progressReadings(project, m).at(-1)?.on]));
  const lastReported = [...reportedOn.values()].filter((on): on is string => Boolean(on)).sort().at(-1);
  const schedule = `the schedule: ${counted(milestones.length, 'milestone', 'milestones')} on the progress board${lastReported ? `, last reported ${meetingDay(lastReported)}` : ''}`;
  const standing: OwnerPackLine[] = [{ what: `Stage: ${stageAndStep(project.currentStage)}.`, source: 'the project record' }];
  if (progress.percent === null) {
    standing.push({ what: 'No milestones are on the schedule, so there is no percent complete and no completion date.', source: 'the progress board' });
  } else {
    standing.push({ what: `${progress.percent}% complete: ${progress.complete} of ${counted(progress.milestones, 'milestone', 'milestones')} finished, each weighted by its share of the work.`, source: schedule });
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
    .filter((m) => m.percent < 100 && m.daysToFinish !== undefined && m.daysToFinish >= 0 && m.daysToFinish <= OWNER_PACK_DUE_DAYS)
    .sort((a, b) => a.daysToFinish! - b.daysToFinish!);
  const time: OwnerPackPart[] = [
    {
      heading: 'Late, behind or slipping',
      lines: warned.map((m) => ({ what: `${m.name}: ${m.say}`, when: m.plannedFinish, overdue: m.level === 'late', source: milestoneSource(m), recordId: m.id })),
      empty: milestones.length ? 'No milestone is late, behind or slipping.' : 'No milestones are on the schedule.',
    },
    {
      heading: `Due in the next ${OWNER_PACK_DUE_DAYS} days`,
      lines: soon.map((m) => ({ what: `${m.name}: planned to finish ${meetingDay(m.plannedFinish!)}, now at ${m.percent}%.`, when: m.plannedFinish, source: milestoneSource(m), recordId: m.id })),
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
    const forecast: OwnerPackLine[] = [{ what: `Now: ${against(totals.anticipatedCost, totals.budget)}.`, source }];
    if (previous && comparison) {
      const then = costReportTotals(previous);
      const moved = comparison.totals.figures.anticipatedCost.change;
      forecast.push({ what: `At the last report: ${against(then.anticipatedCost, then.budget)}. The forecast has ${moved ? `moved ${signed(moved)} since` : 'not moved since'}.`, source: reportSaid(previous) });
    } else {
      forecast.push({ what: `No Cost Report was issued before ${report.label}, so there is no earlier forecast to set beside it.`, source });
    }
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
        change.reason ? `Reason given: ${change.reason.replace(/[.\s]+$/, '')}` : 'No reason given',
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
  const decisions: OwnerPackLine[] = [];
  if (report) {
    const asks = costReportDecisions(report);
    const source = reportSaid(report);
    for (const pack of asks.overBudget) decisions.push({ what: `Over budget: ${packageLabel(pack)}, ${against(pack.anticipatedCost, pack.budget)}.`, source });
    for (const pack of asks.unawarded) decisions.push({ what: `Not awarded: ${packageLabel(pack)}, budget ${money(pack.budget)}, no PO issued.`, source });
  }
  if (watch.extensionLikely && watch.plannedCompletion) {
    const planned = meetingDay(watch.plannedCompletion);
    decisions.push({
      what: `Extension of time: ${watch.projectedDaysLate ? `at the current rate the work finishes about ${counted(watch.projectedDaysLate, 'day', 'days')} after the planned completion of ${planned}` : `the planned completion of ${planned} has passed with work unfinished`}.`,
      source: schedule,
    });
  }
  for (const decision of project.decisions) {
    if (decision.status !== 'pending') continue;
    decisions.push({
      what: `To be decided: ${titled(decision.title)}.`,
      when: decision.createdAt.slice(0, 10),
      ...(decision.decisionMaker ? { who: decision.decisionMaker } : {}),
      source: recordBehind(project, decision, 'the decision register').behind,
      recordId: decision.id,
    });
  }

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
    { heading: 'Decided', lines: decided, empty: held.length ? 'No decision from the meetings of the period is on the record.' : noMeeting, ...(onCards ? { note: onCards } : {}) },
    { heading: 'Who owes what', lines: owed, empty: held.length ? 'No action from the meetings of the period is open.' : noMeeting },
  ];

  /* ---- 6. Papers owed ---- */
  const parties = new Map<string, { owedBy?: string; lines: OwnerPackLine[] }>();
  const owe = (owedBy: string | undefined, line: OwnerPackLine): void => {
    const key = (owedBy ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const party = parties.get(key) ?? { ...(owedBy ? { owedBy } : {}), lines: [] };
    parties.set(key, party);
    party.lines.push(line);
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
      });
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
    });
  }
  const groups = [...parties.values()].sort((a, b) => Number(!a.owedBy) - Number(!b.owedBy) || b.lines.length - a.lines.length);
  const nothingOwed = checklist.total + sheet.total ? 'Every paper owed is in hand.' : 'No list of papers is loaded, and the checks on the file expect no documents.';
  const papers: OwnerPackPart[] = groups.length
    ? groups.map((party) => {
        const first = [...party.lines].sort((a, b) => Number(!a.overdue) - Number(!b.overdue));
        const more = first.length - OWNER_PACK_PAPERS_SHOWN;
        return {
          heading: `${party.owedBy ?? 'Nobody named'} · ${first.length}`,
          lines: first.slice(0, OWNER_PACK_PAPERS_SHOWN),
          empty: '',
          ...(more > 0 ? { note: `And ${more} more.` } : {}),
        };
      })
    : [{ lines: [], empty: nothingOwed }];

  return {
    period,
    periodSaid,
    asOf: today,
    sections: [
      { key: 'standing', title: 'Where the project stands', parts: [{ lines: standing, empty: '' }] },
      { key: 'time', title: 'Time', parts: time },
      { key: 'cost', title: 'Cost', parts: cost },
      { key: 'decisions', title: 'Decisions needed from the owner', parts: [{ lines: decisions, empty: 'Nothing on the record needs a decision from the owner.' }] },
      { key: 'meetings', title: 'Decided in the period, and who owes what', parts: meetings },
      { key: 'papers', title: 'Papers owed', parts: papers },
    ],
  };
}
