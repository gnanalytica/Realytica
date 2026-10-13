/**
 * What a field held before: kept on the value, bounded, and read as at a day.
 *
 * A field holds one value. Until this file, a change overwrote it and nothing
 * said what stood last month. `stand` is the one writer every path goes
 * through when a value starts or stops standing: a sheet, a record, a check,
 * an acceptance, a field marked not applicable and asked again. It keeps what
 * stood, with who made it stand and from when until when, newest first.
 *
 * - **Only what stood enters.** A value somebody offered, one in dispute and a
 *   usual value standing in are never history: none of them was ever true of
 *   the project by a person's word.
 * - **Bounded.** At most twenty-four entries. Past that the first is kept, the
 *   latest twelve, and of the rest the ones that stood at a month's end.
 * - **A day is a day in India.** "As at 30 September" is what stood when that
 *   day ended there.
 * - **Nothing is said that the record does not hold.** Before the day a
 *   project's history begins, a past day reads as now and says so.
 */

import { fieldState, formatFieldValue, isBlank } from './check-fields';
import { daySaid } from './said';
import type { CheckFieldDef, CheckFieldValue, FieldPast, OptionSet } from './types';

/** The most a value keeps of what it held before. */
export const HISTORY_MOST = 24;
/** Of those, the latest that are always kept. */
export const HISTORY_LATEST_KEPT = 12;
/** The most that is kept of a past value's quoted words. */
export const HISTORY_QUOTE_MOST = 80;

const INDIA_OFFSET_MS = 5.5 * 3_600_000;

/** The moment a day ends in India, as milliseconds. NaN for words that are no day. */
export function indiaDayEnd(day: string): number {
  const said = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!said) return Number.NaN;
  return Date.UTC(Number(said[1]), Number(said[2]) - 1, Number(said[3]) + 1) - INDIA_OFFSET_MS;
}

