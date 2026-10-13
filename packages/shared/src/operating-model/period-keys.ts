/**
 * Periods as the calendar cuts them: a week, a month, a quarter, a year.
 *
 * Every period has a key that never changes (`2026-09`, `FY2026-Q2`,
 * `2026-W41`, `FY2026`), a first and a last day, and a way it is said. Days
 * are days in India. A quarter and a year are numbered in the Indian
 * financial year (April to March) unless the project says the calendar year
 * (`quarters.ts`). A week runs Monday to Sunday and is numbered as ISO 8601
 * numbers it: the week that holds the year's first Thursday is week 1.
 *
 * Nothing here reads a project. `field-periods.ts` is where a set's periods
 * are opened, compared and issued.
 */

import { QUARTER_YEAR_DEFAULT, quarterKey, quarterOf, quarterOfKey, quarterSaid, type QuarterYear } from './quarters';
import { daySaid } from './said';

/** How often something is kept, where the calendar says when. */
export type CalendarEvery = 'week' | 'month' | 'quarter' | 'year';

/** One period: its key, its first and last day (both inside it), and how it is said in full and in short. */
export interface PeriodSpan {
  key: string;
  from: string;
  to: string;
  /** "September 2026", "Q2 FY 2026-27", "Week of 5 Oct 2026", "FY 2026-27". */
  label: string;
  /** "September", "Q2 FY 2026-27", "Week of 5 Oct", "FY 2026-27": what a line says where the year is plain. */
  short: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 86_400_000;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const msOf = (day: string): number => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);

/** Whether words are a day the calendar has. */
export function isCalendarDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(msOf(day)) && dayOf(msOf(day)) === day;
}

/** A day so many days after another. */
export function dayAfter(day: string, days: number): string {
  return dayOf(msOf(day) + days * DAY_MS);
}

/** A day so many months after another, kept inside the month it lands in: 31 January and a month is the last of February. */
export function monthsAfter(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return dayOf(Date.UTC(y, m - 1 + months, Math.min(d, last)));
}

function monthSpan(year: number, month: number): PeriodSpan {
  const first = new Date(Date.UTC(year, month, 1));
  const [y, m] = [first.getUTCFullYear(), first.getUTCMonth()];
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, from: dayOf(first.getTime()), to: dayOf(Date.UTC(y, m + 1, 0)), label: `${MONTHS[m]} ${y}`, short: MONTHS[m]! };
}

function quarterSpan(year: number, month: number, numbered: QuarterYear): PeriodSpan {
  const period = quarterOf(year, Math.floor(month / 3) * 3);
  const said = quarterSaid(period, numbered)!;
  return { key: quarterKey(period, numbered)!, from: period.from.slice(0, 10), to: dayOf(Date.parse(period.to) - DAY_MS), label: said, short: said };
}

