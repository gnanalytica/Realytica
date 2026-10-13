/**
 * Numbers that say where to look: across projects, by department, by person.
 *
 * Everything here is worked out on read from the projects it is handed and
 * the day it is told it is. Nothing is stored. Every figure is a count of
 * rows it keeps beside it, and every row says the record it stands on and
 * where that record opens, so a figure is never a number with nothing behind
 * it.
 *
 * Three rules hold throughout.
 *
 * A figure counts what a person put on the record or what waits for one.
 * Money is read from issued Cost Reports only; a draft's figures are nobody's
 * yet.
 *
 * Who may read. Somebody working from a grant reads none of this
 * (`readsAnalytics`). A firm member reads the project and department
 * figures. The figures about one person are read by that person, and by
 * somebody who leads a department on the project the work is on, for that
 * project only (`readsPersonFigures`). A viewer reads no figures about a
 * person, their own included.
 *
 * People are never set against each other. The people are listed by name,
 * no figure orders them, and nothing here is a score.
 */

import type { DdProject, EvidenceRecord } from './types';
import type { ProjectCockpitPane } from './cockpit';
import type { CockpitPathExtra } from './sitting';
import type { WorkspaceRole } from './tenancy';
import { sameEmail } from './tenancy';
import { waitingOnCanvas } from './cockpit';
import { functionOfDocument, papersOwedOpen } from './chat-places';
import { checklistOwed } from './checklist';
import { requirementSheet } from './requirement-sheet';
import { costReportDecisions } from './cost-report-compare';
import { packageAwaitsNoAward } from './owner-pack';
import { costReportPeriodOrder, costReportTotals, costReportsOf, type CostReportPeriod } from './cost-report';
import { costRegister, moneySaid } from './cost';
import { COST_REPORT_PERIODS, periodSeries } from './sheet-periods';
import { scheduleWatch, type ScheduleLevel } from './milestone-schedule';
import { openAlerts, type AlertSeverity } from './alerts';
import { DEPARTMENT_SHORT, functionDepartment, menuDepartment, menuDepartmentsOf, workstreamOfCheck, type DepartmentKey } from './departments';
import { departmentRole, projectDepartments } from './team';
import { allChecks } from './engagements';
import { documentWorkstream } from './vault';
import { meetingDay, meetingOfRecord } from './meetings';
import { indiaToday } from './quarters';
import { requestAgeDays } from './project-requests';
import { myWorkOn, ownedBy, sortWork, WORK_KIND_LABEL, type WorkItem, type WorkPerson } from './my-work';

/** How far back "accepted lately" looks, in days, counted back from the moment asked. */
export const ANALYTICS_WINDOW_DAYS = 30;

/** The most rows a figure carries. Its count is of all of them. */
export const ANALYTICS_ROWS = 200;

const DAY_MS = 86_400_000;

/** One record behind a figure: what it is, the record it stands on, and where it opens. */
export interface AnalyticsRow {
  projectId: string;
  projectName: string;
  title: string;
  /** One line beside the title: who, how much, since when. */
  detail?: string;
  /** The day it dates from or falls due, YYYY-MM-DD. */
  when?: string;
  /** Whole days it has waited, where it waits. */
  ageDays?: number;
  overdue?: boolean;
  /** The record this row is read from, as a person would name it. */
  source: string;
  pane: ProjectCockpitPane;
  extra?: CockpitPathExtra;
}

/**
 * A number and the rows behind it. The number is of every row, or of the
 * decisions the rows hold where one row holds several. `rows` holds at most
 * `ANALYTICS_ROWS`, and `more` says how many were left off.
 */
export interface AnalyticsFigure {
  count: number;
  rows: AnalyticsRow[];
  more?: number;
}

function figure(rows: AnalyticsRow[], count = rows.length): AnalyticsFigure {
  return { count, rows: rows.slice(0, ANALYTICS_ROWS), ...(rows.length > ANALYTICS_ROWS ? { more: rows.length - ANALYTICS_ROWS } : {}) };
}

function fold(text: string | undefined): string {
  return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Whole days from an instant to another; nothing before it. */
function daysBetween(from: string | undefined, to: number): number {
  const ms = to - Date.parse(from ?? '');
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY_MS) : 0;
}

function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

const sum = (amounts: readonly number[]): number => amounts.reduce((paise, amount) => paise + inPaise(amount), 0) / 100;

const base = (project: DdProject): Pick<AnalyticsRow, 'projectId' | 'projectName'> => ({ projectId: project.id, projectName: project.name });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ==================================================================== */
/* Who may read                                                          */
/* ==================================================================== */

/** Whether somebody reads any of this: the firm's own people do, somebody working from a grant does not. */
export function readsAnalytics(role: WorkspaceRole): boolean {
  return role !== 'collaborator';
}

export interface AnalyticsReader {
  email: string;
  role: WorkspaceRole;
}