/** The day it is in India at a moment kept as text. */
export function indiaDayOf(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : new Date(at + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether a stored value stands by a person's word: accepted or typed and holding something, or marked not applicable. */
function standsHere(value: CheckFieldValue | undefined): boolean {
  if (!value) return false;
  const state = fieldState(value);
  if (state === 'not_applicable') return true;
  return (state === 'accepted' || state === 'typed') && !isBlank(value);
}

/** Whether two stored values are the same standing: both not applicable, or the same value. */
function sameStanding(a: CheckFieldValue, b: CheckFieldValue): boolean {
  const [na, nb] = [fieldState(a) === 'not_applicable', fieldState(b) === 'not_applicable'];
  if (na || nb) return na && nb;
  return same(a.value, b.value);
}

/** From when the value held has stood. */
export function standingSince(value: CheckFieldValue): string {
  if (value.since) return value.since;
  return fieldState(value) === 'typed' ? value.at : (value.acceptedAt ?? value.at);
}

/** A standing value as it is kept once it stops standing. */
function pastOf(value: CheckFieldValue, until: string): FieldPast {
  const state = fieldState(value);
  const table = Array.isArray(value.value) && value.value.some((row) => typeof row === 'object' && row !== null);
  const origin = value.origin?.kind === 'paper' ? { ...value.origin, quote: value.origin.quote.slice(0, HISTORY_QUOTE_MOST) } : value.origin?.kind === 'external' && value.origin.quote ? { ...value.origin, quote: value.origin.quote.slice(0, HISTORY_QUOTE_MOST) } : value.origin;
  return {
    value: state === 'not_applicable' || table ? null : (value.value as FieldPast['value']),
    ...(table ? { rows: (value.value as unknown[]).length } : {}),
    ...(value.entered && state !== 'not_applicable' ? { entered: value.entered } : {}),
    state: state === 'not_applicable' ? 'not_applicable' : state === 'accepted' ? 'accepted' : 'typed',
    ...(origin ? { origin } : {}),
    by: value.acceptedBy ?? value.by,
    at: standingSince(value),
    until,
  };
}

/**
 * The entries kept once there are more than the bound: the first, the latest
 * twelve, and of those between the ones that stood when a month ended in
 * India. Where that is still too many, the oldest of those between go. An
 * entry whose successor was dropped says so (`thinnedAfter`), so a day that
 * falls in the hole is never read as a day nothing stood.
 */
export function thinHistory(history: readonly FieldPast[]): FieldPast[] {
  if (history.length <= HISTORY_MOST) return [...history];
  const latest = history.slice(0, HISTORY_LATEST_KEPT);
  const first = history[history.length - 1]!;
  const between = history.slice(HISTORY_LATEST_KEPT, -1);
  // An entry stood at a month's end where it began in one month and stopped in a later one.
  let kept = between.filter((entry) => indiaDayOf(entry.at).slice(0, 7) < indiaDayOf(entry.until).slice(0, 7));
  const room = HISTORY_MOST - HISTORY_LATEST_KEPT - 1;
  if (kept.length > room) kept = kept.slice(0, room);
  const out = [...latest, ...kept, first];
  // What was dropped sat between two entries that stay: the older of the two says the record has a hole after it.
  const stays = new Set(out);
  for (let index = history.length - 1; index > 0; index -= 1) {
    const entry = history[index]!;
    if (!stays.has(entry) || stays.has(history[index - 1]!)) continue;
    out[out.indexOf(entry)] = { ...entry, thinnedAfter: true };
  }
  return out;
}

/**
 * Puts a value on its holder, keeping what stood there before.
 *
 * The one way a stored value changes once anything may stand on it. Where the
 * value that stood stops standing (another takes its place, it is cleared, it
 * goes into dispute, the field is marked not applicable) it is kept as
 * history with the moment it stopped. Where what stands is unchanged (a value
 * offered beside it, the same figure typed again) nothing is added. `next`
 * null clears the field: its history is kept on an empty value, for a field
 * with a past is never deleted.
 */
export function stand(holder: Record<string, CheckFieldValue>, key: string, next: CheckFieldValue | null | undefined, when: { at: string; by: string }): void {
  const prev = holder[key];
  const stood = standsHere(prev);
  const stays = Boolean(next) && stood && standsHere(next!) && sameStanding(prev!, next!);
  let history = prev?.history ?? [];
  if (stood && !stays) history = thinHistory([pastOf(prev!, when.at), ...history]);
  if (!next) {
    if (history.length) holder[key] = { value: null, at: when.at, by: when.by, history };
    else delete holder[key];
    return;
  }
  const { history: _carried, since: _since, ...plain } = next;
  const out: CheckFieldValue = { ...plain };
  if (out.was && 'history' in out.was) {
    const { history: _nested, ...was } = out.was as CheckFieldValue;
    out.was = was;
  }
  if (history.length) out.history = history;
  if (standsHere(out)) {
    // It has stood since it began to, whatever a later keeping wrote over its own days; and from now where it begins now.
    const since = stays ? standingSince(prev!) : when.at;
    if (standingSince(out) !== since) out.since = since;
  }
  holder[key] = out;
}

/** How a field read as at a day: the value that stands now, one it held before, nothing, or today's value where the record does not reach back that far. */
export interface FieldAsAt {
  how: 'now' | 'past' | 'none' | 'as_now';
  value?: CheckFieldValue;
  /** For `as_now`: the day before which the record keeps no history of this value. */
  since?: string;
  /** Read from the entry before a hole thinning left: what last stood before the day, as far as the record says. */
  approximate?: true;
}

/** A past entry as a value a reader takes: what stood, by whom and from when. */
function valueOfPast(past: FieldPast): CheckFieldValue {
  return {
    value: past.value,
    at: past.at,
    by: past.by,
    state: past.state === 'empty' ? 'empty' : past.state,
    ...(past.origin ? { origin: past.origin } : {}),
    ...(past.entered ? { entered: past.entered } : {}),
    ...(past.state === 'accepted' ? { acceptedBy: past.by, acceptedAt: past.at } : {}),
    ...(past.origin?.kind === 'paper' ? { sourceEvidenceId: past.origin.evidenceId, page: past.origin.page, quote: past.origin.quote } : {}),
  };
}

/**
 * What a field held when a day ended in India.
 *
 * The value that stands now, where it had begun to stand by then. Else the
 * entry of its history that stood then. Else nothing, where the record is
 * whole that far back (`wholeFrom`, the project's `historyFrom`): the field
 * was empty. Else today's value, said to be as now: before history was kept
 * the record does not say what stood.
 */
export function fieldAsAt(value: CheckFieldValue | undefined, day: string, wholeFrom?: string): FieldAsAt {
  const end = indiaDayEnd(day);
  if (!value || Number.isNaN(end)) return { how: 'none' };
  const stands = standsHere(value);
  const began = (iso: string) => Date.parse(iso) < end;
  if (stands && began(standingSince(value))) return { how: 'now', value };
  const history = value.history ?? [];
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index]!;
    if (!began(entry.at)) continue;
    // The newest entry that had begun by the day: it stood then where it had not yet stopped, or where what followed it was thinned out.
    if (Date.parse(entry.until) >= end) return { how: 'past', value: valueOfPast(entry) };
    if (entry.thinnedAfter) return { how: 'past', value: valueOfPast(entry), approximate: true };
    return { how: 'none' };
  }
  // Before anything the record holds of this field.
  const earliest = history.length ? history[history.length - 1]!.at : stands ? standingSince(value) : undefined;
  if (!earliest) return { how: 'none' };
  const whole = wholeFrom ? Date.parse(wholeFrom) : Number.NaN;
  if (!Number.isNaN(whole) && whole < end) return { how: 'none' };
  const from = !Number.isNaN(whole) ? wholeFrom! : earliest;
  return { how: 'as_now', ...(stands ? { value } : {}), since: indiaDayOf(from) };
}

/** How a field moved between a past day and now. */
export interface FieldMoved {
  /** What stood when the past day ended, where the record says. */
  from?: CheckFieldValue;
  /** What stands now. */
  to?: CheckFieldValue;
  /** Whether what stands differs from what stood. False where the record does not reach the past day. */
  moved: boolean;
  /** Now less then, where both are figures. */
  by?: number;
  /** The record does not reach the past day: nothing can be said of the movement. */
  unknown?: true;
}

