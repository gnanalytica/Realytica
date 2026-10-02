import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

/**
 * Today's date as the person on site means it: the phone's local calendar
 * date, not UTC. (At 4 a.m. in Bengaluru, UTC still says yesterday.)
 */
export function localDate(d: Date = new Date()): string {
  return format(d, 'yyyy-MM-dd');
}

/** 'YYYY-MM-DD' → a Date at local midnight. */
export function parseDay(day: string): Date {
  return parseISO(day);
}

/** "Today", "Yesterday", or "Mon 29 Sep" (with the year when it is not this year). */
export function dayLabel(day: string, now: Date = new Date()): string {
  const d = parseDay(day);
  if (!isValid(d)) return day;
  const diff = differenceInCalendarDays(now, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return format(d, d.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

/** "Thursday 2 October" — for headings. */
export function longDay(day: string): string {
  const d = parseDay(day);
  return isValid(d) ? format(d, 'EEEE d MMMM') : day;
}

/** "5 minutes ago". */
export function ago(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!isValid(d)) return '';
  if (Date.now() - d.getTime() < 45_000) return 'just now';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** "2 Oct, 3:41 pm". */
export function dateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isValid(d) ? format(d, 'd MMM, h:mm a') : '';
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The person part of an author line. The API writes authors as
 * "Ravi Kumar (ravi@firm.in)" or just the email.
 */
export function authorName(author: string): string {
  const match = author.match(/^(.*?)\s*\(([^)]+@[^)]+)\)$/);
  if (match?.[1]) return match[1];
  return author.includes('@') ? author.split('@')[0] : author;
}
