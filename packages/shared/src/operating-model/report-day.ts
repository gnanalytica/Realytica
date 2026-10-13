/**
 * Reports on a set day, quarters, and an owner pack kept as it was issued.
 *
 * **The report day.** A project may name a day of the month on which its
 * reports are prepared without being asked: the status report, the owner
 * pack or both, every month or every quarter, and the people who are told.
 * The day is read in India time. In a month shorter than the day, the day is
 * the month's last: "the 31st" is 30 April and 28 or 29 February. On that
 * day the report for the period just ended is prepared: the month before, or
 * the quarter before when the day falls in the month after a quarter ends
 * (January, April, July, October). A day the timer missed is caught up by
 * its next run: the latest period whose day has come is prepared, where the
 * setting stood on that day and nothing was prepared for it. What is
 * prepared waits to be issued. A timer issues nothing and sends nothing to
 * an owner.
 *
 * **Quarters.** A quarter is three calendar months from the first of
 * January, April, July or October. The Indian financial year and the
 * calendar year cut the year at the same four days and number the quarters
 * differently: July to September is Q2 of FY 2026-27 and Q3 of 2026. The
 * financial year is the default (`QUARTER_YEAR_DEFAULT`); a project's setting
 * may say the calendar year. A period's two ends are moments in UTC, as a
 * month's are everywhere else on the record.
 *
 * **A kept owner pack.** The owner pack is made by code from the record
 * (`owner-pack.ts`). Kept, it is the pack as it read on the day it was
 * prepared, with the project's name and place as they stood. Issued by a
 * named person, it is frozen: it opens as issued whatever the record has
 * done since, under the period's name as it was numbered that day. Only an
 * issued one can be reopened, by a lead or a signer. Reopening leaves the
 * issued pack as it was sent and puts a copy of it beside it, waiting, to be
 * read again and issued in its turn: what an owner was sent is never
 * written over.
 */

import { roleCanDecide, roleCanEdit } from './departments';
import { periodsDue } from './field-periods';
import { meetingDay } from './meetings';
import { generateReport, recordAuditEvent } from './operations';
import { ownerPack, ownerPackTitle, type OwnerPack } from './owner-pack';
import { QUARTER_YEAR_DEFAULT, isQuarter, quarterHolding, quarterKey, quarterMonthsSaid, quarterOf, quarterSaid, type QuarterYear } from './quarters';
import { statusPeriodSaid, statusTitle, type StatusPeriod } from './status-report';
import { departmentRole, projectDepartments } from './team';
import { reachesEveryProject, sameEmail, type WorkspaceRole } from './tenancy';
import type { DdProject, GeneratedReport } from './types';

/* ==================================================================== */
/* A period in words                                                    */
/* ==================================================================== */

/** A report's period in words: a quarter by its number and its months, anything else as the status report says it. */
export function reportPeriodSaid(period: StatusPeriod, year: QuarterYear = QUARTER_YEAR_DEFAULT): string {
  const quarter = quarterSaid(period, year);
  return quarter ? `${quarter} (${quarterMonthsSaid(period)})` : statusPeriodSaid(period);
}

/** The last few quarters up to the one a moment falls in, newest first, each with its key and its name: what a picker offers. */
export function quartersBefore(at: Date, year: QuarterYear = QUARTER_YEAR_DEFAULT, count = 8): Array<{ key: string; label: string; period: StatusPeriod }> {
  return Array.from({ length: count }, (_, back) => quarterHolding(at, -back)).map((period) => ({ key: quarterKey(period, year)!, label: reportPeriodSaid(period, year), period }));
}

/* ==================================================================== */
/* The report day                                                        */
/* ==================================================================== */

/** A report the timer prepares. */
export type TimedReport = 'status' | 'owner_pack';
export const TIMED_REPORTS: readonly TimedReport[] = ['status', 'owner_pack'];
export const TIMED_REPORT_LABEL: Record<TimedReport, string> = { status: 'Status report', owner_pack: 'Owner pack' };

