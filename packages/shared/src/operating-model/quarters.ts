/**
 * Quarters of a year, as periods.
 *
 * A quarter is three calendar months from the first of January, April, July
 * or October. The Indian financial year (April to March) and the calendar
 * year cut the year at the same four days and number the quarters
 * differently: July to September is Q2 of FY 2026-27 and Q3 of 2026. The
 * financial year is the default; a project may say the calendar year
 * (`report-day.ts`). A quarter's two ends are moments in UTC, as a month's
 * are everywhere else on the record.
 */

/** A period: from this moment up to, and not including, that one. The status report's own shape. */
interface Period {
  from: string;
  to: string;
}

/** Which year a quarter is numbered in: the Indian financial year (April to March) or the calendar year. */
export type QuarterYear = 'financial' | 'calendar';

/** The year quarters are numbered in where nobody has said. */
export const QUARTER_YEAR_DEFAULT: QuarterYear = 'financial';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The quarter that begins in a month of a year. A month before January or after December is read into the year beside it. */
export const quarterOf = (year: number, month: number): Period => ({ from: new Date(Date.UTC(year, month, 1)).toISOString(), to: new Date(Date.UTC(year, month + 3, 1)).toISOString() });

/** The quarter a moment falls in, or the one so many quarters before or after it. */
export function quarterHolding(at: Date, shift = 0): Period {
  return quarterOf(at.getUTCFullYear(), Math.floor(at.getUTCMonth() / 3) * 3 + shift * 3);
}

/** Whether a period is one whole quarter. */
export function isQuarter(period: Period): boolean {
  const from = new Date(period.from);
  if (Number.isNaN(from.getTime()) || Number.isNaN(Date.parse(period.to))) return false;
  const whole = quarterOf(from.getUTCFullYear(), from.getUTCMonth());
  return from.getUTCMonth() % 3 === 0 && whole.from === period.from && whole.to === new Date(period.to).toISOString();
}

/** A quarter's number and the year it is numbered in. For the financial year, the year it began in: 2026 is FY 2026-27. */
function quarterNumbered(period: Period, year: QuarterYear): { n: number; year: number } {
  const from = new Date(period.from);
  const [y, m] = [from.getUTCFullYear(), from.getUTCMonth()];
  if (year === 'calendar') return { n: m / 3 + 1, year: y };
  return m < 3 ? { n: 4, year: y - 1 } : { n: m / 3, year: y };
}

/**
 * A quarter by the key it is asked for by: `FY2026-Q2` is the second quarter
 * of the financial year that begins in April 2026, `2026-Q3` the third of
 * the calendar year. Both of those are July to September 2026.
 */
export function quarterKey(period: Period, year: QuarterYear = QUARTER_YEAR_DEFAULT): string | undefined {
  if (!isQuarter(period)) return undefined;
  const numbered = quarterNumbered(period, year);
  return year === 'calendar' ? `${numbered.year}-Q${numbered.n}` : `FY${numbered.year}-Q${numbered.n}`;
}

/** The quarter a key names, or nothing for words that are no key. */
export function quarterOfKey(key: string | null | undefined): Period | undefined {
  const said = /^(FY)?(\d{4})-Q([1-4])$/i.exec((key ?? '').trim());
  if (!said) return undefined;
  const [year, n] = [Number(said[2]), Number(said[3])];
  if (!said[1]) return quarterOf(year, (n - 1) * 3);
  return n === 4 ? quarterOf(year + 1, 0) : quarterOf(year, n * 3);
}

/** A quarter as it is said: "Q2 FY 2026-27" or "Q3 2026". Nothing for a period that is no quarter. */
export function quarterSaid(period: Period, year: QuarterYear = QUARTER_YEAR_DEFAULT): string | undefined {
  if (!isQuarter(period)) return undefined;
  const numbered = quarterNumbered(period, year);
  return year === 'calendar' ? `Q${numbered.n} ${numbered.year}` : `Q${numbered.n} FY ${numbered.year}-${String((numbered.year + 1) % 100).padStart(2, '0')}`;
}

/** A quarter's three months in words: "July to September 2026". */
export function quarterMonthsSaid(period: Period): string {
  const from = new Date(period.from);
  return `${MONTH_NAMES[from.getUTCMonth()]} to ${MONTH_NAMES[from.getUTCMonth() + 2]} ${from.getUTCFullYear()}`;
}