function yearSpan(year: number, numbered: QuarterYear): PeriodSpan {
  if (numbered === 'calendar') return { key: String(year), from: `${year}-01-01`, to: `${year}-12-31`, label: String(year), short: String(year) };
  const said = `FY ${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  return { key: `FY${year}`, from: `${year}-04-01`, to: `${year + 1}-03-31`, label: said, short: said };
}

/** The Monday of the week a day falls in. */
function mondayOf(ms: number): number {
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return ms - weekday * DAY_MS;
}

function weekSpan(monday: number): PeriodSpan {
  // ISO 8601: a week belongs to the year its Thursday is in, and week 1 holds the year's first Thursday.
  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const first = mondayOf(Date.UTC(year, 0, 4));
  const n = Math.round((monday - first) / (7 * DAY_MS)) + 1;
  const from = dayOf(monday);
  return { key: `${year}-W${String(n).padStart(2, '0')}`, from, to: dayOf(monday + 6 * DAY_MS), label: `Week of ${daySaid(from)}`, short: `Week of ${daySaid(from).replace(/ \d{4}$/, '')}` };
}

/** The period of one kind that holds a day. Undefined for words that are no day. */
export function periodOfDay(every: CalendarEvery, day: string, numbered: QuarterYear = QUARTER_YEAR_DEFAULT): PeriodSpan | undefined {
  if (!isCalendarDay(day.slice(0, 10))) return undefined;
  const [y, m] = day.split('-').map(Number) as [number, number];
  if (every === 'month') return monthSpan(y, m - 1);
  if (every === 'quarter') return quarterSpan(y, m - 1, numbered);
  if (every === 'week') return weekSpan(mondayOf(msOf(day)));
  return yearSpan(numbered === 'financial' && m < 4 ? y - 1 : y, numbered);
}

/** The period a key names. Undefined for words that are no key. */
export function periodOfKey(key: string | null | undefined): PeriodSpan | undefined {
  const said = (key ?? '').trim();
  const month = /^(\d{4})-(\d{2})$/.exec(said);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) return monthSpan(Number(month[1]), Number(month[2]) - 1);
  const week = /^(\d{4})-W(\d{2})$/.exec(said);
  if (week && Number(week[2]) >= 1 && Number(week[2]) <= 53) {
    const span = weekSpan(mondayOf(Date.UTC(Number(week[1]), 0, 4)) + (Number(week[2]) - 1) * 7 * DAY_MS);
    return span.key === said ? span : undefined;
  }
  const quarter = quarterOfKey(said);
  if (quarter) {
    const from = new Date(quarter.from);
    return quarterSpan(from.getUTCFullYear(), from.getUTCMonth(), /^FY/i.test(said) ? 'financial' : 'calendar');
  }
  const year = /^(FY)?(\d{4})$/.exec(said);
  if (year) return yearSpan(Number(year[2]), year[1] ? 'financial' : 'calendar');
  return undefined;
}

/** What kind of period a key names. */
export function periodKind(key: string): CalendarEvery | undefined {
  if (/^\d{4}-\d{2}$/.test(key)) return 'month';
  if (/^\d{4}-W\d{2}$/.test(key)) return 'week';
  if (/^(FY)?\d{4}-Q[1-4]$/i.test(key)) return 'quarter';
  if (/^(FY)?\d{4}$/.test(key)) return 'year';
  return undefined;
}

/** The period so many periods after one (before it, with a negative count), of the same kind and numbered the same way. */
export function periodShift(span: PeriodSpan, count: number): PeriodSpan {
  const kind = periodKind(span.key);
  const numbered: QuarterYear = /^FY/.test(span.key) ? 'financial' : 'calendar';
  if (kind === 'week') return weekSpan(msOf(span.from) + count * 7 * DAY_MS);
  const [y, m] = span.from.split('-').map(Number) as [number, number];
  if (kind === 'month') return monthSpan(y, m - 1 + count);
  if (kind === 'quarter') {
    const first = new Date(Date.UTC(y, m - 1 + count * 3, 1));
    return quarterSpan(first.getUTCFullYear(), first.getUTCMonth(), numbered);
  }
  if (kind === 'year') return yearSpan(y + count, numbered);
  return span;
}

/** The year a text names, as an assessment or financial year is written: "2026-27", "2026/27", "FY 2026-27", "2026". */
export function yearWritten(text: string, numbered: QuarterYear = QUARTER_YEAR_DEFAULT): PeriodSpan | undefined {
  const said = /^(?:FY\s*)?(\d{4})(?:\s*[-–/]\s*(\d{2}|\d{4}))?$/i.exec(text.trim());
  if (!said) return undefined;
  // A year written as a pair is a year that runs across two: the financial year.
  return yearSpan(Number(said[1]), said[2] ? 'financial' : numbered);
}

/** Every period of one kind from one to another, both among them, oldest first. At most `most`, counted back from the last. */
export function periodsBetween(first: PeriodSpan, last: PeriodSpan, most = 60): PeriodSpan[] {
  const out: PeriodSpan[] = [];
  for (let span = last; span.from >= first.from && out.length < most; span = periodShift(span, -1)) out.unshift(span);
  return out;
}
