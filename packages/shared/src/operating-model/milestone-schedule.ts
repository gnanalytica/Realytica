/**
 * Construction › Progress: the schedule the milestones are held to, and what
 * it says before a date is missed.
 *
 * A project lead keeps the schedule somewhere else, in a spreadsheet or a
 * planning tool, so it is brought in as a table: pasted, or a CSV or Excel
 * file. Bringing it in again updates the milestones it names and leaves what
 * site has reported alone.
 *
 * The warnings are rules over dates and the progress recorded, with the day
 * passed in. A projected finish is a straight line through the readings so
 * far, so it is worded as "at the current rate" and never as a date the work
 * will finish on.
 */

import type { DdProject } from './types';
import { recordAuditEvent } from './operations';
import { standingRecords, standingText } from './standing-records';
import { addMilestones, milestoneExtensions, plannedFinishAfterExtensions, setMilestonePercent, type Milestone, type MilestoneExtensions } from './progress';

/** A milestone is looked at this many days before its planned finish. */
export const DUE_SOON_DAYS = 14;
/** With no planned start to draw a line from, a milestone this close to its date is behind under this percent. */
export const DUE_SOON_FLOOR_PERCENT = 80;
/** A rate needs readings on at least this many days. */
export const PROJECTION_MIN_READINGS = 2;
/** The most rows one schedule may bring in. */
export const SCHEDULE_IMPORT_MAX_ROWS = 300;

/* ==================================================================== */
/* Days                                                                   */
/* ==================================================================== */

const DAY_MS = 86_400_000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function dayNumber(day: string): number {
  return Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS);
}

