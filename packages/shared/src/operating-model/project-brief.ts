/**
 * The four things a person running a project asks first, each in a line:
 * what needs me, what is slipping, what is owed, what changed in cost.
 *
 * Overview opens with them. Every line is read off records other pages
 * already keep, and each part of a line opens the page that holds it, so
 * nothing here is a second place to work. It is read off the project as it
 * was handed over: somebody working from a grant gets the lines their copy
 * can answer, and never the firm's list of papers owed.
 */
import { PROJECT_COCKPIT_PANES, waitingOnCanvas } from './cockpit';
import { moneySaid } from './cost';
import { costReportDecisions } from './cost-report-compare';
import { costReportIssuedBefore, costReportTotals, costReportsOf } from './cost-report';
import { scheduleWatch } from './milestone-schedule';
import { PAPERS_OWED, papersOwed, papersOwedBy } from './papers-owed';
import type { CockpitPathExtra } from './sitting';
import type { DdProject } from './types';

type Pane = (typeof PROJECT_COCKPIT_PANES)[number];

export interface BriefPart {
  text: string;
  tone?: 'critical' | 'warning';
  open: { pane: Pane; extra?: CockpitPathExtra };
}

export interface BriefLine {
  key: 'needs' | 'slipping' | 'owed' | 'cost';
  label: string;
  /** What it says, part by part. Empty: `quiet` is said instead. */
  parts: BriefPart[];
  /** What the line says when there is nothing to act on, and where that still opens. */
  quiet: string;
  open: { pane: Pane; extra?: CockpitPathExtra };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function dayOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const PROGRESS = { pane: 'workstream', extra: { workstream: 'construction.progress', section: 'progress' } } as const;
const BUDGET = { pane: 'workstream', extra: { workstream: 'finance.budget' } } as const;

/**
 * The brief for a project on a day. `outside` is somebody working from a
 * grant: they are not shown the firm's papers owed or its replies.
 */
export function projectBrief(project: DdProject, now: Date, opts: { outside?: boolean } = {}): BriefLine[] {
  const today = now.toISOString().slice(0, 10);
  const lines: BriefLine[] = [];
  const owed = opts.outside ? undefined : papersOwed(project, { now: now.toISOString() });

  // What needs a person: what waits to be accepted, replies to confirm, decisions to make, actions past their date.
  const waiting = waitingOnCanvas(project);
  const first = waiting.entries[0];
  const decisions = (project.decisions ?? []).filter((decision) => decision.status === 'pending' || decision.status === 'proposed').length;
  const late = (project.actions ?? []).filter((action) => action.status !== 'closed' && (action.status === 'overdue' || Boolean(action.dueDate && action.dueDate.slice(0, 10) < today))).length;
  lines.push({
    key: 'needs',
    label: 'Needs you',
    parts: [
      ...(waiting.total && first ? [{ text: `${waiting.total} to accept`, open: { pane: first.pane, ...(first.extra ? { extra: first.extra } : {}) } }] : []),
      ...(owed?.answered ? [{ text: plural(owed.answered, 'reply to confirm', 'replies to confirm'), open: { pane: 'papers' as const } }] : []),
      ...(decisions ? [{ text: plural(decisions, 'decision to make', 'decisions to make'), open: { pane: 'decisions' as const } }] : []),
      ...(late ? [{ text: plural(late, 'action overdue', 'actions overdue'), tone: 'critical' as const, open: { pane: 'actions' as const } }] : []),
    ],
    quiet: 'Nothing waits for you.',
    open: { pane: 'actions' },
  });

  // What is slipping: milestones late, behind or finishing late at the current rate, and where completion lands.
  const watch = scheduleWatch(project, now);
  const count = (level: 'late' | 'behind' | 'slipping') => watch.milestones.filter((m) => m.level === level).length;
  const [lateM, behind, slipping] = [count('late'), count('behind'), count('slipping')];
  lines.push({
    key: 'slipping',
    label: 'Slipping',
    parts: [
      ...(lateM ? [{ text: `${lateM} late`, tone: 'critical' as const, open: PROGRESS }] : []),
      ...(behind ? [{ text: `${behind} behind`, tone: 'warning' as const, open: PROGRESS }] : []),
      ...(slipping ? [{ text: `${slipping} late at the current rate`, tone: 'warning' as const, open: PROGRESS }] : []),
      ...(watch.projectedDaysLate && watch.projectedCompletion
        ? [{ text: `completion ${dayOf(watch.projectedCompletion)}, ${plural(watch.projectedDaysLate, 'day')} after planned`, tone: 'warning' as const, open: PROGRESS }]
        : watch.extensionLikely
          ? [{ text: 'planned completion has passed', tone: 'critical' as const, open: PROGRESS }]
          : []),
    ],
    quiet: !watch.milestones.length ? 'No schedule yet. Bring it in on Progress.' : watch.plannedCompletion ? `On schedule. Planned completion ${dayOf(watch.plannedCompletion)}.` : 'Nothing is behind.',
    open: PROGRESS,
  });

  // What is owed: the papers the project waits for, and who owes the most.
  if (owed) {
    const by = papersOwedBy(owed);
    lines.push({
      key: 'owed',
      label: PAPERS_OWED,
      parts: owed.owed
        ? [
            { text: `${owed.owed} owed`, open: { pane: 'papers' } },
            ...(owed.overdue ? [{ text: `${owed.overdue} overdue`, tone: 'critical' as const, open: { pane: 'papers' as const } }] : []),
            ...(owed.notAsked ? [{ text: `${owed.notAsked} not asked`, open: { pane: 'papers' as const } }] : []),
            ...(by ? [{ text: by, open: { pane: 'papers' as const } }] : []),
          ]
        : [],
      quiet: owed.total ? `All ${owed.total} in hand.` : 'Nothing asked for yet. Load the list of papers.',
      open: { pane: 'papers' },
    });
  }

  // What changed in cost: the last Cost Report issued, against its budget and against the one before it.
  const issued = costReportsOf(project).filter((report) => report.status === 'issued');
  const last = issued.at(-1);
  if (last) {
    const totals = costReportTotals(last);
    const before = costReportIssuedBefore(project, last);
    const moved = before ? totals.anticipatedCost - costReportTotals(before).anticipatedCost : 0;
    const over = costReportDecisions(last).overBudget.length;
    const money = (amount: number) => moneySaid(amount, project.currency);
    lines.push({
      key: 'cost',
      label: 'Cost',
      parts: [
        { text: `forecast ${money(totals.anticipatedCost)} against a budget of ${money(totals.budget)}`, ...(totals.anticipatedVariance > 0 ? { tone: 'warning' as const } : {}), open: BUDGET },
        ...(before ? [{ text: moved ? `${moved > 0 ? 'up' : 'down'} ${money(Math.abs(moved))} since ${before.label}` : `unchanged since ${before.label}`, ...(moved > 0 ? { tone: 'warning' as const } : {}), open: BUDGET }] : []),
        ...(over ? [{ text: plural(over, 'package over budget', 'packages over budget'), tone: 'critical' as const, open: BUDGET }] : []),
      ],
      quiet: '',
      open: BUDGET,
    });
  } else if (costReportsOf(project).length || project.cost?.workPackages.length) {
    lines.push({ key: 'cost', label: 'Cost', parts: [], quiet: 'No Cost Report issued yet. Issue one on Budget.', open: BUDGET });
  }
  return lines;
}