export type ReportEvery = 'month' | 'quarter';

export interface ReportDaySetting {
  /** The day of the month, 1 to 31, in India time. In a shorter month, its last day. */
  day: number;
  reports: TimedReport[];
  every: ReportEvery;
  /** The year quarters are numbered in. Absent: the financial year. */
  quarters?: QuarterYear;
  /** Who is told a report is ready to check: the firm's own people, by address. */
  tell: string[];
  setAt: string;
  setBy: string;
}

/** One report the timer prepared, kept so a second run prepares no second one and tells nobody twice. */
export interface PreparedReport {
  kind: TimedReport;
  from: string;
  to: string;
  /** The report among the project's reports, or the kept owner pack. */
  id: string;
  at: string;
  /** Who was told, once anybody was. */
  told?: string[];
  toldAt?: string;
}

/** What a project keeps of its report day. Absent on a project that never set one. */
export interface ReportDay {
  setting?: ReportDaySetting;
  prepared?: PreparedReport[];
}

export const REPORT_DAY_LIMITS = { tell: 12, kept: 60 } as const;

const INDIA_OFFSET_MS = 5.5 * 3_600_000;

/** The day it is in India at a moment. India keeps one time all year, five and a half hours ahead of UTC. */
export function indiaDay(now: Date): { year: number; month: number; date: number } {
  const there = new Date(now.getTime() + INDIA_OFFSET_MS);
  return { year: there.getUTCFullYear(), month: there.getUTCMonth(), date: there.getUTCDate() };
}

/** The day of a month a report day falls on: the day set, or the month's last where the month is shorter. */
export function reportDayIn(day: number, year: number, month: number): number {
  return Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
}

/**
 * The period to prepare a report for at a moment, or nothing when none is
 * due. Monthly: the month before the one it is in India. Quarterly: the
 * quarter before, and only in the month after a quarter ends.
 *
 * On the report day it is that day's period. After it, it is still that
 * period, so a day the timer missed is caught up by the next run: the latest
 * report day that has come is the one that counts, and only where the
 * setting stood on it (`setAt`). A day set since asks for nothing until its
 * next, and so does a setting that does not say when it was made.
 */