/** What changed in a field since a day ended in India. */
export function fieldMoved(value: CheckFieldValue | undefined, sinceDay: string, wholeFrom?: string): FieldMoved {
  const then = fieldAsAt(value, sinceDay, wholeFrom);
  const to = value && standsHere(value) ? value : undefined;
  if (then.how === 'as_now') return { ...(to ? { to } : {}), moved: false, unknown: true };
  const from = then.value;
  const [a, b] = [from && fieldState(from) !== 'not_applicable' ? from.value : null, to && fieldState(to) !== 'not_applicable' ? to.value : null];
  const moved = Boolean(from) !== Boolean(to) || (Boolean(from) && Boolean(to) && !sameStanding(from!, to!));
  return { ...(from ? { from } : {}), ...(to ? { to } : {}), moved, ...(typeof a === 'number' && typeof b === 'number' ? { by: b - a } : {}) };
}

/** The earliest moment the record holds anything of a value: its first entry's, or its own. */
export function historySince(value: CheckFieldValue | undefined): string | undefined {
  if (!value) return undefined;
  const history = value.history ?? [];
  if (history.length) return history[history.length - 1]!.at;
  return standsHere(value) ? standingSince(value) : undefined;
}

/** A past entry as a person reads it, through the field's own formatter. */
function pastSaid(def: CheckFieldDef, past: FieldPast, lists?: (id: string) => OptionSet | undefined): string {
  if (past.state === 'not_applicable') return 'not applicable';
  if (past.rows !== undefined) return `${past.rows} ${past.rows === 1 ? 'row' : 'rows'}`;
  return formatFieldValue(def, { value: past.value, at: past.at, by: past.by, ...(past.entered ? { entered: past.entered } : {}) }, lists);
}

/** A field's past as its popover draws it. */
export interface FieldHistorySaid {
  /** "Was ₹4.10 Cr on 12 Aug 2026 (R. Iyer); now ₹4.32 Cr". A template over the last entry and the value held. */
  line: string;
  /** Every figure it held and holds, oldest first, where there are at least three: what a sparkline draws. */
  spark?: number[];
  /** How many values it held before this one, as far as the record keeps. */
  earlier: number;
  /** The day the record's history of it begins. */
  since?: string;
}

/**
 * The one line a field's popover adds about its past, and the figures for a
 * sparkline. Nothing where the field has held nothing before. `named` gives a
 * person's name for the address the record keeps; without it the address is
 * printed.
 */
export function fieldHistorySaid(def: CheckFieldDef, value: CheckFieldValue | undefined, lists?: (id: string) => OptionSet | undefined, named?: (by: string) => string): FieldHistorySaid | undefined {
  const history = value?.history ?? [];
  const last = history[0];
  if (!value || !last) return undefined;
  const state = fieldState(value);
  const now = state === 'not_applicable' ? 'not applicable' : standsHere(value) ? formatFieldValue(def, value, lists) : state === 'disputed' ? 'in dispute' : state === 'proposed' ? 'waiting to be accepted' : 'not recorded';
  const who = named ? named(last.by) : last.by;
  const figures = [...history].reverse().flatMap((entry) => (typeof entry.value === 'number' ? [entry.value] : []));
  if (standsHere(value) && typeof value.value === 'number') figures.push(value.value);
  const since = historySince(value);
  return {
    line: `Was ${pastSaid(def, last, lists)} on ${daySaid(indiaDayOf(last.at))}${who ? ` (${who})` : ''}; now ${now}`,
    ...(figures.length >= 3 ? { spark: figures } : {}),
    earlier: history.length,
    ...(since ? { since: indiaDayOf(since) } : {}),
  };
}

/** A value with its history cut to what a copy may hold: an entry keeps its citation only where its paper is on the copy. */
export function historyOnCopy(history: readonly FieldPast[] | undefined, paperOnCopy: (evidenceId: string) => boolean): FieldPast[] | undefined {
  if (!history) return undefined;
  return history.map((entry) => {
    if (entry.origin?.kind !== 'paper' || paperOnCopy(entry.origin.evidenceId)) return entry;
    const { origin: _origin, ...rest } = entry;
    return rest;
  });
}

/** In place of a day, on a value that is today's because the module that keeps it keeps no past at all. */
export const AS_NOW_NO_HISTORY = 'no_history';

/** The figures other modules work out that a reading as at a day turns back with the project (`projectAsAt`). Every other figure is today's. */
export function figureReadsAsAt(key: string): boolean {
  // Progress in money reads the cost register's budgets and certificates, which keep no past: it is today's.
  return /^(progress|schedule|site_log|cost_report|cash_flow)\./.test(key) && !/^progress\.(planned_value|earned_value|schedule_index|cost_index)$/.test(key);
}

/** How a value that is today's on a reading as at a past day says so. */
export function asNowSaid(asNow: string): string {
  return asNow === AS_NOW_NO_HISTORY ? 'As now: what keeps this figure keeps no history.' : `As now: no history before ${daySaid(asNow)}.`;
}
