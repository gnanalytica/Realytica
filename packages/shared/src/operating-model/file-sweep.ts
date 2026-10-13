/**
 * The daily review of the whole file.
 *
 * Rules fire when a record is saved, and the daily timer runs the fixed
 * alert rules. Neither reads one part of the file against another. Once a
 * day the review does, for six kinds of thing.
 *
 * Four are rules, worked out by code (`sweep-rules.ts`): two papers that
 * state the same field differently, a date that cannot be right given
 * another, an approval work depends on that is missing or lapsed, an action
 * nobody is named for. No model is asked for these.
 *
 * Two are left to a model's eye: cost that moved with no reason recorded,
 * and schedule and cost telling different stories. A model is handed a brief
 * of the record and answers with nominations only: a kind, and the marks of
 * the lines it read. Code then works out the difference from those lines'
 * own figures, takes severity and the next step from a table, and makes the
 * line a person reads from a template (`sweepSaid`). No sentence a model
 * writes is read, stored or shown.
 *
 * What comes of either is a suggestion and nothing more. It is kept beside
 * the project and not on it (`FileSweepState`), so it is in no report, no
 * notification, no chat answer and no collaborator's copy. A lead or signer
 * of its department accepts it, and it becomes a finding or a risk the way
 * any other does, or dismisses it with a reason, and the same matter is not
 * raised again.
 *
 * - the brief (`sweepBrief`): bounded, built from the record alone, every
 *   line under a mark that stands for one entry on the record;
 * - the holding (`sweepNominationsHeld`): a nomination is kept only where
 *   every mark it cites is a line of the brief it was given and code can
 *   work out what it claims, so each suggestion carries its sources, paper
 *   and page where a paper states them;
 * - the memory (`sweepRaise`): a matter already open, accepted or dismissed
 *   is told by what it is about, not by its wording, and is not raised twice.
 *
 * A suggestion stored before this (a statement, a why and an action a model
 * wrote) still reads, and is shown as written by a model before the change.
 *
 * Everything in this file is pure but the two decisions, which change the
 * project as a person's act does.
 */

import { APPROVAL_STATUS_LABEL, approvalsRegister } from './approvals';
import { ACTION_STATUS_LABEL, DECISION_STATUS_LABEL, SEVERITY_LABEL } from './catalogs';
import { checklistOwed } from './checklist';
import { moneySaid } from './cost';
import { costReportTotals, costReportsOf } from './cost-report';
import { costReportChanges } from './cost-report-compare';
import { SUB_STAGE_LABEL, stageAndStep, type DepartmentKey } from './departments';
import { openAlerts } from './alerts';
import { memHash } from './mem-delta';
import { memoryFacts, type MemFact } from './mem-facts';
import { scheduleWatch } from './milestone-schedule';
import { addFinding, addRisk, recordAuditEvent } from './operations';
import { waitingOn } from './project-requests';
import { decisionRefused } from './review';
import { projectDepartments, type MayDecide } from './team';
import type { DdProject, FieldAddress, FindingRecord, FindingSeverity, ImpactScore, RiskImpactType, RiskRecord, ScopeKey } from './types';

/* ==================================================================== */
/* What is asked for                                                     */
/* ==================================================================== */

export const SWEEP_KINDS = ['papers_disagree', 'date_impossible', 'approval_missing', 'cost_unexplained', 'schedule_cost_differ', 'action_unowned'] as const;

export type SweepKind = (typeof SWEEP_KINDS)[number];

export const SWEEP_KIND_LABEL: Record<SweepKind, string> = {
  papers_disagree: 'Two papers disagree',
  date_impossible: 'A date that cannot be right',
  approval_missing: 'An approval missing or lapsed',
  cost_unexplained: 'Cost moved without a reason',
  schedule_cost_differ: 'Schedule and cost differ',
  action_unowned: 'An action nobody owns',
};

/** What each kind is, in a line. A model is told only the two it may nominate (`SWEEP_MODEL_KINDS`). */
export const SWEEP_KIND_ASKED: Record<SweepKind, string> = {
  papers_disagree: 'two entries state the same thing differently: an area, a date, a name, a number, an amount',
  date_impossible: 'a date that cannot be right given another: a finish before its start, a validity that ends before it begins, work logged before the approval it needs was issued',
  approval_missing: 'work that is logged or scheduled depends on an approval the brief shows as missing, expired or expiring',
  cost_unexplained: 'a forecast or a package moved and the brief gives no variation, award or typed reason for it',
  schedule_cost_differ: 'the schedule and the cost tell different stories: money paid well ahead of work done, a late package with no cost movement, a forecast that assumes a date the schedule no longer shows',
  action_unowned: 'an open action with nobody named for it, or with no due date, that something else in the brief depends on',
};

/** The kinds that set one entry against another, so a proposal of one cites at least two. */
const SWEEP_PAIRED: ReadonlySet<SweepKind> = new Set(['papers_disagree', 'date_impossible', 'schedule_cost_differ']);

/**
 * The entries a kind is about: a proposal of it cites at least one of them.
 * "An approval missing or lapsed" that rests on an action line alone is not
 * about an approval, whatever it says.
 */
const SWEEP_CITES: Record<SweepKind, readonly SweepEntryKind[]> = {
  papers_disagree: ['fact', 'waiting', 'approval'],
  date_impossible: ['fact', 'waiting', 'schedule', 'milestone', 'approval', 'site_log', 'cost', 'action', 'decision', 'owed'],
  approval_missing: ['approval'],
  cost_unexplained: ['cost'],
  schedule_cost_differ: ['cost', 'schedule', 'milestone'],
  action_unowned: ['action'],
};

/** The department a kind falls to where a model names none the project uses. */
const SWEEP_KIND_DESK: Record<SweepKind, DepartmentKey> = {
  papers_disagree: 'legal',
  date_impossible: 'legal',
  approval_missing: 'legal',
  cost_unexplained: 'finance',
  schedule_cost_differ: 'finance',
  action_unowned: 'construction',
};

/* ==================================================================== */
/* The brief                                                             */
/* ==================================================================== */

export type SweepEntryKind = 'fact' | 'waiting' | 'schedule' | 'milestone' | 'approval' | 'site_log' | 'cost' | 'action' | 'decision' | 'owed' | 'finding' | 'risk' | 'alert' | 'change';