/**
 * Whether `reader` reads the figures about `subject` that come from one
 * project.
 *
 * Only a firm member's figures exist, and a viewer or somebody working from
 * a grant reads nobody's. A person reads their own. Anybody else's are read
 * only by somebody who leads a department this project uses, by its team
 * list or by their firm role, and only for this project: a lead on one
 * project learns nothing about a colleague's work on another.
 */
export function readsPersonFigures(reader: AnalyticsReader, subject: AnalyticsReader, project: DdProject): boolean {
  if (!readsAnalytics(reader.role) || reader.role === 'viewer') return false;
  if (!readsAnalytics(subject.role)) return false;
  if (sameEmail(reader.email, subject.email)) return true;
  return projectDepartments(project).some((department) => departmentRole(project, { email: reader.email, workspaceRole: reader.role }, department) === 'lead');
}

/* ==================================================================== */
/* Across projects                                                       */
/* ==================================================================== */

/** One project's forecast against its budget, from its last issued Cost Report. */
export interface AcrossCostLine {
  projectId: string;
  projectName: string;
  currency: DdProject['currency'];
  reportId: string;
  reportLabel: string;
  budget: number;
  forecast: number;
  /** forecast − budget; below zero is under budget. */
  over: number;
  /** The forecast's change since the report issued before it. Absent when none was. */
  movement?: number;
  previousLabel?: string;
  /** The packages forecast over their budget on this report. */
  overBudget: AnalyticsFigure;
}

/** The projects of one currency added up. Two currencies are never added together. */
export interface AcrossCostTotal {
  currency: DdProject['currency'];
  projects: number;
  budget: number;
  forecast: number;
  over: number;
  /** The sum of the movements of the projects that have an earlier report, and how many do. */
  movement: number;
  compared: number;
}

export interface AcrossScheduleLine {
  projectId: string;
  projectName: string;
  milestones: number;
  plannedCompletion?: string;
  projectedCompletion?: string;
  projectedDaysLate?: number;
  extensionLikely: boolean;
  /** Milestones late, behind or slipping. */
  warned: AnalyticsFigure;
  /** Progress planned against progress made, month by month, the latest last (`ACROSS_SCHEDULE_SERIES`). Absent where the schedule gives no months. */
  curve?: Array<{ key: string; label: string; planned: number | null; actual: number | null }>;
  /** The latest month that has a figure made, in a line: "September 2026: 42% made against 48% planned". */
  curveSaid?: string;
}

/** Units sold on one project, period by period (`ACROSS_SOLD_SERIES`). */
export interface AcrossSalesLine {
  projectId: string;
  projectName: string;
  /** Each period the stock sheet issued, then the sheet as it reads now, the latest last. */
  points: Array<{ key: string; label: string; value: number | null; open: boolean }>;
  /** The latest count. */
  sold: number | null;
  /** The latest less the one before, and which period that was. */
  movement?: number;
  previousLabel?: string;
}

/** What one party owes, on every project. `party` is absent for the papers nobody is named for. */
export interface AcrossParty {
  party?: string;
  projects: number;
  overdue: number;
  papers: AnalyticsFigure;
}

export interface AcrossAlertKind {
  kind: string;
  label: string;
  critical: number;
  alerts: AnalyticsFigure;
}

export interface AcrossProjects {
  generatedAt: string;
  today: string;
  projects: number;
  cost: {
    lines: AcrossCostLine[];
    totals: AcrossCostTotal[];
    /** Projects with a budget register or a draft and no Cost Report issued. */
    notIssued: AnalyticsFigure;
  };
  schedule: {
    lines: AcrossScheduleLine[];
    extensions: AnalyticsFigure;
  };
  /** Units sold by period, on the projects that keep the week's stock by period. */
  sales: {
    lines: AcrossSalesLine[];
  };
  papers: {
    owed: number;
    parties: AcrossParty[];
  };
  alerts: {
    open: number;
    kinds: AcrossAlertKind[];
  };
  /** What waits on the owner: packages over budget or not awarded, an extension of time, and decisions not yet made. */
  decisions: AnalyticsFigure;
}

const ALERT_KIND_LABEL: Record<string, string> = {
  approval: 'Approvals',
  revisit: 'Reports to revisit',
  gate: 'Work without approvals',
  late: 'Milestones late',
  slip: 'Milestones behind',
  eot: 'Extension of time',
  issue: 'Site issues',
  action: 'Actions overdue',
  tender: 'Tender stages past their date',
};

const ALERT_SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

const LEVEL_SAID: Record<ScheduleLevel, string> = { late: 'Late', behind: 'Behind', slipping: 'Slipping' };

/**
 * The figures read across projects period by period, each by the address a set kept by period answers to
 * (`periodSeries`). A short list, and no code of its own for any of them: the Cost Report's forecast and its budget.
 */
export const ACROSS_SERIES = [
  { set: COST_REPORT_PERIODS, field: 'anticipatedCost' },
  { set: COST_REPORT_PERIODS, field: 'budget' },
] as const;