export function reportPeriodDue(setting: Pick<ReportDaySetting, 'day' | 'every'> & Partial<Pick<ReportDaySetting, 'setAt'>>, now: Date): StatusPeriod | undefined {
  const today = indiaDay(now);
  // The month of the latest report day that has come: this one from its day on, the one before until then.
  const come = today.date >= reportDayIn(setting.day, today.year, today.month);
  const due = new Date(Date.UTC(today.year, today.month - (come ? 0 : 1), 1));
  // Quarterly, that day falls only in the month after a quarter ends.
  if (setting.every === 'quarter') due.setUTCMonth(due.getUTCMonth() - (due.getUTCMonth() % 3));
  const [year, month] = [due.getUTCFullYear(), due.getUTCMonth()];
  const day = reportDayIn(setting.day, year, month);
  if (year !== today.year || month !== today.month || day !== today.date) {
    const set = setting.setAt ? indiaDay(new Date(setting.setAt)) : undefined;
    if (!set || Date.UTC(set.year, set.month, set.date) > Date.UTC(year, month, day)) return undefined;
  }
  if (setting.every === 'quarter') return quarterOf(year, month - 3);
  return { from: new Date(Date.UTC(year, month - 1, 1)).toISOString(), to: new Date(Date.UTC(year, month, 1)).toISOString() };
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** A setting in one line: "The 1st of each month · status report, owner pack · 2 told". */
export function reportDaySaid(setting: ReportDaySetting): string {
  const when = setting.every === 'quarter' ? `The ${ordinal(setting.day)} after each quarter` : `The ${ordinal(setting.day)} of each month`;
  const what = setting.reports.map((kind) => TIMED_REPORT_LABEL[kind].toLowerCase()).join(', ');
  return `${when} · ${what} · ${setting.tell.length} told`;
}

/** Set a project's report day, or clear it with nothing. The reports already prepared are kept either way. */
export function setReportDay(
  project: DdProject,
  input: { day: number; reports: readonly TimedReport[]; every: ReportEvery; quarters?: QuarterYear; tell: readonly string[] } | null,
  actor: string,
  at = new Date().toISOString(),
): ReportDaySetting | undefined {
  const held = project.reportDay ?? {};
  if (!input) {
    if (held.setting) recordAuditEvent(project, { actor, action: 'clear_report_day', entityType: 'project', entityId: project.id, oldValue: reportDaySaid(held.setting), at });
    project.reportDay = { ...(held.prepared ? { prepared: held.prepared } : {}) };
    return undefined;
  }
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) throw new Error('The day is a day of the month, 1 to 31.');
  const reports = TIMED_REPORTS.filter((kind) => input.reports.includes(kind));
  if (!reports.length) throw new Error('Choose the status report, the owner pack or both.');
  const tell = [...new Set(input.tell.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (tell.length > REPORT_DAY_LIMITS.tell) throw new Error(`At most ${REPORT_DAY_LIMITS.tell} people are told.`);
  const setting: ReportDaySetting = { day: input.day, reports, every: input.every, ...(input.quarters && input.quarters !== QUARTER_YEAR_DEFAULT ? { quarters: input.quarters } : {}), tell, setAt: at, setBy: actor };
  recordAuditEvent(project, { actor, action: 'set_report_day', entityType: 'project', entityId: project.id, ...(held.setting ? { oldValue: reportDaySaid(held.setting) } : {}), newValue: reportDaySaid(setting), at });
  project.reportDay = { ...held, setting };
  return setting;
}

/** The year a project numbers its quarters in. */
export function quarterYearOf(project: Pick<DdProject, 'reportDay'>): QuarterYear {
  return project.reportDay?.setting?.quarters ?? QUARTER_YEAR_DEFAULT;
}

/* ==================================================================== */
/* A kept owner pack                                                     */
/* ==================================================================== */

export interface KeptOwnerPack {
  id: string;
  title: string;
  /** Prepared and waiting to be issued, or issued and frozen. */
  status: 'prepared' | 'issued';
  /** The pack as it read on the day it was prepared. Never read from the record again once issued. */
  pack: OwnerPack;
  /** The project's name and place as they stood then: what the paper is headed with. */
  heading: { name: string; reference: string; place?: string };
  /** Its period in words as it was numbered then: a quarter keeps the number it was issued under, whatever the project numbers by since. Absent on a pack kept before this was. */
  periodSaid?: string;
  preparedAt: string;
  /** A person's address, or `system` for the timer. */
  preparedBy: string;
  issuedAt?: string;
  issuedBy?: string;
  /** The issuer as they sign, where they gave a name. */
  issuedName?: string;
}

/** The actor the trail and a kept report name for the timer. */
export const REPORT_DAY_ACTOR = 'system';

/** The kept owner packs, the latest period first and, within a period, the latest prepared first. */
export function ownerPacksKept(project: Pick<DdProject, 'ownerPacks'>): KeptOwnerPack[] {
  return [...(project.ownerPacks ?? [])].sort((a, b) => b.pack.period.from.localeCompare(a.pack.period.from) || b.preparedAt.localeCompare(a.preparedAt));
}

function keptPack(project: DdProject, packId: string): KeptOwnerPack {
  const kept = (project.ownerPacks ?? []).find((held) => held.id === packId);
  if (!kept) throw new Error('No owner pack by that id on this project.');
  return kept;
}

/** A pack is plain words and days, so its copy by way of text is the whole of it. */
const copyOf = (pack: OwnerPack): OwnerPack => JSON.parse(JSON.stringify(pack)) as OwnerPack;

const samePeriod = (a: StatusPeriod, b: StatusPeriod): boolean => a.from === b.from && a.to === b.to;

function packTitle(project: DdProject, period: StatusPeriod): string {
  return isQuarter(period) ? `Owner pack — ${project.name}, ${reportPeriodSaid(period, quarterYearOf(project))}` : ownerPackTitle(project, period);
}

function readInto(kept: KeptOwnerPack, project: DdProject, period: StatusPeriod, now: Date): void {
  // A copy with nothing shared with the record: the record moves, and this does not.
  kept.pack = copyOf(ownerPack(project, period, now));
  kept.title = packTitle(project, period);
  kept.periodSaid = isQuarter(period) ? reportPeriodSaid(period, quarterYearOf(project)) : kept.pack.periodSaid;
  const place = [project.location, project.city].filter(Boolean).join(', ');
  kept.heading = { name: project.name, reference: project.reference, ...(place ? { place } : {}) };
  kept.preparedAt = now.toISOString();
}

/**
 * Keep the owner pack for a period as it reads now, waiting to be issued.
 * One pack waits for a period at a time: asked for again, the one waiting is
 * read from the record again and no second is made. An issued pack is left
 * as it is, and a new one is kept beside it.
 */
export function keepOwnerPack(project: DdProject, period: StatusPeriod, actor: string, now = new Date()): KeptOwnerPack {
  const waiting = (project.ownerPacks ?? []).find((held) => held.status === 'prepared' && samePeriod(held.pack.period, period));
  if (waiting) return refreshOwnerPack(project, waiting.id, actor, now);
  if ((project.ownerPacks ?? []).length >= REPORT_DAY_LIMITS.kept) throw new Error(`A project keeps at most ${REPORT_DAY_LIMITS.kept} owner packs.`);
  const kept = { id: `opk_${Math.random().toString(36).slice(2, 10)}${now.getTime().toString(36)}`, status: 'prepared', preparedBy: actor } as KeptOwnerPack;
  readInto(kept, project, period, now);
  project.ownerPacks = [...(project.ownerPacks ?? []), kept];
  recordAuditEvent(project, { actor, action: 'prepare_owner_pack', entityType: 'owner_pack', entityId: kept.id, newValue: kept.title, at: now.toISOString() });
  return kept;
}

/** Read a waiting pack from the record again. An issued one is refused: it is what somebody was sent. */
export function refreshOwnerPack(project: DdProject, packId: string, actor: string, now = new Date()): KeptOwnerPack {
  const kept = keptPack(project, packId);
  if (kept.status === 'issued') throw new Error('This owner pack is issued. Reopen it before reading the record again, or keep a new one.');
  readInto(kept, project, kept.pack.period, now);
  kept.preparedBy = actor;
  recordAuditEvent(project, { actor, action: 'refresh_owner_pack', entityType: 'owner_pack', entityId: kept.id, newValue: kept.title, at: now.toISOString() });
  return kept;
}

/** Issue a kept pack under a person's name. From here it reads as it read at this moment. */
export function issueOwnerPack(project: DdProject, packId: string, issuer: { actor: string; name?: string }, at = new Date().toISOString()): KeptOwnerPack {
  const kept = keptPack(project, packId);
  if (kept.status === 'issued') throw new Error('This owner pack is already issued.');
  kept.status = 'issued';
  kept.issuedAt = at;
  kept.issuedBy = issuer.actor;
  if (issuer.name?.trim()) kept.issuedName = issuer.name.trim();
  kept.pack = copyOf(kept.pack);
  recordAuditEvent(project, { actor: issuer.actor, action: 'issue_owner_pack', entityType: 'owner_pack', entityId: kept.id, newValue: kept.title, at });
  return kept;
}

/**
 * Reopen an issued pack. The issued one stays as it was sent. A copy of it
 * is kept beside it, waiting, to be read again and issued in its turn; where
 * one already waits for the period, that is the one handed back and no
 * second is made. Returns the waiting pack.
 */
export function reopenOwnerPack(project: DdProject, packId: string, actor: string, at = new Date().toISOString()): KeptOwnerPack {
  const issued = keptPack(project, packId);
  if (issued.status !== 'issued') throw new Error('Only an issued owner pack can be reopened.');
  const waiting = (project.ownerPacks ?? []).find((held) => held.status === 'prepared' && samePeriod(held.pack.period, issued.pack.period));
  if (waiting) return waiting;
  if ((project.ownerPacks ?? []).length >= REPORT_DAY_LIMITS.kept) throw new Error(`A project keeps at most ${REPORT_DAY_LIMITS.kept} owner packs.`);
  const open: KeptOwnerPack = {
    id: `opk_${Math.random().toString(36).slice(2, 10)}${Date.parse(at).toString(36)}`,
    title: issued.title,
    status: 'prepared',
    pack: copyOf(issued.pack),
    heading: { ...issued.heading },
    ...(issued.periodSaid ? { periodSaid: issued.periodSaid } : {}),
    preparedAt: at,
    preparedBy: actor,
  };
  project.ownerPacks = [...(project.ownerPacks ?? []), open];
  recordAuditEvent(project, { actor, action: 'reopen_owner_pack', entityType: 'owner_pack', entityId: open.id, oldValue: issued.id, newValue: open.title, at });
  return open;
}

/** How a kept pack stands, in a line: "Prepared 1 Oct 2026, waiting to be issued" or "Issued 3 Oct 2026 by …". */
export function ownerPackStanding(project: Pick<DdProject, 'team'>, kept: KeptOwnerPack): string {
  const day = (iso: string): string => {
    const { year, month, date } = indiaDay(new Date(iso));
    return meetingDay(new Date(Date.UTC(year, month, date)).toISOString().slice(0, 10));
  };
  if (kept.status !== 'issued') return `Prepared ${day(kept.preparedAt)}, waiting to be issued`;
  const by = kept.issuedName ?? (project.team ?? []).find((member) => member.name && sameEmail(member.email, kept.issuedBy ?? ''))?.name ?? kept.issuedBy;
  return `Issued ${day(kept.issuedAt ?? kept.preparedAt)}${by ? ` by ${by}` : ''}`;
}

type Person = { email: string; role: WorkspaceRole };

const inSomeDepartment = (project: DdProject, person: Person, may: (role: ReturnType<typeof departmentRole>) => boolean): boolean =>
  reachesEveryProject(person.role) && projectDepartments(project).some((department) => may(departmentRole(project, { email: person.email, workspaceRole: person.role }, department)));

/** Keeping a pack and reading it again is for the firm's people who may edit in a department of the project. */
export function mayPrepareOwnerPack(project: DdProject, person: Person): boolean {
  return inSomeDepartment(project, person, roleCanEdit);
}

/** Issuing and reopening a pack, and setting the report day, are for a lead or a signer in a department of the project. */
export function mayIssueOwnerPack(project: DdProject, person: Person): boolean {
  return inSomeDepartment(project, person, roleCanDecide);
}

/* ==================================================================== */
/* What the timer prepares                                               */
/* ==================================================================== */

/** The reports the timer prepared that nobody has issued yet: a status report among the project's reports, or a kept owner pack. */
export function reportsWaiting(project: DdProject): PreparedReport[] {
  return (project.reportDay?.prepared ?? []).filter((line) =>
    line.kind === 'owner_pack' ? (project.ownerPacks ?? []).some((kept) => kept.id === line.id && kept.status === 'prepared') : project.reports.some((report) => report.id === line.id && (report.status === 'generated' || report.status === 'draft' || report.status === 'reviewed')),
  );
}

/** How a report among the project's reports stands where the timer prepared it and nobody has issued it. Nothing otherwise. */
export function preparedReportSaid(project: DdProject, report: Pick<GeneratedReport, 'id'>): string | undefined {
  return reportsWaiting(project).some((line) => line.kind === 'status' && line.id === report.id) ? 'Prepared, waiting to be issued' : undefined;
}

/**
 * Prepare what a project's report day asks for at a moment: nothing before
 * the day has come, and nothing a second time for a period. Returns what was
 * prepared just now. A status report is a draft among the project's reports
 * that reads the record until a person issues it; an owner pack is kept as
 * it reads now. Neither is issued.
 */
export function prepareReportsDue(project: DdProject, now = new Date()): PreparedReport[] {
  const setting = project.reportDay?.setting;
  const period = setting ? reportPeriodDue(setting, now) : undefined;
  if (!setting || !period) return [];
  const held = project.reportDay?.prepared ?? [];
  const fresh: PreparedReport[] = [];
  for (const kind of setting.reports) {
    if (held.some((line) => line.kind === kind && samePeriod(line, period))) continue;
    let id: string;
    if (kind === 'owner_pack') {
      // A pack a person already keeps for the period is the one to check: issued or waiting, no second is made.
      const kept = (project.ownerPacks ?? []).find((pack) => samePeriod(pack.pack.period, period));
      id = (kept ?? keepOwnerPack(project, period, REPORT_DAY_ACTOR, now)).id;
    } else {
      const report = generateReport(project, { kind: 'status', period, generatedBy: REPORT_DAY_ACTOR }, REPORT_DAY_ACTOR);
      if (isQuarter(period)) report.title = `${statusTitle(project, period).split(' — ')[0]} — ${project.name}, ${reportPeriodSaid(period, setting.quarters)}`;
      id = report.id;
    }
    fresh.push({ kind, from: period.from, to: period.to, id, at: now.toISOString() });
  }
  if (fresh.length) project.reportDay = { ...project.reportDay, prepared: [...held, ...fresh].slice(-REPORT_DAY_LIMITS.kept * 2) };
  return fresh;
}

/** Note who was told of the reports just prepared. Where nobody was, nothing is noted: a later run tells them. */
export function noteReportsTold(project: DdProject, lines: readonly PreparedReport[], told: readonly string[], at = new Date().toISOString()): void {
  if (!told.length) return;
  for (const line of project.reportDay?.prepared ?? []) {
    if (!lines.some((fresh) => fresh.kind === line.kind && fresh.id === line.id && samePeriod(fresh, line))) continue;
    line.told = [...told];
    line.toldAt = at;
  }
}

/** The periods a project's sets are behind on, each as one line: the set, the period, how full it is and when it is or was due. */
export function periodsDueSaid(project: DdProject, now = new Date()): string[] {
  return periodsDue(project, now).map((due) => `${due.title}, ${due.said}`);
}

/**
 * What the people named are told of reports just prepared: a subject and a few lines, naming the reports and saying
 * they wait for a person. Below them, the periods the project's sets are behind on, so the same notice says what is
 * to close before the reports are read.
 */
export function reportsReadySaid(project: DdProject, lines: readonly PreparedReport[], now = new Date()): { subject: string; text: string } {
  const names = lines.map((line) => {
    const period = { from: line.from, to: line.to };
    return `${TIMED_REPORT_LABEL[line.kind]}, ${reportPeriodSaid(period, quarterYearOf(project))}`;
  });
  const due = periodsDueSaid(project, now);
  return {
    subject: `${project.name}: ${names.length === 1 ? 'a report is' : `${names.length} reports are`} ready to check`,
    text: [
      `Prepared on the report day for ${project.name} (${project.reference}):`,
      ...names.map((name) => `- ${name}`),
      'Nothing has been issued or sent to anybody outside the firm. Each waits on the Reports page for a person to read and issue it.',
      ...(due.length ? ['', `${due.length === 1 ? 'One period is' : `${due.length} periods are`} not issued yet:`, ...due.map((line) => `- ${line}`)] : []),
    ].join('\n'),
  };
}