/** One line of the brief: one entry on the record, under the mark a model cites it by. */
export interface SweepEntry {
  /** e1, e2 and on. Good for one brief only. */
  mark: string;
  /** The id on the record of what the line is: a fact, a milestone, a paper, an action. The same from one day to the next. */
  ref: string;
  kind: SweepEntryKind;
  says: string;
  /** The paper that states it, and the page, where a paper does. */
  paper?: { evidenceId: string; title: string; page?: number };
  /** The day it is of: recorded, logged, issued or due. */
  on?: string;
  /** What the line is about, as the record names it: a package, a milestone, an approval, an action. */
  subject?: string;
  /** Money the line is about, in the project's currency: a package's movement that nothing accounts for. */
  amount?: number;
  /** A share the line states, 0 to 100: a milestone's work done, a report's forecast paid. */
  percent?: number;
}

export type SweepSectionKey = 'facts' | 'waiting' | 'schedule' | 'approvals' | 'site_log' | 'cost' | 'actions' | 'decisions' | 'owed' | 'register' | 'changes';

export interface SweepSection {
  key: SweepSectionKey;
  heading: string;
  entries: SweepEntry[];
  /** How many more the record holds that were left out to keep the brief short. */
  more: number;
}

export interface SweepBrief {
  projectId: string;
  /** The first lines: what the project is, its stage and the day. */
  head: string;
  sections: SweepSection[];
  /** The day changes are listed from: the last sweep, or a week back where there was none. */
  since: string;
}

/** The most lines a section may hold. */
export const SWEEP_SECTION_AT_MOST: Record<SweepSectionKey, number> = {
  facts: 120,
  waiting: 40,
  schedule: 60,
  approvals: 20,
  site_log: 30,
  cost: 40,
  actions: 60,
  decisions: 30,
  owed: 40,
  register: 40,
  changes: 40,
};

/** How long one line may be. */
export const SWEEP_LINE = 260;

/** How long the whole brief may be, in characters. Lines come off the longest section until it fits. */
export const SWEEP_BRIEF_CHARS = 36_000;

/** How far back changes are listed where the project has not been swept before. */
export const SWEEP_FIRST_LOOK_DAYS = 7;

const SECTION_HEADING: Record<SweepSectionKey, string> = {
  facts: 'Values accepted on the papers',
  waiting: 'Values read and waiting on a person',
  schedule: 'Schedule and its warnings',
  approvals: 'Approvals and NOCs',
  site_log: 'Site log, newest first',
  cost: 'Cost since the last report',
  actions: 'Open actions',
  decisions: 'Decisions',
  owed: 'Papers owed',
  register: 'Already raised: findings, risks and alerts that are open',
  changes: 'Changed since the last review, newest first',
};

const day = (iso: string | undefined): string | undefined => (iso ? iso.slice(0, 10) : undefined);

function line(text: string, atMost = SWEEP_LINE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > atMost ? `${flat.slice(0, atMost - 1).trimEnd()}…` : flat;
}

type Drafted = Omit<SweepEntry, 'mark'>;

function factSaid(fact: MemFact): string {
  const value = fact.display ?? `${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`;
  const valid = !fact.validFrom && !fact.validTo ? '' : fact.validFrom === fact.validTo ? ` (on ${fact.validFrom})` : ` (holds ${fact.validFrom ?? 'from no stated day'} to ${fact.validTo ?? 'no stated day'})`;
  return `${fact.label}: ${value}${valid}`;
}

/**
 * The values a paper states, each with its paper and page. Memory holds more
 * than that as facts (the project's own fields, each action, each site
 * entry); those are left to the sections that give them in full.
 */
function factEntries(project: DdProject, facts: readonly MemFact[], kind: 'fact' | 'waiting'): Drafted[] {
  const papers = new Map(project.evidence.map((row) => [row.id, row]));
  return facts.flatMap((fact): Drafted[] => {
    const paper = papers.get(fact.source) ?? papers.get(fact.aboutId);
    if (!paper) return [];
    const on = day(fact.at ?? fact.recordedAt);
    return [{ ref: fact.id, kind, subject: fact.label, says: line(factSaid(fact)), paper: { evidenceId: paper.id, title: paper.title, ...(fact.page ? { page: fact.page } : {}) }, ...(on ? { on } : {}) }];
  });
}

