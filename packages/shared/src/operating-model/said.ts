/**
 * How a day, a share and a count are written, everywhere a person reads one.
 *
 * One format each: a day is "13 Oct 2026", a percentage has at most two
 * decimals and its sign against the figure, and a count takes the singular
 * or the plural of its noun, never "(s)". Money and measures are written by
 * `formatMoney` and `formatMeasure` in `units.ts`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day as a person reads it: "13 Oct 2026". Takes a day (`2026-10-13`), a
 * moment (`2026-10-13T08:00:00Z`) or a date. A day written as a day is that
 * day wherever it is read; a moment is the day it was in India, where the
 * work is. Anything that is not a date is given back as it came.
 */
export function daySaid(day: string | Date | null | undefined): string {
  if (day === null || day === undefined || day === '') return '';
  if (typeof day === 'string') {
    const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
    if (plain) {
      const month = MONTHS[Number(plain[2]) - 1];
      return month ? `${Number(plain[3])} ${month} ${plain[1]}` : day;
    }
  }
  const at = day instanceof Date ? day : new Date(day);
  if (Number.isNaN(at.getTime())) return String(day);
  // India keeps one clock, five and a half hours ahead, with no summer time.
  const local = new Date(at.getTime() + 330 * 60_000);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * A day as a person types one, as the store keeps it (`2026-10-13`), or null
 * where it is not a day the calendar has. Reads "13 Oct 2026", "13 October
 * 2026", "13-10-2026", "13/10/2026" and "13.10.2026" (the day first, as it is
 * written here), and a day already in the store's form.
 */
export function dayTyped(typed: string): string | null {
  const text = typed.trim().replace(/\s+/g, ' ').replace(/,/g, '');
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  const named = /^(\d{1,2}) ?([A-Za-z]{3,9})\.? ?(\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) [d, m, y] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  else if (named) {
    const month = MONTH_NAMES.findIndex((name) => name.startsWith(named[2]!.toLowerCase()) && named[2]!.length >= 3);
    if (month < 0) return null;
    [d, m, y] = [Number(named[1]), month + 1, Number(named[3])];
  } else return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whether a text is a day or a moment as the store keeps one. */
export function looksLikeDay(text: unknown): text is string {
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text.trim());
}

/** A percentage: at most two decimals, no trailing zeros, the sign against the figure. "45.24%". */
export function percentSaid(value: number, places = 2): string {
  const f = 10 ** places;
  return `${(Math.round(value * f) / f).toLocaleString('en-IN', { maximumFractionDigits: places })}%`;
}

const SINGULAR: Record<string, string> = { are: 'is', were: 'was', have: 'has', rest: 'rests', hold: 'holds', sell: 'sells', stand: 'stands' };

/**
 * A sentence a rule says, with its count and its noun agreeing.
 *
 * A rule's sentence is a template written once for any count: "{a} deed(s)
 * were signed by an attorney after the principal had died." Printed as it
 * stands, one deed reads "1 deed(s) were". Here the "(s)" is settled by the
 * figure before it, and the verb straight after the noun with it: "1 deed
 * was signed", "3 deeds were signed". A sentence with no "(s)" is not touched.
 */
export function agreeSaid(text: string): string {
  return text.replace(/(\d[\d,]*(?:\.\d+)?)( (?:[\p{L}’'-]+ ){0,3}[\p{L}-]+)\(s\)( (?:are|were|have|rest|hold|sell|stand)\b)?/gu, (_, figure: string, noun: string, verb: string | undefined) => {
    const one = Number(figure.replace(/,/g, '')) === 1;
    return `${figure}${noun}${one ? '' : 's'}${verb ? (one ? ` ${SINGULAR[verb.trim()]}` : verb) : ''}`;
  });
}

/** A count with its noun: "1 link", "3 links". */
export function countSaid(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}

/** Pages by number, a run of three or more as "6 to 9": "page 4", "pages 2 and 3", "pages 1 and 6 to 12". Empty for none. */
export function pagesSaid(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    if (j - i >= 2) runs.push(`${sorted[i]} to ${sorted[j]}`);
    else for (let k = i; k <= j; k += 1) runs.push(String(sorted[k]));
    i = j;
  }
  return sorted.length === 1 ? `page ${runs[0]}` : `pages ${runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(', ')} and ${runs.at(-1)}`}`;
}

/** A line of words with every day written "2026-09-29" in it written as a day is written everywhere else: "29 Sep 2026". */
export function daysInWords(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b(?!T)/g, (day) => daySaid(day) || day);
}