/** Progress planned and progress made, month by month: the two figures of the programme a schedule line is drawn from. */
export const ACROSS_SCHEDULE_SERIES = [
  { set: 'construction.progress.programme', field: 'planned_percent' },
  { set: 'construction.progress.programme', field: 'actual_percent' },
] as const;
/** Units sold, week by week, where the project keeps the week's stock. */
export const ACROSS_SOLD_SERIES = { set: 'commercial.inventory.stock', field: 'units_sold' } as const;
/** The most periods a line across projects carries. */
export const ACROSS_SERIES_MOST = 12;

function lastIssued(project: Pick<DdProject, 'costReports'>): CostReportPeriod | undefined {
  return costReportsOf(project)
    .filter((report) => report.status === 'issued')
    .sort(costReportPeriodOrder)
    .at(-1);
}

function reportSaid(report: CostReportPeriod): string {
  return `Cost Report ${report.label}${report.issuedAt ? `, issued ${meetingDay(report.issuedAt)}` : ''}`;
}

const BUDGET_PLACE = { pane: 'workstream', extra: { workstream: 'finance.budget' } } as const;
const PROGRESS_PLACE = { pane: 'workstream', extra: { workstream: 'construction.progress' } } as const;

/** The firm's projects read side by side, on the day given. */
export function acrossProjects(projects: readonly DdProject[], now: Date): AcrossProjects {
  const iso = now.toISOString();
  const today = indiaToday(now);
  const at = now.getTime();

  const costLines: AcrossCostLine[] = [];
  const notIssued: AnalyticsRow[] = [];
  const scheduleLines: AcrossScheduleLine[] = [];
  const salesLines: AcrossSalesLine[] = [];
  const extensions: AnalyticsRow[] = [];
  const parties = new Map<string, { party?: string; rows: AnalyticsRow[] }>();
  const alertKinds = new Map<string, { rows: AnalyticsRow[]; critical: number; worst: number }>();
  const decisions: AnalyticsRow[] = [];
  let owed = 0;
  let openAlertCount = 0;

  const owes = (party: string | undefined, row: AnalyticsRow): void => {
    const key = fold(party);
    const held = parties.get(key) ?? { ...(key ? { party: party!.trim() } : {}), rows: [] };
    parties.set(key, held);
    held.rows.push(row);
    owed += 1;
  };

  for (const project of projects) {
    const money = (amount: number): string => moneySaid(amount, project.currency);

    /* ---- Cost ---- */
    const report = lastIssued(project);
    if (report) {
      const totals = costReportTotals(report);
      // The forecast and the budget month by month, as any figure kept by period is read (`ACROSS_SERIES`): the last point is this
      // report's, and the one before it is what the forecast has moved from.
      const [forecast, budget] = ACROSS_SERIES.map((address) => periodSeries(project, address, now));
      const [latest, before] = [forecast!.at(-1), forecast!.at(-2)];
      const source = reportSaid(report);
      const asks = costReportDecisions(report);
      const overBudget = asks.overBudget.map((pack) => ({
        ...base(project),
        title: `Over budget: ${pack.code ? `${pack.code} ` : ''}${pack.name}`,
        detail: `Forecast ${money(pack.anticipatedCost)} against ${money(pack.budget)}, ${money(pack.over)} over`,
        source,
        ...BUDGET_PLACE,
      }));
      costLines.push({
        ...base(project),
        currency: project.currency,
        reportId: report.id,
        reportLabel: report.label,
        budget: budget!.at(-1)?.value ?? totals.budget,
        forecast: latest?.value ?? totals.anticipatedCost,
        over: totals.anticipatedVariance,
        ...(latest && before && latest.value !== null && before.value !== null ? { movement: Math.round((latest.value - before.value) * 100) / 100, previousLabel: before.period.label } : {}),
        overBudget: figure(overBudget),
      });
      decisions.push(...overBudget);
      // A contingency, a fee or an allowance awaits no award: only work to be let waits on the owner.
      for (const pack of asks.unawarded.filter((held) => !packageAwaitsNoAward(held.name))) {
        decisions.push({ ...base(project), title: `Not awarded: ${pack.code ? `${pack.code} ` : ''}${pack.name}`, detail: `Budget ${money(pack.budget)}, no PO issued`, source, ...BUDGET_PLACE });
      }
    } else if (costReportsOf(project).length || costRegister(project).workPackages.length) {
      const drafts = costReportsOf(project).length;
      notIssued.push({
        ...base(project),
        title: 'No Cost Report issued',
        detail: drafts ? `${plural(drafts, 'draft', 'drafts')}, and a draft's figures are not counted` : 'Work packages on the register, no report started',
        source: 'the Cost Reports on the project',
        ...BUDGET_PLACE,
      });
    }

    /* ---- Schedule ---- */
    const watch = scheduleWatch(project, now);
    if (watch.milestones.length) {
      const warned = watch.milestones
        .filter((m) => m.level)
        .map((m) => ({
          ...base(project),
          title: `${LEVEL_SAID[m.level!]}: ${m.name}`,
          detail: m.say,
          ...(m.plannedFinish ? { when: m.plannedFinish } : {}),
          ...(m.level === 'late' ? { overdue: true } : {}),
          source: 'the milestone on the progress board',
          ...PROGRESS_PLACE,
        }));
      // Planned against made, month by month, as any figure kept by period is read.
      // The months that have begun: the plan runs on past today, and what is not yet due to be made is no line here.
      const [planned, made] = ACROSS_SCHEDULE_SERIES.map((address) => periodSeries(project, address, now).filter((point) => point.period.from <= today).slice(-ACROSS_SERIES_MOST));
      const curve = (made ?? []).map((point) => ({ key: point.period.key, label: point.period.label, planned: planned?.find((held) => held.period.key === point.period.key)?.value ?? null, actual: point.value }));
      const latest = [...curve].reverse().find((point) => point.actual !== null);
      scheduleLines.push({
        ...base(project),
        ...(curve.length ? { curve } : {}),
        ...(latest ? { curveSaid: `${latest.label}: ${latest.actual}% made${latest.planned !== null ? ` against ${latest.planned}% planned` : ''}` } : {}),
        milestones: watch.milestones.length,
        ...(watch.plannedCompletion ? { plannedCompletion: watch.plannedCompletion } : {}),
        ...(watch.projectedCompletion ? { projectedCompletion: watch.projectedCompletion } : {}),
        ...(watch.projectedDaysLate ? { projectedDaysLate: watch.projectedDaysLate } : {}),
        extensionLikely: watch.extensionLikely,
        warned: figure(warned),
      });
      if (watch.extensionLikely) {
        const row: AnalyticsRow = {
          ...base(project),
          title: 'Extension of time likely',
          detail: watch.say,
          ...(watch.plannedCompletion ? { when: watch.plannedCompletion } : {}),
          source: `the schedule: ${plural(watch.milestones.length, 'milestone', 'milestones')} on the progress board`,
          ...PROGRESS_PLACE,
        };
        extensions.push(row);
        decisions.push(row);
      }
    }

    /* ---- Units sold ---- */
    const sold = periodSeries(project, ACROSS_SOLD_SERIES, now, undefined, ACROSS_SERIES_MOST);
    // Only where the week's stock has been issued at least once: a count with no past is no series.
    if (sold.some((point) => point.status === 'issued')) {
      const [last, before] = [sold.at(-1)!, sold.at(-2)];
      salesLines.push({
        ...base(project),
        points: sold.map((point) => ({ key: point.period.key, label: point.period.label, value: point.value, open: point.status === 'open' })),
        sold: last.value,
        ...(before && last.value !== null && before.value !== null ? { movement: last.value - before.value, previousLabel: before.period.label } : {}),
      });
    }

    /* ---- Papers owed ---- */
    for (const party of checklistOwed(project, { now: iso }).parties) {
      for (const line of party.lines) {
        const desk = menuDepartment(line.item.department);
        owes(party.owedBy, {
          ...base(project),
          title: line.item.title,
          detail: line.status === 'requested' ? `Asked for${line.dueAt ? `, due ${meetingDay(line.dueAt)}` : ''}` : 'Not asked for yet',
          ...(line.dueAt ? { when: line.dueAt } : {}),
          ...(line.overdue ? { overdue: true } : {}),
          source: `Papers owed, ${DEPARTMENT_SHORT[desk]}`,
          // The line, open on its department's Documents.
          ...papersOwedOpen(line.item.department, `l:${line.item.id}`),
        });
      }
    }
    for (const group of requirementSheet(project, { now: iso }).groups) {
      for (const item of group.items) {
        if (item.status === 'received') continue;
        owes(item.askedOf, {
          ...base(project),
          title: item.title,
          detail: item.status === 'requested' ? `Asked for${item.dueAt ? `, due ${meetingDay(item.dueAt)}` : ''}` : 'Not asked for yet',
          ...(item.dueAt ? { when: item.dueAt } : {}),
          ...(item.overdue ? { overdue: true } : {}),
          source: `${group.label}: ${plural(item.checks.length, 'check expects', 'checks expect')} it`,
          pane: 'evidence',
          ...(item.evidenceId ? { extra: { evidenceId: item.evidenceId } } : {}),
        });
      }
    }

    /* ---- Alerts ---- */
    for (const alert of openAlerts(project)) {
      const kind = alert.key.split(':')[0] || 'other';
      const held = alertKinds.get(kind) ?? { rows: [], critical: 0, worst: 9 };
      alertKinds.set(kind, held);
      held.worst = Math.min(held.worst, ALERT_SEVERITY_ORDER[alert.severity] ?? 2);
      if (alert.severity === 'critical') held.critical += 1;
      openAlertCount += 1;
      held.rows.push({
        ...base(project),
        title: alert.title,
        detail: alert.detail,
        when: alert.raisedAt.slice(0, 10),
        ageDays: daysBetween(alert.raisedAt, at),
        source: `an alert raised ${meetingDay(alert.raisedAt)} in ${DEPARTMENT_SHORT[menuDepartment(alert.department)] ?? alert.department}`,
        ...(alert.workstream ? { pane: 'workstream' as const, extra: { workstream: alert.workstream } } : { pane: 'department' as const, extra: { department: menuDepartment(alert.department) } }),
      });
    }

    /* ---- Decisions not yet made ---- */
    for (const decision of project.decisions ?? []) {
      if (decision.status !== 'pending') continue;
      decisions.push({
        ...base(project),
        title: `To be decided: ${decision.title}`,
        ...(decision.decisionMaker ? { detail: `For ${decision.decisionMaker}` } : {}),
        when: decision.createdAt.slice(0, 10),
        ageDays: daysBetween(decision.createdAt, at),
        source: `the decision register, raised ${meetingDay(decision.createdAt)}`,
        pane: 'decisions',
        extra: { item: decision.id },
      });
    }
  }

  const currencies = [...new Set(costLines.map((line) => line.currency))];
  const totals: AcrossCostTotal[] = currencies.map((currency) => {
    const lines = costLines.filter((line) => line.currency === currency);
    const moved = lines.filter((line) => line.movement !== undefined);
    return {
      currency,
      projects: lines.length,
      budget: sum(lines.map((line) => line.budget)),
      forecast: sum(lines.map((line) => line.forecast)),
      over: sum(lines.map((line) => line.over)),
      movement: sum(moved.map((line) => line.movement!)),
      compared: moved.length,
    };
  });

  return {
    generatedAt: iso,
    today,
    projects: projects.length,
    cost: {
      lines: costLines.sort((a, b) => b.over - a.over || a.projectName.localeCompare(b.projectName)),
      totals,
      notIssued: figure(notIssued),
    },
    schedule: {
      lines: scheduleLines.sort((a, b) => Number(b.extensionLikely) - Number(a.extensionLikely) || (b.projectedDaysLate ?? 0) - (a.projectedDaysLate ?? 0) || a.projectName.localeCompare(b.projectName)),
      extensions: figure(extensions),
    },
    sales: { lines: salesLines.sort((a, b) => a.projectName.localeCompare(b.projectName)) },
    papers: {
      owed,
      parties: [...parties.values()]
        .map((held) => ({
          ...(held.party ? { party: held.party } : {}),
          projects: new Set(held.rows.map((row) => row.projectId)).size,
          overdue: held.rows.filter((row) => row.overdue).length,
          papers: figure(held.rows.sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || a.projectName.localeCompare(b.projectName))),
        }))
        .sort((a, b) => Number(!a.party) - Number(!b.party) || b.papers.count - a.papers.count || (a.party ?? '').localeCompare(b.party ?? '')),
    },
    alerts: {
      open: openAlertCount,
      kinds: [...alertKinds]
        .sort((a, b) => a[1].worst - b[1].worst || b[1].rows.length - a[1].rows.length || a[0].localeCompare(b[0]))
        .map(([kind, held]) => ({
          kind,
          label: ALERT_KIND_LABEL[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1).replace(/_/g, ' ')}`,
          critical: held.critical,
          alerts: figure(held.rows),
        })),
    },
    decisions: figure(decisions),
  };
}

/* ==================================================================== */
/* By department, within a project                                       */
/* ==================================================================== */

export interface DepartmentFigures {
  /** Absent on the last line, which holds what no department holds. */
  department?: DepartmentKey;
  label: string;
  /** Decisions waiting for a person to accept or set aside: values read off papers, and cards. */
  waiting: AnalyticsFigure;
  /** Whole days the oldest of them has waited. */
  waitingOldestDays: number;
  actionsOpen: AnalyticsFigure;
  actionsOverdue: AnalyticsFigure;
  /** Requests sent and not answered. */
  requestsOut: AnalyticsFigure;
  requestsOverdue: number;
  requestsOldestDays: number;
}

export interface DepartmentAnalytics {
  generatedAt: string;
  projectId: string;
  projectName: string;
  departments: DepartmentFigures[];
}

/** The day a paper's values began to wait: when its last file was put on it. */
function filedAt(evidence: EvidenceRecord, before?: string): string {
  const uploads = evidence.attachments.map((file) => file.uploadedAt).filter((day) => !before || day <= before);
  return uploads.sort().at(-1) ?? evidence.createdAt;
}

/**
 * One project's departments: what waits for acceptance and for how long, the
 * actions open and overdue, and the requests out and their age.
 *
 * A value waiting on a paper belongs to the department that holds the paper,
 * and a card to the department its check sits in. An action belongs to the
 * department of the check or paper it is tied to, else to where the meeting
 * it came from was kept. A request belongs to the desk whose checklist it
 * was raised from, else to the department that holds the paper it asks for.
 * Whatever no department holds is on a last line of its own, and is given to
 * none.
 */
export function departmentAnalytics(project: DdProject, now: Date): DepartmentAnalytics {
  const iso = now.toISOString();
  const today = indiaToday(now);
  const at = now.getTime();
  const menu = menuDepartmentsOf(projectDepartments(project));
  type Bucket = { waiting: AnalyticsRow[]; waitingCount: number; actions: AnalyticsRow[]; requests: AnalyticsRow[] };
  const buckets = new Map<DepartmentKey | undefined, Bucket>();
  const bucket = (department: DepartmentKey | undefined): Bucket => {
    const key = department && menu.includes(department) ? department : undefined;
    const held = buckets.get(key) ?? { waiting: [], waitingCount: 0, actions: [], requests: [] };
    buckets.set(key, held);
    return held;
  };

  /* ---- Waiting for acceptance ---- */
  const cards = new Map((project.chatProposals ?? []).map((card) => [card.id, card]));
  const papers = new Map(project.evidence.map((row) => [row.id, row]));
  for (const entry of waitingOnCanvas(project).entries) {
    const paper = entry.kind === 'facts' && entry.evidenceId ? papers.get(entry.evidenceId) : undefined;
    const card = entry.proposalId ? cards.get(entry.proposalId) : undefined;
    const since = paper ? filedAt(paper) : card?.createdAt;
    const held = bucket(entry.fn ? functionDepartment(entry.fn) : undefined);
    held.waitingCount += entry.count;
    held.waiting.push({
      ...base(project),
      title: entry.title,
      detail: paper ? `${plural(entry.count, 'value', 'values')} read off the paper` : entry.count > 1 ? `${entry.count} values on a card` : 'A card',
      ...(since ? { when: since.slice(0, 10), ageDays: daysBetween(since, at) } : {}),
      source: paper ? `the paper, filed ${meetingDay(since ?? paper.createdAt)}` : `a card raised ${meetingDay(since ?? iso)}`,
      pane: entry.pane,
      ...(entry.extra ? { extra: entry.extra } : {}),
    });
  }

  /* ---- Actions ---- */
  const checks = new Map(allChecks(project).map((check) => [check.id, check]));
  for (const action of project.actions) {
    if (action.status === 'closed') continue;
    const check = action.checkIds.map((id) => checks.get(id)).find(Boolean);
    const paper = action.evidenceIds.map((id) => papers.get(id)).find(Boolean);
    const from = meetingOfRecord(project, action.id)?.meeting;
    const workstream = (check ? workstreamOfCheck(check.definitionId) : undefined) ?? (paper ? documentWorkstream(project, paper) : undefined) ?? from?.place?.fn;
    const department = (workstream ? functionDepartment(workstream) : undefined) ?? (from?.place?.department as DepartmentKey | undefined);
    const due = action.dueDate?.slice(0, 10);
    // By the day asked about, never by the stamp: an action is marked overdue by the clock of whichever day it was last touched, and a
    // figure asked for as at a day has to come out the same whenever it is worked out.
    const overdue = Boolean(due && due < today);
    bucket(department).actions.push({
      ...base(project),
      title: action.title,
      detail: action.owner ? `On ${action.owner}` : 'Nobody named',
      ...(due ? { when: due } : {}),
      ageDays: daysBetween(action.createdAt, at),
      ...(overdue ? { overdue: true } : {}),
      source: `the action register, raised ${meetingDay(action.createdAt)}`,
      pane: 'actions',
      extra: { actionId: action.id },
    });
  }

  /* ---- Requests out ---- */
  const lines = new Map((project.checklist ?? []).map((item) => [item.id, item]));
  for (const request of project.requests ?? []) {
    if (request.status !== 'sent') continue;
    const line = (request.checklistItemIds ?? []).map((id) => lines.get(id)).find(Boolean);
    const paper = request.evidenceId ? papers.get(request.evidenceId) : undefined;
    const fn = paper ? functionOfDocument(project, paper) : undefined;
    const department = line ? menuDepartment(line.department) : fn ? functionDepartment(fn) : undefined;
    bucket(department).requests.push({
      ...base(project),
      title: request.title,
      detail: `Asked of ${request.recipient}${request.dueAt ? `, due ${meetingDay(request.dueAt)}` : ''}`,
      ...(request.dueAt ? { when: request.dueAt.slice(0, 10) } : {}),
      ageDays: requestAgeDays(request, iso),
      ...(request.dueAt && request.dueAt.slice(0, 10) < today ? { overdue: true } : {}),
      source: `a request sent ${meetingDay(request.sentAt ?? request.createdAt)}`,
      pane: department ? 'department' : 'overview',
      ...(department ? { extra: { department } } : {}),
    });
  }

  const oldest = (rows: readonly AnalyticsRow[]): number => rows.reduce((most, row) => Math.max(most, row.ageDays ?? 0), 0);
  const byAge = (a: AnalyticsRow, b: AnalyticsRow): number => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || (b.ageDays ?? 0) - (a.ageDays ?? 0);
  const said = (department: DepartmentKey | undefined): DepartmentFigures => {
    const held = buckets.get(department) ?? { waiting: [], waitingCount: 0, actions: [], requests: [] };
    return {
      ...(department ? { department } : {}),
      label: department ? DEPARTMENT_SHORT[department] : 'No department',
      waiting: figure(held.waiting.sort(byAge), held.waitingCount),
      waitingOldestDays: oldest(held.waiting),
      actionsOpen: figure(held.actions.sort(byAge)),
      actionsOverdue: figure(held.actions.filter((row) => row.overdue)),
      requestsOut: figure(held.requests.sort(byAge)),
      requestsOverdue: held.requests.filter((row) => row.overdue).length,
      requestsOldestDays: oldest(held.requests),
    };
  };

  return {
    generatedAt: iso,
    projectId: project.id,
    projectName: project.name,
    departments: [...menu.map((department) => said(department)), ...(buckets.has(undefined) ? [said(undefined)] : [])],
  };
}

/* ==================================================================== */
/* By person                                                             */
/* ==================================================================== */

export interface PersonFigures {
  email: string;
  name?: string;
  /** How many projects these figures are read from: the ones the reader may read this person's work on. */
  projects: number;
  /** Open work with their name on it. */
  on: AnalyticsFigure;
  overdue: AnalyticsFigure;
  /** What they accepted in the last `ANALYTICS_WINDOW_DAYS` days. */
  accepted: AnalyticsFigure;
  /** The things they dealt with in the window, each with the whole days it had waited (`ageDays`). */
  waited: AnalyticsFigure;
  /** The median of those days. Absent when they dealt with nothing in the window. */
  medianWaitDays?: number;
}

/** The audit lines that are a person accepting what was proposed. */
const ACCEPTED_ACTIONS: ReadonlySet<string> = new Set(['accept_proposal', 'accept_fact', 'accept_fact_corrected', 'accept_value_inputs']);

function workPlace(item: WorkItem): Pick<AnalyticsRow, 'pane' | 'extra'> {
  if (item.kind === 'check') return { pane: 'scope', extra: { ddId: item.ddId, scopeId: item.scopeId, checkId: item.id } };
  if (item.kind === 'scope') return { pane: 'scope', extra: { ddId: item.ddId, scopeId: item.scopeId } };
  if (item.kind === 'assessment') return { pane: 'dd', extra: { ddId: item.ddId } };
  if (item.kind === 'action') return { pane: 'actions', extra: { actionId: item.id } };
  if (item.kind === 'risk') return { pane: 'risks', extra: { riskId: item.id } };
  if (item.kind === 'finding') return { pane: 'findings', extra: { findingId: item.id } };
  return { pane: 'evidence', extra: { evidenceId: item.id } };
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether an instant is inside the window: from exactly `ANALYTICS_WINDOW_DAYS` days before `now`, up to `now`. */
export function inAnalyticsWindow(instant: string | undefined, now: Date): boolean {
  const at = Date.parse(instant ?? '');
  return Number.isFinite(at) && at <= now.getTime() && at >= now.getTime() - ANALYTICS_WINDOW_DAYS * DAY_MS;
}

/**
 * One person across the projects handed in.
 *
 * On them: the open work whose owner field names them, by the same three
 * exact matches My work uses (`ownedBy`). Accepted: the lines of the trail
 * where they accepted a card, a value read off a paper, or values offered to
 * the valuation, inside the window; the values accepted on one paper in one
 * go are one thing. What a thing waited: a card from the moment it was
 * raised to the moment they accepted it, a paper's values from when its file
 * was put on it, and an action on them that closed in the window from when
 * it was raised to when it closed.
 */
export function personAnalytics(projects: readonly DdProject[], person: WorkPerson, now: Date): PersonFigures {
  const iso = now.toISOString();
  const on: AnalyticsRow[] = [];
  const accepted: AnalyticsRow[] = [];
  const waited: AnalyticsRow[] = [];
  const is = (actor: string | undefined): boolean => Boolean(actor) && (sameEmail(actor!, person.email) || ownedBy(actor, person));

  for (const project of projects) {
    for (const item of sortWork(myWorkOn(project, person, iso))) {
      on.push({
        ...base(project),
        title: item.title,
        detail: WORK_KIND_LABEL[item.kind],
        ...(item.dueDate ? { when: item.dueDate.slice(0, 10) } : {}),
        ...(item.overdue ? { overdue: true } : {}),
        source: `the ${WORK_KIND_LABEL[item.kind].toLowerCase()}, whose owner reads “${item.owner}”`,
        ...workPlace(item),
      });
    }

    const cards = new Map((project.chatProposals ?? []).map((card) => [card.id, card]));
    const papers = new Map(project.evidence.map((row) => [row.id, row]));
    const onPaper = new Map<string, { paper?: EvidenceRecord; at: string; values: number }>();
    for (const event of project.audit ?? []) {
      if (!ACCEPTED_ACTIONS.has(event.action) || !is(event.actor) || !inAnalyticsWindow(event.at, now)) continue;
      if (event.action === 'accept_fact' || event.action === 'accept_fact_corrected') {
        const key = `${event.entityId}@${event.at}`;
        const held = onPaper.get(key) ?? { paper: papers.get(event.entityId), at: event.at, values: 0 };
        onPaper.set(key, held);
        held.values += 1;
        continue;
      }
      const card = event.action === 'accept_proposal' ? cards.get(event.entityId) : undefined;
      const row: AnalyticsRow = {
        ...base(project),
        title: card?.title ?? (event.action === 'accept_value_inputs' ? 'Values for the valuation' : (event.newValue ?? 'A card')),
        ...(card ? { detail: `Waited ${plural(daysBetween(card.createdAt, Date.parse(event.at)), 'day', 'days')}` } : {}),
        when: event.at.slice(0, 10),
        source: `the trail: accepted ${meetingDay(event.at)}`,
        pane: event.action === 'accept_value_inputs' ? 'valuation' : 'overview',
      };
      accepted.push(row);
      if (card) waited.push({ ...row, detail: `A card, raised ${meetingDay(card.createdAt)}`, ageDays: daysBetween(card.createdAt, Date.parse(event.at)) });
    }
    for (const held of onPaper.values()) {
      const days = held.paper ? daysBetween(filedAt(held.paper, held.at), Date.parse(held.at)) : undefined;
      const row: AnalyticsRow = {
        ...base(project),
        title: held.paper?.title ?? 'A paper no longer on file',
        detail: `${plural(held.values, 'value', 'values')} accepted${days === undefined ? '' : `, waited ${plural(days, 'day', 'days')}`}`,
        when: held.at.slice(0, 10),
        source: `the trail: accepted ${meetingDay(held.at)}`,
        pane: 'evidence',
        ...(held.paper ? { extra: { evidenceId: held.paper.id } } : {}),
      };
      accepted.push(row);
      if (held.paper && days !== undefined) waited.push({ ...row, detail: `${plural(held.values, 'value', 'values')} on a paper filed ${meetingDay(filedAt(held.paper, held.at))}`, ageDays: days });
    }

    for (const action of project.actions) {
      if (action.status !== 'closed' || !ownedBy(action.owner, person) || !inAnalyticsWindow(action.closedAt, now)) continue;
      waited.push({
        ...base(project),
        title: action.title,
        detail: `An action, raised ${meetingDay(action.createdAt)}`,
        when: action.closedAt!.slice(0, 10),
        ageDays: daysBetween(action.createdAt, Date.parse(action.closedAt!)),
        source: `the action register: closed ${meetingDay(action.closedAt!)}`,
        pane: 'actions',
        extra: { actionId: action.id },
      });
    }
  }

  const newest = (a: AnalyticsRow, b: AnalyticsRow): number => (b.when ?? '').localeCompare(a.when ?? '');
  accepted.sort(newest);
  waited.sort(newest);
  const middle = median(waited.map((row) => row.ageDays ?? 0));
  return {
    email: person.email,
    ...(person.name ? { name: person.name } : {}),
    projects: projects.length,
    on: figure(on),
    overdue: figure(on.filter((row) => row.overdue)),
    accepted: figure(accepted),
    waited: figure(waited),
    ...(middle === undefined ? {} : { medianWaitDays: middle }),
  };
}

export interface AnalyticsMember extends AnalyticsReader {
  name?: string;
}

/**
 * The people a reader may read figures about, each over the projects the
 * reader may read them on (`readsPersonFigures`), in the order of their
 * names. A reader who leads nowhere gets themselves; a viewer and somebody
 * working from a grant get nobody.
 */
export function peopleAnalytics(projects: readonly DdProject[], members: readonly AnalyticsMember[], reader: AnalyticsReader, now: Date): PersonFigures[] {
  const out: PersonFigures[] = [];
  for (const member of members) {
    const readable = projects.filter((project) => readsPersonFigures(reader, member, project));
    // A person with no project to read still reads their own line, which is empty.
    const own = sameEmail(member.email, reader.email) && readsAnalytics(reader.role) && reader.role !== 'viewer' && readsAnalytics(member.role);
    if (!readable.length && !own) continue;
    out.push(personAnalytics(readable, { email: member.email, ...(member.name ? { name: member.name } : {}) }, now));
  }
  return out.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email) || a.email.localeCompare(b.email));
}