function dayOf(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

const daysFrom = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

/** A date that is all numbers with the year last: which of the first two is the day, the date alone does not say. */
const NUMBERS_YEAR_LAST = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/;

/**
 * A date as schedules here write it, as YYYY-MM-DD: 2026-10-12, 12-10-2026,
 * 12/10/26, 12.10.2026, 12 Oct 2026, 12-Oct-26. Where a date is all numbers
 * and the year is last, the day comes before the month, unless the sheet is
 * known to write the month first. Nothing when it is not a day on the
 * calendar.
 */
export function readScheduleDay(raw: string, monthFirst = false): string | undefined {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  let found: RegExpExecArray | null;
  if ((found = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(text))) {
    [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  } else if ((found = NUMBERS_YEAR_LAST.exec(text))) {
    [day, month, year] = [Number(found[monthFirst ? 2 : 1]), Number(found[monthFirst ? 1 : 2]), Number(found[3])];
  } else if ((found = /^(\d{1,2})[-/. ]\s*([A-Za-z]{3,9})\.?,?[-/. ]\s*(\d{4}|\d{2})$/.exec(text))) {
    const name = found[2]!.toLowerCase();
    month = MONTHS.findIndex((m) => m.startsWith(name)) + 1;
    [day, year] = [Number(found[1]), Number(found[3])];
  } else {
    return undefined;
  }
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || year < 1990 || year > 2100) return undefined;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return undefined;
  return at.toISOString().slice(0, 10);
}

/* ==================================================================== */
/* Bringing a schedule in                                                 */
/* ==================================================================== */

export interface ScheduleImportRow {
  name: string;
  plannedStart?: string;
  plannedFinish: string;
  weight?: number;
  /** 0..100. Taken for a milestone the project does not have yet, and for one it has when it is more than is recorded. */
  percent?: number;
}

/** A row of the sheet that was not brought in, and why. */
export interface ScheduleSkippedRow {
  /** Its line in the sheet, the header being line 1. */
  line: number;
  name: string;
  reason: string;
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const headerKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

const NAME_COLUMNS = ['activity', 'activityname', 'milestone', 'milestonename', 'task', 'taskname', 'name', 'description', 'item', 'work'];
const START_COLUMNS = ['plannedstart', 'start', 'startdate', 'plannedstartdate', 'baselinestart', 'from'];
const FINISH_COLUMNS = ['plannedfinish', 'finish', 'finishdate', 'plannedfinishdate', 'plannedend', 'end', 'enddate', 'plannedcompletion', 'completion', 'completiondate', 'due', 'duedate', 'target', 'targetdate', 'baselinefinish', 'to'];
const WEIGHT_COLUMNS = ['weight', 'weightage', 'weighting', 'share'];
const PERCENT_COLUMNS = ['percentcomplete', 'complete', 'completed', 'percent', 'progress', 'actual', 'actualprogress', 'done', 'percentdone'];

/**
 * Whether a column of dates writes the month first. It does when some date
 * in it can be read no other way, 10/25/2026, and none can only be read day
 * first, 25/10/2026. A sheet is written one way throughout, so the whole
 * column is then read month first: 10/12/2026 in it is 12 October.
 */
function monthFirstColumn(cells: readonly string[]): boolean {
  const parts = cells.map((cell) => NUMBERS_YEAR_LAST.exec(cell.trim())).filter((found): found is RegExpExecArray => Boolean(found));
  return parts.some((found) => Number(found[2]) > 12) && !parts.some((found) => Number(found[1]) > 12);
}

/**
 * Read a schedule from a table: a header row, then a row a milestone, with
 * tabs or commas between the cells and the columns in any order. A row with
 * no finish date that can be read is handed back with the reason, never left
 * out without a word. `notes` says what was assumed in reading it.
 */
export function parseScheduleTable(text: string): { rows: ScheduleImportRow[]; skipped: ScheduleSkippedRow[]; notes: string[] } {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) throw new Error('A schedule needs a header row and at least one row under it.');
  if (lines.length - 1 > SCHEDULE_IMPORT_MAX_ROWS) throw new Error(`A schedule can bring in ${SCHEDULE_IMPORT_MAX_ROWS} rows at most.`);
  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  const header = splitLine(lines[0]!, delimiter).map(headerKey);
  const column = (names: readonly string[]): number => {
    for (const name of names) {
      const at = header.indexOf(name);
      if (at >= 0) return at;
    }
    return -1;
  };
  const iName = column(NAME_COLUMNS);
  const iStart = column(START_COLUMNS);
  const iFinish = column(FINISH_COLUMNS);
  const iWeight = column(WEIGHT_COLUMNS);
  const iPercent = column(PERCENT_COLUMNS);
  if (iName < 0) throw new Error('The schedule needs an Activity or Milestone column.');
  if (iFinish < 0) throw new Error('The schedule needs a Planned finish column.');

  const table = lines.slice(1).map((line) => splitLine(line, delimiter));
  const number = (raw: string): number => Number(raw.replace(/[%,\s]/g, ''));
  // Excel hands a percentage over as a fraction: a column that never passes 1 and has a value between 0 and 1 is one.
  // A column of 0 and 1 alone is not: 1 there is one percent, as it is written.
  const percents = iPercent >= 0 ? table.map((cells) => cells[iPercent] ?? '') : [];
  const fractions = percents.every((cell) => !cell.includes('%') && !(number(cell) > 1)) && percents.some((cell) => cell !== '' && number(cell) > 0 && number(cell) < 1);
  const startMonthFirst = iStart >= 0 && monthFirstColumn(table.map((cells) => cells[iStart] ?? ''));
  const finishMonthFirst = monthFirstColumn(table.map((cells) => cells[iFinish] ?? ''));
  const notes = [
    ...(startMonthFirst ? ['The planned start dates were read with the month first, as 10/25/2026 is written.'] : []),
    ...(finishMonthFirst ? ['The planned finish dates were read with the month first, as 10/25/2026 is written.'] : []),
  ];

  const rows: ScheduleImportRow[] = [];
  const skipped: ScheduleSkippedRow[] = [];
  const seen = new Set<string>();
  table.forEach((cells, at) => {
    const line = at + 2;
    const name = (cells[iName] ?? '').trim().slice(0, 120);
    const skip = (reason: string) => skipped.push({ line, name, reason });
    if (!name) {
      if (cells.some((cell) => cell)) skip('No name.');
      return;
    }
    const finishText = cells[iFinish] ?? '';
    const plannedFinish = readScheduleDay(finishText, finishMonthFirst);
    if (!plannedFinish) return void skip(finishText ? `“${finishText}” is not a date.` : 'No planned finish.');
    const startText = iStart >= 0 ? (cells[iStart] ?? '') : '';
    const plannedStart = startText ? readScheduleDay(startText, startMonthFirst) : undefined;
    if (startText && !plannedStart) return void skip(`“${startText}” is not a date.`);
    if (plannedStart && plannedStart > plannedFinish) return void skip('Planned start is after planned finish.');
    const weightText = iWeight >= 0 ? (cells[iWeight] ?? '') : '';
    const weight = weightText ? number(weightText) : undefined;
    if (weight !== undefined && !(weight > 0 && weight <= 1000)) return void skip(`“${weightText}” is not a weight.`);
    const percentText = iPercent >= 0 ? (cells[iPercent] ?? '') : '';
    const percent = percentText ? number(percentText) * (fractions ? 100 : 1) : undefined;
    if (percent !== undefined && !(percent >= 0 && percent <= 100)) return void skip(`“${percentText}” is not a percentage.`);
    const key = milestoneKey(name);
    if (seen.has(key)) return void skip('Same name as a row above.');
    seen.add(key);
    rows.push({ name, ...(plannedStart ? { plannedStart } : {}), plannedFinish, ...(weight !== undefined ? { weight } : {}), ...(percent !== undefined ? { percent: Math.round(percent) } : {}) });
  });
  return { rows, skipped, notes };
}

/** A milestone's name as two schedules would both write it: letters and digits, in lower case. */
function milestoneKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Move a milestone's planned dates. The finish it was first given is kept as
 * its baseline, so a later re-plan shows how far the date has moved.
 */
export function replanMilestone(milestone: Milestone, dates: { plannedStart?: string; plannedFinish?: string }): boolean {
  let moved = false;
  if (dates.plannedFinish && dates.plannedFinish !== milestone.plannedFinish) {
    milestone.baselineFinish ??= milestone.plannedFinish ?? dates.plannedFinish;
    milestone.plannedFinish = dates.plannedFinish;
    moved = true;
  }
  if (dates.plannedStart && dates.plannedStart !== milestone.plannedStart) {
    milestone.plannedStart = dates.plannedStart;
    moved = true;
  }
  return moved;
}

/**
 * A milestone the schedule brings in complete was not finished on the day of
 * the import. Its done date is the finish the schedule gives it, where that
 * day has come. A finish still ahead cannot be the day it was done, so the
 * day of the import stands: it was complete by then.
 */
function completedPerSchedule(milestone: Milestone, row: ScheduleImportRow, at: string): void {
  if (row.percent !== 100 || milestone.percent !== 100 || milestone.completedOn !== at.slice(0, 10)) return;
  const finish = (row.plannedFinish ?? milestone.plannedFinish)?.slice(0, 10);
  if (finish && finish < at.slice(0, 10)) milestone.completedOn = finish;
}

/**
 * Put a schedule's rows on the project. A row whose name a milestone already
 * has, however it is spaced or cased, moves that milestone's dates and weight.
 * Its recorded progress is never lowered: a percent higher than the one
 * recorded is taken as a reading of the day of the import, and a lower one
 * is left out. Any other row is a new milestone.
 */
export function importSchedule(project: DdProject, rows: readonly ScheduleImportRow[], actor: string, at = new Date().toISOString()): { added: number; updated: number; unchanged: number } {
  const held = new Map((project.milestones ?? []).map((m) => [milestoneKey(m.name), m] as const));
  const fresh: ScheduleImportRow[] = [];
  let updated = 0;
  let unchanged = 0;
  for (const row of rows) {
    const milestone = held.get(milestoneKey(row.name));
    if (!milestone) {
      fresh.push(row);
      continue;
    }
    let moved = replanMilestone(milestone, row);
    if (row.weight !== undefined && row.weight !== milestone.weight) {
      milestone.weight = row.weight;
      moved = true;
    }
    if (row.percent !== undefined && row.percent > milestone.percent) {
      setMilestonePercent(project, milestone.id, row.percent, actor, at);
      completedPerSchedule(milestone, row, at);
      moved = true;
    }
    if (!moved) {
      unchanged += 1;
      continue;
    }
    milestone.updatedAt = at;
    milestone.updatedBy = actor;
    updated += 1;
  }
  const added = addMilestones(project, fresh.map((row) => ({ name: row.name, weight: row.weight ?? 1, plannedFinish: row.plannedFinish })), actor);
  added.forEach((milestone, i) => {
    const row = fresh[i]!;
    if (row.plannedStart) milestone.plannedStart = row.plannedStart;
    if (row.percent) setMilestonePercent(project, milestone.id, row.percent, actor, at);
    completedPerSchedule(milestone, row, at);
  });
  if (updated) recordAuditEvent(project, { actor, action: 'import_schedule', entityType: 'milestone', entityId: project.id, newValue: `${updated} milestone${updated === 1 ? '' : 's'} updated` });
  return { added: added.length, updated, unchanged };
}

/* ==================================================================== */
/* What the schedule says today                                           */
/* ==================================================================== */

/** Late: the date has passed. Behind: the date is close and progress is short of where it should be. Slipping: at the current rate it finishes after its date. */
export type ScheduleLevel = 'late' | 'behind' | 'slipping';

export interface MilestoneWatch {
  id: string;
  name: string;
  percent: number;
  /** The planned finish, as extensions of time granted have moved it. */
  plannedFinish?: string;
  /** Days of extension granted that moved it, when any did. */
  extensionDays?: number;
  /** Days from today to the planned finish; below zero once it has passed. */
  daysToFinish?: number;
  /** Where a straight line from planned start to planned finish puts it today. Only with both dates. */
  expectedPercent?: number;
  /** Where the readings so far put its finish, at the current rate. */
  projectedFinish?: string;
  /** How many days after its planned finish that is, when it is after. */
  projectedDaysLate?: number;
  level?: ScheduleLevel;
  /** The warning in one line, when there is one. */
  say?: string;
}

const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;
const dueIn = (n: number): string => (n === 0 ? 'Due today' : `Due in ${days(n)}`);

/**
 * What was reported for a milestone and on which day, oldest first, one a
 * day. From its own readings, and from the site log for what was reported
 * before readings were kept.
 */
export function progressReadings(project: Pick<DdProject, 'siteLog'>, milestone: Milestone): Array<{ on: string; percent: number }> {
  const byDay = new Map<string, number>();
  const log = [...(project.siteLog ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const entry of log) {
    for (const update of entry.milestoneUpdates) if (update.milestoneId === milestone.id) byDay.set(entry.date, update.percent);
  }
  for (const reading of milestone.readings ?? []) byDay.set(reading.on, reading.percent);
  return [...byDay].map(([on, percent]) => ({ on, percent })).sort((a, b) => a.on.localeCompare(b.on));
}

/**
 * The day a milestone reaches 100% if it goes on as it has so far: the rate
 * from the first reading to today, at the percent it stands at, carried on
 * from today. Days with nothing reported count, so a milestone that has
 * stood still since its last reading is slower for every one of them.
 * Nothing with fewer readings than a rate needs, or when it has not risen.
 */
export function projectedFinish(readings: ReadonlyArray<{ on: string; percent: number }>, percent: number, today: string): string | undefined {
  if (readings.length < PROJECTION_MIN_READINGS || percent >= 100) return undefined;
  const first = readings[0]!;
  const elapsed = daysFrom(first.on, today);
  if (!(elapsed > 0)) return undefined;
  const rate = (percent - first.percent) / elapsed;
  if (!(rate > 0)) return undefined;
  return dayOf(dayNumber(today) + Math.ceil((100 - percent) / rate));
}

/** One milestone against its dates, on the day given. */
export function milestoneWatch(project: Pick<DdProject, 'siteLog'>, milestone: Milestone, now: Date, extensions?: MilestoneExtensions): MilestoneWatch {
  const today = now.toISOString().slice(0, 10);
  const { id, name, percent } = milestone;
  const plannedFinish = extensions ? plannedFinishAfterExtensions(milestone, extensions) : milestone.plannedFinish?.slice(0, 10);
  const plannedStart = milestone.plannedStart?.slice(0, 10);
  const moved = extensions?.days.get(id);
  const out: MilestoneWatch = { id, name, percent, ...(plannedFinish ? { plannedFinish } : {}), ...(moved ? { extensionDays: moved } : {}) };
  if (plannedFinish) out.daysToFinish = daysFrom(today, plannedFinish);
  if (plannedFinish && plannedStart && plannedStart <= plannedFinish) {
    const span = daysFrom(plannedStart, plannedFinish);
    out.expectedPercent = today >= plannedFinish ? 100 : today <= plannedStart ? 0 : Math.round((daysFrom(plannedStart, today) / span) * 100);
  }
  if (percent >= 100) return out;

  const projected = projectedFinish(progressReadings(project, milestone), percent, today);
  if (projected) {
    out.projectedFinish = projected;
    if (plannedFinish && projected > plannedFinish) out.projectedDaysLate = daysFrom(plannedFinish, projected);
  }
  if (out.daysToFinish === undefined) return out;

  const slipping = out.projectedDaysLate ? `At the current rate it finishes about ${days(out.projectedDaysLate)} late.` : '';
  if (out.daysToFinish < 0) {
    out.level = 'late';
    out.say = `${days(-out.daysToFinish)} late, ${percent}% done.`;
  } else if (out.daysToFinish <= DUE_SOON_DAYS && percent < (out.expectedPercent ?? DUE_SOON_FLOOR_PERCENT)) {
    out.level = 'behind';
    const expected = out.expectedPercent === undefined ? `${DUE_SOON_FLOOR_PERCENT}% or more` : `${out.expectedPercent}%`;
    out.say = `${dueIn(out.daysToFinish)}, ${percent}% done, expected ${expected}.${slipping ? ` ${slipping}` : ''}`;
  } else if (slipping) {
    out.level = 'slipping';
    out.say = slipping;
  }
  return out;
}

/**
 * How many days after its planned finish an open milestone stands to finish:
 * by its own rate where it has one, and by the days already gone where its
 * date has passed. Nothing where it is on time.
 */
function milestoneSlip(m: MilestoneWatch): number {
  return Math.max(m.projectedDaysLate ?? 0, m.daysToFinish !== undefined && m.daysToFinish < 0 ? -m.daysToFinish : 0);
}

/**
 * When each open milestone finishes as the work is going, by its id: the one
 * figure projected completion, the summary line and the extension-of-time
 * flag are all read from.
 *
 * A milestone with a rate finishes where its readings put it. One with no
 * rate is taken at its planned date, or today once that has passed, moved by
 * the most any open milestone planned to finish before it is slipping:
 * work that follows waits on it, as an extension of time is carried. So a
 * schedule with a milestone running late never gives a completion on time.
 * Nothing where no milestone is slipping and none has a rate.
 */
export function projectedFinishes(open: readonly MilestoneWatch[], today: string): Map<string, string> | undefined {
  if (!open.some((m) => m.projectedFinish || milestoneSlip(m) > 0)) return undefined;
  const out = new Map<string, string>();
  for (const m of open) {
    if (m.projectedFinish) {
      out.set(m.id, m.projectedFinish);
      continue;
    }
    const planned = m.plannedFinish;
    const carried = planned ? Math.max(0, ...open.filter((other) => other.id !== m.id && other.plannedFinish && other.plannedFinish < planned).map(milestoneSlip)) : 0;
    // Its planned date moved by what it waits on, and never a day already gone.
    const moved = planned ? dayOf(dayNumber(planned) + carried) : today;
    out.set(m.id, moved > today ? moved : today);
  }
  return out;
}

export interface ScheduleWatch {
  milestones: MilestoneWatch[];
  /** The latest planned finish among the milestones, as extensions of time granted have moved it. */
  plannedCompletion?: string;
  /** The latest planned finish before any extension, where extensions moved it. */
  completionBeforeExtensions?: string;
  /** How many days the extensions granted moved planned completion by. */
  extensionDays?: number;
  /** Days granted on contracts whose packages serve no milestone, which therefore move nothing here. */
  extensionUnplaced?: number;
  /** The latest finish over the open milestones as the work is going (`projectedFinishes`). Only when some milestone has a rate or is slipping. */
  projectedCompletion?: string;
  /** How many days after planned completion that is, when it is after. */
  projectedDaysLate?: number;
  /** Projected completion is after planned completion, or planned completion has passed with work unfinished. */
  extensionLikely: boolean;
  /** Planned and projected completion in one line. */
  say?: string;
}

/** The whole schedule on the day given: each milestone, and when the work as a whole finishes. */
export function scheduleWatch(project: Pick<DdProject, 'milestones' | 'siteLog'> & Partial<Pick<DdProject, 'fieldSheets' | 'cost'>>, now: Date): ScheduleWatch {
  const today = now.toISOString().slice(0, 10);
  const extensions = milestoneExtensions(project);
  const milestones = (project.milestones ?? []).map((m) => milestoneWatch(project, m, now, extensions));
  const plannedCompletion = milestones.map((m) => m.plannedFinish).filter((day): day is string => Boolean(day)).sort().at(-1);
  const before = (project.milestones ?? []).map((m) => m.plannedFinish?.slice(0, 10)).filter((day): day is string => Boolean(day)).sort().at(-1);
  const open = milestones.filter((m) => m.percent < 100);
  const out: ScheduleWatch = { milestones, ...(plannedCompletion ? { plannedCompletion } : {}), extensionLikely: false, ...(extensions.unplaced ? { extensionUnplaced: extensions.unplaced } : {}) };
  if (!plannedCompletion) return out;
  if (before && before < plannedCompletion) {
    out.completionBeforeExtensions = before;
    out.extensionDays = daysFrom(before, plannedCompletion);
  }

  const projected = projectedFinishes(open, today);
  const latest = projected ? [...projected.values()].sort().at(-1)! : undefined;
  // A finish of today is no projection: it is what an overdue milestone with no rate is floored at.
  if (latest && (latest > today || open.some((m) => m.projectedFinish))) {
    out.projectedCompletion = latest;
    if (latest > plannedCompletion) out.projectedDaysLate = daysFrom(plannedCompletion, latest);
  }
  const overrun = plannedCompletion < today && open.length > 0;
  out.extensionLikely = Boolean(out.projectedDaysLate) || overrun;
  out.say = [
    `Planned completion ${plannedCompletion}.`,
    out.extensionDays ? `Extensions of time granted moved it ${days(out.extensionDays)} from ${out.completionBeforeExtensions}.` : '',
    out.projectedDaysLate ? `At the current rate, about ${days(out.projectedDaysLate)} later.` : '',
    overrun ? 'That date has passed with work unfinished.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return out;
}

/* ==================================================================== */
/* Planned against actual, over time                                     */
/* ==================================================================== */

/**
 * How much of a milestone was planned to be done by the end of a day: none
 * before its planned start, all of it from its planned finish, and in a
 * straight line between. With no planned start it is none until the day it
 * is planned to finish. Undefined with no planned finish: a milestone nobody
 * has dated is planned for no day.
 */
export function plannedFraction(milestone: Pick<Milestone, 'plannedStart' | 'plannedFinish'>, day: string, finish = milestone.plannedFinish?.slice(0, 10)): number | undefined {
  if (!finish) return undefined;
  if (day >= finish) return 1;
  const start = milestone.plannedStart?.slice(0, 10);
  if (!start || start >= finish || day < start) return 0;
  return daysFrom(start, day) / daysFrom(start, finish);
}

/**
 * The milestones of one building, by their ids. A building is linked to as
 * its shared record; a milestone names the project's own phase or block. They
 * are the same one where the ids match, or where the record and the phase
 * are called the same.
 */
export function buildingMilestones(project: Pick<DdProject, 'milestones'> & Partial<Pick<DdProject, 'assets' | 'fieldSheets'>>, building: string): Set<string> {
  // The record's name as it stands: what somebody only offered names nothing.
  const name = standingText(standingRecords(project, 'shared.buildings').find((record) => record.id === building), 'name') ?? '';
  const assets = new Set((project.assets ?? []).filter((asset) => asset.id === building || (name && asset.name.trim().toLowerCase() === name.trim().toLowerCase())).map((asset) => asset.id));
  return new Set((project.milestones ?? []).filter((milestone) => milestone.assetId === building || (milestone.assetId !== undefined && assets.has(milestone.assetId))).map((milestone) => milestone.id));
}

/** The milestones a figure is of: all of them, or only those named. */
function milestonesOf(project: Pick<DdProject, 'milestones'>, only?: ReadonlySet<string>): Milestone[] {
  const all = project.milestones ?? [];
  return only ? all.filter((milestone) => only.has(milestone.id)) : all;
}

/**
 * The share of the work planned to be done by the end of a day, by the
 * weight of the milestones, each held to its planned finish as the
 * extensions granted have moved it. Null with no milestones, and null while
 * any milestone has no planned finish: a plan with a hole in it gives no
 * planned percent, never a low one.
 */
export function plannedPercent(project: Pick<DdProject, 'milestones'> & Partial<Pick<DdProject, 'fieldSheets' | 'cost'>>, day: string, only?: ReadonlySet<string>): number | null {
  const milestones = milestonesOf(project, only);
  const weight = milestones.reduce((total, milestone) => total + milestone.weight, 0);
  if (!(weight > 0)) return null;
  const extensions = milestoneExtensions(project);
  let planned = 0;
  for (const milestone of milestones) {
    const fraction = plannedFraction(milestone, day, plannedFinishAfterExtensions(milestone, extensions));
    if (fraction === undefined) return null;
    planned += milestone.weight * fraction;
  }
  return Math.round((planned / weight) * 1000) / 10;
}

/** The share of the work reported done by the end of a day, by the weight of the milestones: each at what was last reported of it on or before that day. Null with no milestones. */
export function actualPercentOn(project: Pick<DdProject, 'milestones' | 'siteLog'>, day: string, only?: ReadonlySet<string>): number | null {
  const milestones = milestonesOf(project, only);
  const weight = milestones.reduce((total, milestone) => total + milestone.weight, 0);
  if (!(weight > 0)) return null;
  const done = milestones.reduce((total, milestone) => {
    const readings = progressReadings(project, milestone);
    // A milestone with nothing ever reported of it day by day is where it stands; one with readings is at the last by the day.
    const percent = readings.length ? (readings.filter((reading) => reading.on <= day).at(-1)?.percent ?? 0) : milestone.percent;
    return total + milestone.weight * percent;
  }, 0);
  return Math.round((done / weight) * 10) / 10;
}

/** One month of planned against actual. */
export interface ProgressCurvePoint {
  /** The month, as `YYYY-MM`. */
  month: string;
  /** Its last day: the day both figures are of. */
  on: string;
  /** Planned by then, by weight. Null where the plan cannot say. */
  planned: number | null;
  /** Reported by then, by weight. Null for a month that has not ended. */
  actual: number | null;
}

/** The most months a curve draws. */
export const PROGRESS_CURVE_MONTHS_MOST = 60;

/**
 * Planned against actual, month by month: the S-curve.
 *
 * From the month the plan begins, or the first progress was reported, to the
 * month the plan ends. Each month is read at its last day: what was planned
 * by then, by the weight of the milestones, and what had been reported by
 * then. A month that has not ended has a planned figure and no actual one;
 * the month in hand is read as at today. Nothing with no milestones. `only`
 * narrows it to some milestones: those of one building.
 */
export function progressCurve(project: Pick<DdProject, 'milestones' | 'siteLog'> & Partial<Pick<DdProject, 'fieldSheets' | 'cost'>>, now: Date, only?: ReadonlySet<string>): ProgressCurvePoint[] {
  const milestones = milestonesOf(project, only);
  if (!milestones.length) return [];
  const today = now.toISOString().slice(0, 10);
  const days = [
    ...milestones.flatMap((milestone) => [milestone.plannedStart?.slice(0, 10), milestone.plannedFinish?.slice(0, 10), ...progressReadings(project, milestone).map((reading) => reading.on)]),
  ].filter((day): day is string => Boolean(day));
  if (!days.length) return [];
  const [first, last] = [days.reduce((a, b) => (a < b ? a : b)), days.reduce((a, b) => (a > b ? a : b))];
  const end = last > today ? last : today;
  const out: ProgressCurvePoint[] = [];
  let [year, month] = [Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1];
  while (out.length < PROGRESS_CURVE_MONTHS_MOST) {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    const key = lastDay.slice(0, 7);
    // The month in hand is read as at today: its last day has not come.
    const on = key === today.slice(0, 7) ? today : lastDay;
    out.push({ month: key, on, planned: plannedPercent(project, on, only), actual: on <= today ? actualPercentOn(project, on, only) : null });
    if (lastDay >= end) break;
    month += 1;
    if (month > 11) [year, month] = [year + 1, 0];
  }
  return out;
}

/** The work measured in money: what was planned to be done by a day, what has been done, and what it has cost. */
export interface EarnedValue {
  /** The budget of the work packages the milestones are measured by. */
  budget: number;
  /** Planned value: each milestone's budget by how much of it was planned to be done by the day. */
  planned: number;
  /** Earned value: each milestone's budget by how much of it is reported done. */
  earned: number;
}

/**
 * Earned value, where it can be told honestly.
 *
 * A milestone's weight is a share of the work somebody judged; it is not
 * money. So the work is measured in money only where every milestone is
 * tied to a work package (the package names the milestone its work is
 * measured against) and every such package has a budget. Then a milestone's
 * budget is the sum of its packages', planned value is that budget by how
 * much of the milestone was planned to be done by the day, and earned value
 * is that budget by how much is reported done. Undefined otherwise: where
 * one milestone has no package there is no earned value, and none is shown.
 */
export function earnedValue(project: Pick<DdProject, 'milestones'> & Partial<Pick<DdProject, 'fieldSheets' | 'cost'>>, day: string): EarnedValue | undefined {
  const milestones = project.milestones ?? [];
  if (!milestones.length) return undefined;
  const packages = project.cost?.workPackages ?? [];
  const extensions = milestoneExtensions(project);
  const out: EarnedValue = { budget: 0, planned: 0, earned: 0 };
  for (const milestone of milestones) {
    const tied = packages.filter((pack) => pack.milestoneId === milestone.id);
    if (!tied.length || tied.some((pack) => pack.budget === undefined)) return undefined;
    const fraction = plannedFraction(milestone, day, plannedFinishAfterExtensions(milestone, extensions));
    if (fraction === undefined) return undefined;
    const budget = tied.reduce((total, pack) => total + (pack.budget ?? 0), 0);
    out.budget += budget;
    out.planned += budget * fraction;
    out.earned += (budget * milestone.percent) / 100;
  }
  const paisa = (amount: number): number => Math.round(amount * 100) / 100;
  return { budget: paisa(out.budget), planned: paisa(out.planned), earned: paisa(out.earned) };
}