function scheduleEntries(project: DdProject, now: Date): Drafted[] {
  const watch = scheduleWatch(project, now);
  const held = new Map((project.milestones ?? []).map((m) => [m.id, m]));
  const out: Drafted[] = [];
  if (watch.say) out.push({ ref: `schedule:${project.id}`, kind: 'schedule', says: line(`The whole schedule. ${watch.say}${watch.extensionLikely ? ' An extension of time is likely.' : ''}`) });
  for (const m of watch.milestones) {
    const own = held.get(m.id);
    out.push({
      ref: m.id,
      kind: 'milestone',
      subject: m.name,
      percent: m.percent,
      says: line(
        [
          `${m.name}: ${m.percent}% done`,
          `planned ${own?.plannedStart ?? 'no start date'} to ${m.plannedFinish ?? 'no finish date'}`,
          own?.baselineFinish && own.baselineFinish !== m.plannedFinish ? `first planned to finish ${own.baselineFinish}` : '',
          own?.completedOn ? `completed ${own.completedOn}` : '',
          m.projectedFinish ? `at the current rate finishes ${m.projectedFinish}` : '',
          m.say ? `warning: ${m.say}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      ),
      ...(m.plannedFinish ? { on: m.plannedFinish } : {}),
    });
  }
  return out;
}

function approvalEntries(project: DdProject, now: Date): Drafted[] {
  return approvalsRegister(project, now)
    .filter((held) => held.status !== 'if_applicable' || held.held.length > 0)
    .map((held): Drafted => {
      const paper = held.held[0];
      return {
        ref: `approval:${held.kind.key}`,
        kind: 'approval',
        subject: held.kind.label,
        says: line(
          [
            `${held.kind.label}, needed before ${SUB_STAGE_LABEL[held.kind.neededBy]}: ${APPROVAL_STATUS_LABEL[held.status]}`,
            paper?.issuedOn ? `issued ${paper.issuedOn}` : '',
            paper?.validUntil ? `valid until ${paper.validUntil}` : '',
            paper?.readingWaiting ? 'a reading of its dates waits on a person' : '',
            held.say,
          ]
            .filter(Boolean)
            .join('; '),
        ),
        ...(paper ? { paper: { evidenceId: paper.evidenceId, title: paper.document, ...(paper.page ? { page: paper.page } : {}) } } : {}),
        ...(paper?.issuedOn ? { on: paper.issuedOn } : {}),
      };
    });
}

function siteLogEntries(project: DdProject): Drafted[] {
  return [...(project.siteLog ?? [])]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((entry): Drafted => ({
      ref: entry.id,
      kind: 'site_log',
      says: line(`${entry.date}: ${entry.workDone.trim().replace(/[.\s]+$/, '') || 'no work written'}${entry.issues.length ? `. Issues: ${entry.issues.map((issue) => issue.title).join(', ')}` : ''}`),
      on: entry.date,
    }));
}

function costEntries(project: DdProject): Drafted[] {
  const issued = costReportsOf(project)
    .filter((report) => report.status === 'issued')
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  const report = issued.at(-1);
  if (!report) return [];
  const money = (amount: number): string => moneySaid(amount, project.currency);
  const signed = (amount: number): string => `${amount > 0 ? '+' : ''}${money(amount)}`;
  const totals = costReportTotals(report);
  const moved = costReportChanges(project, report.id);
  const out: Drafted[] = [
    {
      ref: report.id,
      kind: 'cost',
      subject: `Cost Report ${report.label}`,
      ...(moved?.totals.unexplained ? { amount: moved.totals.unexplained } : {}),
      ...(totals.anticipatedCost > 0 ? { percent: Math.round((totals.amountPaid / totals.anticipatedCost) * 100) } : {}),
      says: line(
        [
          `Cost Report ${report.label} (${report.from} to ${report.to}): forecast ${money(totals.anticipatedCost)} against a budget of ${money(totals.budget)}, ${money(totals.amountPaid)} paid`,
          moved
            ? `forecast moved ${signed(moved.totals.figures.anticipatedCost.change)} since ${moved.previous.label}; ${signed(moved.totals.unexplained)} of it is accounted for by no variation or award, across ${moved.totals.unexplainedPackages} package${moved.totals.unexplainedPackages === 1 ? '' : 's'}`
            : 'no report was issued before it',
        ].join('; '),
      ),
      ...(day(report.issuedAt) ? { on: day(report.issuedAt) } : {}),
    },
  ];
  for (const change of [...(moved?.packages ?? [])].filter((p) => p.status !== 'unchanged').sort((a, b) => Math.abs(b.figures.anticipatedCost.change) - Math.abs(a.figures.anticipatedCost.change))) {
    const { previous, current, change: by } = change.figures.anticipatedCost;
    const paid = change.figures.amountPaid;
    out.push({
      ref: `${report.id}:${change.workPackageId}`,
      kind: 'cost',
      subject: `${change.code ? `${change.code} ` : ''}${change.name}`,
      // Movement nothing accounts for, and only where nobody typed a reason for it either.
      ...(change.unexplained && !change.reason ? { amount: change.unexplained } : {}),
      says: line(
        [
          `${change.code ? `${change.code} ` : ''}${change.name}: ${change.status === 'added' ? `new on the report at ${money(current ?? 0)}` : change.status === 'removed' ? `no longer on the report, was ${money(previous ?? 0)}` : `forecast ${money(previous ?? 0)} to ${money(current ?? 0)} (${signed(by)})`}`,
          paid.change ? `paid ${signed(paid.change)} to ${money(paid.current ?? 0)}` : '',
          ...change.causes.map((cause) => (cause.kind === 'variation' ? `variation "${cause.description}" ${signed(cause.amount)}${cause.dated ? ` dated ${cause.dated}` : ''}` : `awarded at ${money(cause.poIssued)}`)),
          change.unexplained ? `unexplained ${signed(change.unexplained)}` : '',
          change.reason ? `reason given: ${change.reason}` : 'no reason given',
        ]
          .filter(Boolean)
          .join('; '),
      ),
    });
  }
  return out;
}

const NOBODY = /^(unassigned|tbc|tbd|none|n\/a|-)?$/i;

/** Open actions, the most pressing first: the overdue and the ones nobody is named for, then the newest. */
function actionEntries(project: DdProject, now: Date): Drafted[] {
  const today = now.toISOString().slice(0, 10);
  const nobody = (action: DdProject['actions'][number]): boolean => NOBODY.test(action.owner?.trim() ?? '');
  const pressing = (action: DdProject['actions'][number]): number => Number(Boolean(action.dueDate && action.dueDate.slice(0, 10) < today)) + Number(nobody(action));
  return project.actions
    .filter((action) => action.status !== 'closed')
    .sort((a, b) => Number(pressing(b) > 0) - Number(pressing(a) > 0) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((action): Drafted => ({
      ref: action.id,
      kind: 'action',
      subject: line(action.title, 160),
      // Whether somebody is named, never who: a name is no part of any cross-check.
      says: line(`${action.title}: ${nobody(action) ? 'nobody named for it' : 'somebody is named for it'}; ${action.dueDate ? `due ${day(action.dueDate)}` : 'no due date'}; ${ACTION_STATUS_LABEL[action.status]}`),
      ...(day(action.dueDate) ? { on: day(action.dueDate) } : {}),
    }));
}

function decisionEntries(project: DdProject): Drafted[] {
  const open = (status: string): boolean => status === 'proposed' || status === 'pending';
  return [...project.decisions]
    .sort((a, b) => Number(open(b.status)) - Number(open(a.status)) || (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((decision): Drafted => ({
      ref: decision.id,
      kind: 'decision',
      says: line(`${decision.title}: ${DECISION_STATUS_LABEL[decision.status]}${decision.decidedAt ? `, decided ${day(decision.decidedAt)}` : ''}${decision.conditions ? `. Conditions: ${decision.conditions}` : ''}`),
      ...(day(decision.decidedAt) ? { on: day(decision.decidedAt) } : {}),
    }));
}

function owedEntries(project: DdProject, now: Date): Drafted[] {
  const iso = now.toISOString();
  const lines = checklistOwed(project, { now: iso }).parties.flatMap((party) => party.lines);
  const listed = new Set(lines.map((owed) => owed.requestId).filter(Boolean));
  return [
    ...lines.map((owed): Drafted => ({
      ref: owed.item.id,
      kind: 'owed',
      says: line(`${owed.item.title}${owed.item.stage ? ` (${owed.item.stage})` : ''}: not in hand; ${owed.requestId ? 'asked for' : 'not asked for'}${owed.dueAt ? `; due ${day(owed.dueAt)}` : ''}${owed.overdue ? '; overdue' : ''}`),
      ...(day(owed.dueAt) ? { on: day(owed.dueAt) } : {}),
    })),
    ...waitingOn(project, iso)
      .filter((waiting) => !listed.has(waiting.request.id))
      .map((waiting): Drafted => ({
        ref: waiting.request.id,
        kind: 'owed',
        says: line(`${waiting.request.title}: asked for ${waiting.ageDays} day${waiting.ageDays === 1 ? '' : 's'} ago${waiting.request.dueAt ? `; due ${day(waiting.request.dueAt)}` : ''}${waiting.overdue ? '; overdue' : ''}`),
        ...(day(waiting.request.dueAt) ? { on: day(waiting.request.dueAt) } : {}),
      })),
  ];
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * What is already raised. The section's lines are shared among findings,
 * risks and alerts, one of each in turn and the gravest of each first, so no
 * one of the three takes every line: a model told only of the findings would
 * raise the risks and alerts again.
 */
function registerEntries(project: DdProject): Drafted[] {
  const findings = project.findings
    .filter((finding) => finding.status !== 'closed' && !finding.screenClosedAt && !finding.duplicateOfId)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((finding): Drafted => ({ ref: finding.id, kind: 'finding', says: line(`Finding, ${SEVERITY_LABEL[finding.severity]}: ${finding.title}`) }));
  const risks = project.risks
    .filter((risk) => risk.status !== 'closed' && !risk.screenClosedAt)
    .sort((a, b) => SEVERITY_RANK[a.materiality] - SEVERITY_RANK[b.materiality])
    .map((risk): Drafted => ({ ref: risk.id, kind: 'risk', says: line(`Risk, ${SEVERITY_LABEL[risk.materiality]}: ${risk.title}`) }));
  const alerts = openAlerts(project).map((alert): Drafted => ({ ref: alert.id, kind: 'alert', says: line(`Alert: ${alert.title}. ${alert.detail}`), ...(alert.dueOn ? { on: alert.dueOn } : {}) }));
  const out: Drafted[] = [];
  for (let at = 0; at < Math.max(findings.length, risks.length, alerts.length); at += 1) {
    for (const list of [findings, risks, alerts]) if (list[at]) out.push(list[at]);
  }
  return out;
}

function changeEntries(project: DdProject, since: string): Drafted[] {
  return project.audit
    // Who is on the team is no part of a cross-check, and its trail holds addresses.
    .filter((event) => event.at > since && event.entityType !== 'team')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((event): Drafted => ({
      ref: event.id,
      kind: 'change',
      says: line(`${day(event.at)}: ${event.action.replace(/_/g, ' ')} ${event.entityType.replace(/_/g, ' ')}${event.newValue ? `: ${event.newValue}` : ''}${event.reason ? ` (reason: ${event.reason})` : ''}`, 180),
      on: day(event.at)!,
    }));
}

const entryText = (entry: Pick<SweepEntry, 'mark' | 'says' | 'paper'>): string =>
  `[${entry.mark}] ${entry.says}${entry.paper ? ` — paper “${line(entry.paper.title, 80)}”${entry.paper.page ? `, page ${entry.paper.page}` : ''}` : ''}`;

/**
 * Every line the record gives, by section, before any is cut to length. The
 * brief is these cut to its bounds; the rules (`sweep-rules.ts`) read them
 * whole, so what a rule finds rests on the same lines, under the same ids,
 * as what a model is shown.
 */
export function sweepDrafts(project: DdProject, now: Date, since: string, facts: readonly MemFact[] = memoryFacts(project).held): Record<SweepSectionKey, Array<Omit<SweepEntry, 'mark'>>> {
  return {
    facts: factEntries(project, facts.filter((fact) => fact.tag === 'approved'), 'fact'),
    waiting: factEntries(project, facts.filter((fact) => fact.tag === 'proposed'), 'waiting'),
    schedule: scheduleEntries(project, now),
    approvals: approvalEntries(project, now),
    site_log: siteLogEntries(project),
    cost: costEntries(project),
    actions: actionEntries(project, now),
    decisions: decisionEntries(project),
    owed: owedEntries(project, now),
    register: registerEntries(project),
    changes: changeEntries(project, since),
  };
}

/**
 * The project as a model is handed it for the daily review: what stands on
 * its papers with paper and page, what waits, the schedule and its warnings,
 * the approvals, the site log, cost since the last report, open actions and
 * decisions, papers owed, what is already raised, and what changed since
 * the last review. Where a section holds more than its lines, the newest
 * and most pressing are the ones kept: values newest first, actions overdue
 * or unowned first and then newest, and what is already raised shared among
 * findings, risks and alerts.
 *
 * Pure, and bounded three ways: each section holds a set number of lines,
 * each line a set length, and lines come off the longest section until the
 * whole is under `SWEEP_BRIEF_CHARS`. What is left out is counted.
 */
export function sweepBrief(project: DdProject, options: { now: Date; since?: string }): SweepBrief {
  const { now } = options;
  const since = options.since ?? new Date(now.getTime() - SWEEP_FIRST_LOOK_DAYS * 86_400_000).toISOString();
  // The newest first: where a section is cut to its length, what was recorded last is what stays.
  const facts = [...memoryFacts(project).held].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  const drafted = sweepDrafts(project, now, since, facts);
  const sections = (Object.keys(SECTION_HEADING) as SweepSectionKey[]).map((key) => {
    const all = drafted[key];
    const kept = all.slice(0, SWEEP_SECTION_AT_MOST[key]);
    return { key, heading: SECTION_HEADING[key], kept, more: all.length - kept.length };
  });
  // The length a line has in the text, mark and all: a mark is at most six characters.
  const cost = (entry: Drafted): number => entryText({ ...entry, mark: 'e0000' }).length + 1;
  let total = sections.reduce((sum, section) => sum + section.kept.reduce((n, entry) => n + cost(entry), 0), 0);
  while (total > SWEEP_BRIEF_CHARS) {
    const longest = sections.reduce((a, b) => (b.kept.length > a.kept.length ? b : a));
    const off = longest.kept.pop();
    if (!off) break;
    longest.more += 1;
    total -= cost(off);
  }
  let n = 0;
  return {
    projectId: project.id,
    head: `Project: ${line(project.name, 120)} (${project.type.replace(/_/g, ' ')}), ${line(project.city, 60)}. Stage: ${stageAndStep(project.currentStage)}. Today: ${now.toISOString().slice(0, 10)}. Money is in ${project.currency}.`,
    sections: sections.map((section) => ({ key: section.key, heading: section.heading, more: section.more, entries: section.kept.map((entry) => ({ ...entry, mark: `e${(n += 1)}` })) })),
    since,
  };
}

/** Every line of a brief, in its order. */
export function sweepEntries(brief: SweepBrief): SweepEntry[] {
  return brief.sections.flatMap((section) => section.entries);
}

/** The brief as a model reads it. */
export function sweepBriefText(brief: SweepBrief): string {
  return [
    brief.head,
    ...brief.sections.flatMap((section) => [
      '',
      `## ${section.heading}`,
      ...(section.entries.length ? section.entries.map(entryText) : ['Nothing on the record.']),
      ...(section.more ? [`(${section.more} more on the record, not shown.)`] : []),
    ]),
  ].join('\n');
}

/* ==================================================================== */
/* What a suggestion is                                                  */
/* ==================================================================== */

/** What a suggestion rests on: one entry of the record, as the brief gave it. */
export interface SweepSource {
  ref: string;
  kind: SweepEntryKind;
  says: string;
  evidenceId?: string;
  paper?: string;
  page?: number;
  on?: string;
}

export type SweepAs = 'finding' | 'risk';

/** What a person might do next. A fixed list: nobody, and no model, writes one. */
export const SWEEP_NEXT = ['correct_value', 'request_paper', 'assign_owner', 'record_reason', 'renew_approval'] as const;

export type SweepNext = (typeof SWEEP_NEXT)[number];

export const SWEEP_NEXT_LABEL: Record<SweepNext, string> = {
  correct_value: 'Correct the value',
  request_paper: 'Ask for the paper',
  assign_owner: 'Name who it is on',
  record_reason: 'Record the reason',
  renew_approval: 'Renew the approval',
};

/** The kinds code finds by a rule over the record. A model is not asked for them, and one it names is thrown away. */
export const SWEEP_RULE_KINDS = ['papers_disagree', 'date_impossible', 'approval_missing', 'action_unowned'] as const satisfies readonly SweepKind[];

/** The kinds a model may nominate: it names the kind and the lines, and code works out the rest. */
export const SWEEP_MODEL_KINDS = ['cost_unexplained', 'schedule_cost_differ'] as const satisfies readonly SweepKind[];

/**
 * What each kind is taken to be: how grave, what accepting it makes, and
 * what a person does next. A table, so no suggestion's standing is anybody's
 * judgement on the day. A rule may name a graver row for its own case.
 */
export const SWEEP_KIND_TABLE: Record<SweepKind, { severity: FindingSeverity; as: SweepAs; next: SweepNext }> = {
  papers_disagree: { severity: 'high', as: 'finding', next: 'correct_value' },
  date_impossible: { severity: 'medium', as: 'finding', next: 'correct_value' },
  approval_missing: { severity: 'high', as: 'finding', next: 'request_paper' },
  cost_unexplained: { severity: 'medium', as: 'finding', next: 'record_reason' },
  schedule_cost_differ: { severity: 'medium', as: 'risk', next: 'record_reason' },
  action_unowned: { severity: 'low', as: 'risk', next: 'assign_owner' },
};

/**
 * A suggestion before it is stored: its kind, what it is about, the two
 * things set against each other and how far apart they are, and the record's
 * lines it rests on. Every member is a key off a fixed list, a figure code
 * worked out, or the record's own words for a thing. No sentence is kept:
 * the line a person reads is made from these each time (`sweepSaid`).
 */
export interface SweepProposal {
  kind: SweepKind;
  /** What found it: a rule over the record, or a model's nomination that code then worked out. Absent on one kept before suggestions were fields. */
  by?: 'rule' | 'model';
  /** The fields it is about, where it is about fields. */
  subjects?: FieldAddress[];
  /** The two things set against each other, each as the record names it. */
  left?: string;
  right?: string;
  /** How far apart they are: an amount, days, points of a share, or a percentage. */
  difference?: number;
  /** What `difference` is counted in: a currency code, `days`, `points` or `%`. */
  unit?: string;
  department: DepartmentKey;
  severity: FindingSeverity;
  /** What accepting it makes. */
  as: SweepAs;
  /** Absent on one kept before suggestions were fields. */
  next?: SweepNext;
  sources: SweepSource[];
  /**
   * Written by a model, before suggestions were fields. Read back from what
   * was stored then and shown marked as such; nothing new carries them.
   */
  statement?: string;
  why?: string;
  action?: string;
}

/** The most suggestions one review may raise from a model's nominations. */
export const SWEEP_PROPOSALS_AT_MOST = 8;

/** The most suggestions the rules may raise in one review, the gravest first. */
export const SWEEP_RULES_AT_MOST = 12;

export const SWEEP_LIMITS = { cites: 8, reason: 300 } as const;

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function sweepSourceOf(entry: Omit<SweepEntry, 'mark'>): SweepSource {
  return {
    ref: entry.ref,
    kind: entry.kind,
    says: entry.says,
    ...(entry.paper ? { evidenceId: entry.paper.evidenceId, paper: entry.paper.title, ...(entry.paper.page ? { page: entry.paper.page } : {}) } : {}),
    ...(entry.on ? { on: entry.on } : {}),
  };
}

/** The department a suggestion falls to: the one asked for where the project uses it, else the kind's own, else the project's first. */
export function sweepDesk(project: DdProject, kind: SweepKind, asked?: DepartmentKey): DepartmentKey {
  const desks = projectDepartments(project);
  return asked && desks.includes(asked) ? asked : desks.includes(SWEEP_KIND_DESK[kind]) ? SWEEP_KIND_DESK[kind] : (desks[0] ?? SWEEP_KIND_DESK[kind]);
}

/* ==================================================================== */
/* The line a person reads                                               */
/* ==================================================================== */

function apart(matter: Pick<SweepProposal, 'difference' | 'unit'>): string {
  const { difference: n, unit } = matter;
  if (n === undefined || !unit) return '';
  const size = Math.abs(n);
  if (unit === 'days') return `${size} day${size === 1 ? '' : 's'}`;
  if (unit === 'points') return `${size} point${size === 1 ? '' : 's'}`;
  if (unit === '%') return `${size}%`;
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${moneySaid(size, unit === 'EUR' ? 'EUR' : 'INR')}`;
}

/** Each kind's line, made from the suggestion's own members. Where a member is missing the line is the kind's name. */
const SWEEP_SAY: Record<SweepKind, (m: SweepProposal) => string> = {
  papers_disagree: (m) => (m.left && m.right ? `${m.left} against ${m.right}${m.unit === '%' && m.difference ? `: ${apart(m)} apart` : ''}.` : ''),
  date_impossible: (m) => (m.left && m.right ? `${m.left} is after ${m.right}${apart(m) ? `, by ${apart(m)}` : ''}.` : ''),
  approval_missing: (m) => (m.left ? `${m.left}: ${m.right ?? 'not in force'}, and work depends on it.` : ''),
  cost_unexplained: (m) => (m.left && apart(m) ? `${m.left}: ${apart(m)} that no variation, award or reason accounts for.` : ''),
  schedule_cost_differ: (m) =>
    m.left && m.right ? (m.unit === 'points' && m.difference !== undefined ? `${m.left} against ${m.right}: money paid and work done are ${apart(m)} apart.` : `${m.left} against ${m.right}: cost and schedule differ.`) : '',
  action_unowned: (m) => (m.left ? `${m.left}: ${m.right ?? 'nobody is named for it'}.` : ''),
};

/** Why each kind matters, once, the same for every suggestion of it. */
export const SWEEP_KIND_WHY: Record<SweepKind, string> = {
  papers_disagree: 'Two papers on the file state the same thing differently, and only one can stand.',
  date_impossible: 'One date on the record cannot be right given another.',
  approval_missing: 'Work is logged or scheduled that needs an approval the register does not show in force.',
  cost_unexplained: 'The forecast moved and the cost report gives no variation, award or typed reason for it.',
  schedule_cost_differ: 'The cost report and the schedule do not describe the same progress.',
  action_unowned: 'An open action has nobody named for it, so nothing brings it to anyone.',
};

export interface SweepSaid {
  /** The one line. */
  line: string;
  why: string;
  /** What a person does next, from the fixed list. */
  next: string;
  /** True where the wording is a model's, kept before suggestions were fields. */
  byModelBefore: boolean;
}

/**
 * A suggestion as a person reads it. For one kept since suggestions were
 * fields, every word is a template's or the record's. For one kept before,
 * the model's sentences are given back as they were stored, marked.
 */
export function sweepSaid(matter: SweepProposal): SweepSaid {
  if (matter.statement && !matter.by) {
    return { line: matter.statement, why: matter.why ?? '', next: matter.action ?? '', byModelBefore: true };
  }
  return {
    line: SWEEP_SAY[matter.kind](matter) || `${SWEEP_KIND_LABEL[matter.kind]}.`,
    why: SWEEP_KIND_WHY[matter.kind],
    next: matter.next ? SWEEP_NEXT_LABEL[matter.next] : '',
    byModelBefore: false,
  };
}

/* ==================================================================== */
/* Holding what a model nominated                                        */
/* ==================================================================== */

/** What a model answers: a kind off the list and the marks of the lines it read. Nothing else is read from it. */
export interface SweepNomination {
  kind: SweepKind;
  cites: string[];
}

/**
 * What of a model's answer becomes a suggestion.
 *
 * Only a kind and marks are read from a nomination: any sentence, severity,
 * department or advice beside them is ignored and never stored. A nomination
 * is dropped, whole, where its kind is not one a model is asked for
 * (`SWEEP_MODEL_KINDS`), it cites nothing, cites a mark that is no line of
 * the brief it was given, cites no entry of a kind its own kind is about
 * (`SWEEP_CITES`), sets one thing against another and cites only one, or
 * where code cannot work out the difference it claims: unexplained cost
 * cites a line that carries an unexplained amount, and schedule against cost
 * cites a line of each.
 *
 * What is kept is worked out here: the two things from the record's own
 * names, the difference from the lines' own figures, and severity, next step
 * and department from tables.
 */
export function sweepNominationsHeld(project: DdProject, brief: SweepBrief, said: unknown): { kept: SweepProposal[]; dropped: number } {
  const byMark = new Map(sweepEntries(brief).map((entry) => [entry.mark, entry]));
  const kept: SweepProposal[] = [];
  let dropped = 0;
  for (const raw of Array.isArray(said) ? said : []) {
    const given = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const kind = SWEEP_MODEL_KINDS.find((known) => known === given.kind);
    const marks = Array.isArray(given.cites) ? [...new Set(given.cites.map((mark) => String(mark).trim().replace(/^\[|\]$/g, '')))] : [];
    const resolved = marks.map((mark) => byMark.get(mark)).filter((entry): entry is SweepEntry => Boolean(entry));
    const refs = new Set(resolved.map((entry) => entry.ref));
    const fits = Boolean(kind) && resolved.some((entry) => SWEEP_CITES[kind!].includes(entry.kind));
    const worked = kind && fits ? workedOut(project, kind, resolved) : undefined;
    if (!kind || !marks.length || marks.length > SWEEP_LIMITS.cites || resolved.length !== marks.length || !fits || (SWEEP_PAIRED.has(kind) && refs.size < 2) || !worked || kept.length >= SWEEP_PROPOSALS_AT_MOST) {
      dropped += 1;
      continue;
    }
    const table = SWEEP_KIND_TABLE[kind];
    kept.push({
      kind,
      by: 'model',
      ...worked,
      department: sweepDesk(project, kind),
      severity: table.severity,
      as: table.as,
      next: table.next,
      sources: [...refs].map((ref) => sweepSourceOf(resolved.find((held) => held.ref === ref)!)),
    });
  }
  return { kept, dropped };
}

/** The two things and the difference a nomination claims, from the lines it cites. Nothing where the lines do not carry them. */
function workedOut(project: DdProject, kind: (typeof SWEEP_MODEL_KINDS)[number], cited: readonly SweepEntry[]): Pick<SweepProposal, 'left' | 'right' | 'difference' | 'unit'> | undefined {
  if (kind === 'cost_unexplained') {
    // A package before the whole report: the narrower line is the one to act on.
    const moved = cited.filter((entry) => entry.kind === 'cost' && entry.subject && entry.amount).sort((a, b) => Number(b.ref.includes(':')) - Number(a.ref.includes(':')))[0];
    return moved ? { left: moved.subject, difference: moved.amount, unit: project.currency } : undefined;
  }
  const cost = cited.find((entry) => entry.kind === 'cost' && entry.subject);
  const work = cited.find((entry) => entry.kind === 'milestone' || entry.kind === 'schedule');
  if (!cost?.subject || !work) return undefined;
  const right = work.subject ?? 'The schedule';
  if (cost.percent !== undefined && work.percent !== undefined) return { left: cost.subject, right, difference: cost.percent - work.percent, unit: 'points' };
  return { left: cost.subject, right };
}

/** The gravest first, and no more than a review may raise. */
export function sweepRulesKept(found: readonly SweepProposal[]): SweepProposal[] {
  return [...found].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, SWEEP_RULES_AT_MOST);
}

/* ==================================================================== */
/* What is kept beside the project                                       */
/* ==================================================================== */

export type SweepStatus = 'open' | 'accepted' | 'dismissed';

export interface SweepSuggestion extends SweepProposal {
  id: string;
  /** Its kind and what it is about, as one short mark: two suggestions with the same one are the same matter. */
  fingerprint: string;
  raisedAt: string;
  status: SweepStatus;
  decidedAt?: string;
  decidedBy?: string;
  /** Why it was dismissed, in the person's words. */
  reason?: string;
  /** What accepting it made. */
  record?: { type: SweepAs; id: string };
}

/**
 * What the daily review keeps for one project, in a file of its own beside
 * the project's. Never on the project: a suggestion nobody has accepted is
 * no part of the record. Every field is optional on what is read back
 * (`sweepStateOf`), so a file written by another build still opens.
 */
export interface FileSweepState {
  v: 1;
  /** When the project was last reviewed. */
  sweptAt?: string;
  /** The project's `updatedAt` as it was then: the review looks again only once it has moved. */
  sweptThrough?: string;
  /** The day `tokens` were spent on, and how many: what the day's ceiling is counted against. */
  day?: string;
  tokens?: number;
  suggestions: SweepSuggestion[];
}

/** What was read from storage, as a state: nothing, or anything unreadable, is a project never reviewed. */
export function sweepStateOf(raw: unknown): FileSweepState {
  const held = (raw && typeof raw === 'object' ? raw : {}) as Partial<FileSweepState>;
  return {
    v: 1,
    ...(typeof held.sweptAt === 'string' ? { sweptAt: held.sweptAt } : {}),
    ...(typeof held.sweptThrough === 'string' ? { sweptThrough: held.sweptThrough } : {}),
    ...(typeof held.day === 'string' ? { day: held.day } : {}),
    ...(typeof held.tokens === 'number' && Number.isFinite(held.tokens) ? { tokens: held.tokens } : {}),
    suggestions: Array.isArray(held.suggestions) ? held.suggestions.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.sources) && SWEEP_KINDS.includes(s.kind)) : [],
  };
}

/** A matter's mark: its kind, and the entries of the record it is about, in a fixed order. Not its wording. */
export function sweepFingerprint(kind: SweepKind, refs: readonly string[]): string {
  return `${kind}:${memHash([...new Set(refs)].sort().join('\n'))}`;
}

const refsOf = (matter: Pick<SweepProposal, 'sources'>): string[] => matter.sources.map((source) => source.ref);

/**
 * Whether two are the same matter: the same kind, about the same entries, or
 * one about some of the other's. A model that words a thing differently the
 * next day, or cites one entry more or fewer for it, has not found a new
 * thing.
 */
export function sameSweepMatter(a: Pick<SweepProposal, 'kind' | 'sources'>, b: Pick<SweepProposal, 'kind' | 'sources'>): boolean {
  if (a.kind !== b.kind) return false;
  const [mine, theirs] = [new Set(refsOf(a)), new Set(refsOf(b))];
  const within = (small: Set<string>, large: Set<string>): boolean => small.size > 0 && [...small].every((ref) => large.has(ref));
  return within(mine, theirs) || within(theirs, mine);
}

/** Whether two are about the very same entries of the record, whatever kind each was called. */
function sameSweepRefs(a: Pick<SweepProposal, 'sources'>, b: Pick<SweepProposal, 'sources'>): boolean {
  const [mine, theirs] = [new Set(refsOf(a)), new Set(refsOf(b))];
  return mine.size > 0 && mine.size === theirs.size && [...mine].every((ref) => theirs.has(ref));
}

/**
 * Keep the proposals that are new. One that is the same matter as a
 * suggestion already held is not raised: an open or accepted one is not
 * duplicated, and a dismissed one never comes back.
 *
 * What a dismissal silences is narrower than what an open suggestion covers.
 * A person dismissed one thing, about the entries it cited: a proposal about
 * those same entries stays silent, whichever kind a model calls it this
 * time, and one that cites another entry beside them is another matter and
 * is raised. An approval or the schedule is one entry for the life of the
 * project, so a dismissal that covered everything citing it would silence
 * every later problem with it.
 */
export function sweepRaise(state: FileSweepState, proposals: readonly SweepProposal[], at: string): { raised: SweepSuggestion[]; repeats: number; dismissedBefore: number } {
  const raised: SweepSuggestion[] = [];
  let repeats = 0;
  let dismissedBefore = 0;
  for (const proposal of proposals) {
    const twin = state.suggestions.find((held) => (held.status === 'dismissed' ? sameSweepRefs(held, proposal) : sameSweepMatter(held, proposal)));
    if (twin) {
      if (twin.status === 'dismissed') dismissedBefore += 1;
      else repeats += 1;
      continue;
    }
    const fingerprint = sweepFingerprint(proposal.kind, refsOf(proposal));
    const suggestion: SweepSuggestion = { ...proposal, id: `swp_${memHash(`${fingerprint}\n${at}\n${state.suggestions.length}`)}`, fingerprint, raisedAt: at, status: 'open' };
    state.suggestions.push(suggestion);
    raised.push(suggestion);
  }
  return { raised, repeats, dismissedBefore };
}

/** The suggestions nobody has decided, newest first. */
export function openSweepSuggestions(state: Pick<FileSweepState, 'suggestions'>): SweepSuggestion[] {
  return state.suggestions.filter((held) => held.status === 'open').sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : a.raisedAt > b.raisedAt ? -1 : 0));
}

/**
 * Whether a project is due a review: it is in work, it has moved since the
 * last one, and it was not reviewed today. A project never reviewed is due.
 */
export function sweepDue(project: Pick<DdProject, 'status' | 'updatedAt'>, state: Pick<FileSweepState, 'sweptAt' | 'sweptThrough'>, now: Date): boolean {
  if (project.status !== 'active') return false;
  if (state.sweptAt?.slice(0, 10) === now.toISOString().slice(0, 10)) return false;
  return state.sweptThrough !== project.updatedAt;
}

/** Tokens spent on a project on the day given. */
export function sweepTokensOn(state: Pick<FileSweepState, 'day' | 'tokens'>, today: string): number {
  return state.day === today ? (state.tokens ?? 0) : 0;
}

/* ==================================================================== */
/* A person decides                                                      */
/* ==================================================================== */

/** A source as a record's description writes it: what it says, then the paper and page, or the day. */
export function sweepSourceSaid(source: SweepSource): string {
  const where = source.paper ? `${source.paper}${source.page ? `, page ${source.page}` : ''}` : source.on ? `recorded ${source.on}` : '';
  return `${source.says}${where ? ` (${where})` : ''}`;
}

const DESK_SCOPE: Record<DepartmentKey, ScopeKey> = {
  finance: 'cost_quantity',
  legal: 'legal',
  design: 'technical',
  construction: 'schedule_progress',
  procurement: 'procurement',
  commercial: 'commercial_market',
};

const KIND_IMPACT: Record<SweepKind, RiskImpactType> = {
  papers_disagree: 'legal',
  date_impossible: 'compliance',
  approval_missing: 'compliance',
  cost_unexplained: 'cost',
  schedule_cost_differ: 'time',
  action_unowned: 'operational',
};

const SEVERITY_IMPACT: Record<FindingSeverity, ImpactScore> = { low: 2, medium: 3, high: 4, critical: 5 };

function waiting(state: FileSweepState, suggestionId: string, what: string, mayDecide: MayDecide | undefined): SweepSuggestion {
  const held = state.suggestions.find((suggestion) => suggestion.id === suggestionId);
  if (!held) throw new Error('No suggestion by that id.');
  if (mayDecide && !mayDecide(held.department)) throw decisionRefused(what, held.department, mayDecide);
  if (held.status !== 'open') throw new Error(`This suggestion was ${held.status} already.`);
  return held;
}

/**
 * Accept a suggestion: it becomes a finding, or a risk, made the way any
 * other is, with the record's own words for what it rests on and the papers
 * it cites as its proof. For a lead or signer of its department. The trail
 * says a person accepted it and that the daily review raised it.
 */
export function acceptSweepSuggestion(
  project: DdProject,
  state: FileSweepState,
  suggestionId: string,
  by: { actor: string; as?: SweepAs; at?: string },
  mayDecide?: MayDecide,
): { suggestion: SweepSuggestion; record: FindingRecord | RiskRecord } {
  const held = waiting(state, suggestionId, 'Accepting a suggestion of the daily review', mayDecide);
  const at = by.at ?? new Date().toISOString();
  const as = by.as ?? held.as;
  const rests = held.sources.map(sweepSourceSaid).join('; ');
  const papers = [...new Set(held.sources.map((source) => source.evidenceId).filter((id): id is string => Boolean(id) && project.evidence.some((row) => row.id === id)))];
  const origin = `Suggested by the daily review on ${held.raisedAt.slice(0, 10)}, accepted by ${by.actor} on ${at.slice(0, 10)}.`;
  // The record's title and cause are the suggestion's line and its kind's reason: a template's words, or for one kept before suggestions were fields, what was stored then.
  const said = sweepSaid(held);
  let record: FindingRecord | RiskRecord;
  if (as === 'risk') {
    const risk = addRisk(
      project,
      { title: said.line, category: KIND_IMPACT[held.kind], cause: `${said.why} Rests on: ${rests}`, impactType: KIND_IMPACT[held.kind], probability: 'possible', impactScore: SEVERITY_IMPACT[held.severity], materiality: held.severity, ...(said.next ? { mitigation: said.next } : {}) },
      by.actor,
    );
    risk.evidenceIds = papers;
    risk.residualNote = origin;
    record = risk;
  } else {
    const finding = addFinding(project, { title: said.line, description: `${said.why}\n\nRests on: ${rests}`, severity: held.severity, discipline: DESK_SCOPE[held.department], evidenceIds: papers }, by.actor);
    if (said.next) finding.mitigation = said.next;
    finding.confidenceNote = origin;
    record = finding;
  }
  recordAuditEvent(project, { actor: by.actor, action: 'accept_review_suggestion', entityType: as, entityId: record.id, newValue: said.line, reason: SWEEP_KIND_LABEL[held.kind], at });
  Object.assign(held, { status: 'accepted', decidedAt: at, decidedBy: by.actor, record: { type: as, id: record.id } } satisfies Partial<SweepSuggestion>);
  return { suggestion: held, record };
}

/**
 * Dismiss a suggestion, with the reason. For a lead or signer of its
 * department. It stays in what the review keeps, so the same matter is
 * never raised again. The project is not touched: nothing was on it.
 */
export function dismissSweepSuggestion(state: FileSweepState, suggestionId: string, by: { actor: string; reason: string; at?: string }, mayDecide?: MayDecide): SweepSuggestion {
  const reason = line(by.reason, SWEEP_LIMITS.reason);
  if (reason.length < 3) throw new Error('Say why it is dismissed.');
  const held = waiting(state, suggestionId, 'Dismissing a suggestion of the daily review', mayDecide);
  Object.assign(held, { status: 'dismissed', decidedAt: by.at ?? new Date().toISOString(), decidedBy: by.actor, reason } satisfies Partial<SweepSuggestion>);
  return held;
}
