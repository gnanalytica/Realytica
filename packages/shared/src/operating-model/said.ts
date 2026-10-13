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
