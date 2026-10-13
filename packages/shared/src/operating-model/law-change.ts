/**
 * A change on a watched page, as fields.
 *
 * What a change means is not a summary anybody writes. It is a handful of
 * fields: what kind of instrument it is, its reference and date, the day it
 * takes effect, what sort of change it is, what a figure or a date was and
 * now is, and what it affects on a project (a field, an approval, or the row
 * of the rule table it would supersede). A model picks each from a list or
 * copies it off the page; a person reads them beside the lines that came and
 * went, corrects them and confirms.
 *
 * Three things are held to the page's own words (`lawFieldsHeld`): a
 * reference is kept only where a changed line writes it, a date only where
 * a changed line writes that day, and a figure only where a line that went
 * (for `was`) or came (for `now`) writes that number. What a change affects
 * is kept only where it names something that exists: a field of the
 * catalog, an approval the register knows, a row of the rule table.
 *
 * An action for a project is a department, a next step off a fixed list and
 * what it is about. The words on the action a project then carries are a
 * template's (`lawActionSaid`).
 *
 * A change that moves a rate or a limit names the rule row it would
 * supersede, and confirming it offers a new dated row (`offerLawRuleRow`).
 * The offered row is not verified until a person marks it so by name.
 *
 * Pure. Storage, fetching and the model are the API's.
 */

import { APPROVAL_KINDS } from './approvals';
import type { DepartmentKey } from './departments';
import { fieldCatalog, fieldDefAt, type FieldCatalog } from './field-registry';
import { departmentOfFunction } from './field-sheets';
import { RULE_ROWS } from './field-sets';
import type { FieldAddress, RuleRow } from './types';

export const LAW_INSTRUMENTS = ['act', 'rule', 'notification', 'circular', 'order', 'fee_schedule', 'form'] as const;
export type LawInstrument = (typeof LAW_INSTRUMENTS)[number];
export const LAW_INSTRUMENT_LABEL: Record<LawInstrument, string> = { act: 'Act', rule: 'Rule', notification: 'Notification', circular: 'Circular', order: 'Order', fee_schedule: 'Fee schedule', form: 'Form' };

export const LAW_CHANGE_TYPES = ['new_requirement', 'rate_changed', 'deadline_changed', 'form_changed', 'withdrawn', 'clarification'] as const;
export type LawChangeType = (typeof LAW_CHANGE_TYPES)[number];
export const LAW_CHANGE_TYPE_LABEL: Record<LawChangeType, string> = {
  new_requirement: 'New requirement',
  rate_changed: 'Rate changed',
  deadline_changed: 'Deadline changed',
  form_changed: 'Form changed',
  withdrawn: 'Withdrawn',
  clarification: 'Clarification',
};

/** What a department does about a change. A fixed list: nobody, and no model, writes an instruction. */
export const LAW_NEXT = ['review_value', 'supersede_rule_row', 'apply_for_approval', 'renew_approval', 'use_new_form', 'meet_deadline', 'read_change'] as const;
export type LawNext = (typeof LAW_NEXT)[number];
export const LAW_NEXT_LABEL: Record<LawNext, string> = {
  review_value: 'Check the value against the change',
  supersede_rule_row: 'Check the new rate and mark its row verified',
  apply_for_approval: 'Apply for the approval',
  renew_approval: 'Renew the approval',
  use_new_form: 'Use the new form',
  meet_deadline: 'Meet the new deadline',
  read_change: 'Read the change and decide what it asks',
};

/** The units a figure on a page is counted in. */
export const LAW_UNITS = ['percent', 'rupees', 'rupees_per_sqm', 'rupees_per_sqft', 'days', 'months', 'years', 'ratio', 'sqm', 'm'] as const;
export type LawUnit = (typeof LAW_UNITS)[number];
const UNIT_SAID: Record<LawUnit, (n: string) => string> = {
  percent: (n) => `${n}%`,
  rupees: (n) => `Rs ${n}`,
  rupees_per_sqm: (n) => `Rs ${n} a sq m`,
  rupees_per_sqft: (n) => `Rs ${n} a sq ft`,
  days: (n) => `${n} days`,
  months: (n) => `${n} months`,
  years: (n) => `${n} years`,
  ratio: (n) => n,
  sqm: (n) => `${n} sq m`,
  m: (n) => `${n} m`,
};

/** A figure or a day, as the page states it. One of the two. */
export interface LawFigure {
  n?: number;
  unit?: LawUnit;
  date?: string;
}

/** The identity of a rule row: enough to find it again in another build's table. */
export interface LawRuleRowRef {
  key: string;
  jurisdiction: RuleRow['jurisdiction'];
  when?: RuleRow['when'];
  from: string;
}

/** What a change affects: a field, an approval, or the rule row it would supersede. */
export type LawAbout = { kind: 'field'; address: FieldAddress } | { kind: 'approval'; approval: string } | { kind: 'rule_row'; row: LawRuleRowRef };

export interface LawChangeFields {
  instrument?: LawInstrument;
  /** Its number, as the page writes it. */
  reference?: string;
  /** The day it is dated. */
  dated?: string;
  effectiveFrom?: string;
  change?: LawChangeType;
  was?: LawFigure;
  now?: LawFigure;
  affects: LawAbout[];
}

export const LAW_REFERENCE = 120;
export const LAW_AFFECTS_AT_MOST = 8;

/* ==================================================================== */
/* The lists a model picks from                                          */
/* ==================================================================== */

/** What a model may say a change affects, each under a mark good for one asking. */
export interface LawLists {
  fields: Array<{ mark: string; address: FieldAddress; label: string }>;
  approvals: Array<{ key: string; label: string }>;
  rows: Array<{ mark: string; row: RuleRow; label: string }>;
}

export const LAW_LIST_FIELDS_AT_MOST = 160;

const sameText = (a: string | undefined, b: string | undefined): boolean => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export function lawRuleRowRef(row: RuleRow): LawRuleRowRef {
  return { key: row.key, jurisdiction: row.jurisdiction, ...(row.when ? { when: row.when } : {}), from: row.from };
}

export function lawRuleRowAt(ref: LawRuleRowRef, rows: readonly RuleRow[] = RULE_ROWS): RuleRow | undefined {
  return rows.find((row) => row.key === ref.key && row.from === ref.from && JSON.stringify(row.jurisdiction) === JSON.stringify(ref.jurisdiction) && JSON.stringify(row.when ?? {}) === JSON.stringify(ref.when ?? {}));
}

/**
 * The lists for one source: the sheets' fields of the departments it is for
 * (a sheet's, not a check's: those are where a rate, a fee, a form number or
 * a deadline is kept), every approval the register knows, and the rule rows
 * in force for where it applies.
 */
export function lawLists(source: { departments: readonly DepartmentKey[]; jurisdiction: string; about?: readonly string[] }, today: string, catalog: FieldCatalog = fieldCatalog(), rows: readonly RuleRow[] = RULE_ROWS): LawLists {
  const every: Array<{ address: FieldAddress; label: string }> = [];
  for (const [fn, sets] of catalog.sheets) {
    const desk = departmentOfFunction(fn);
    if (desk && !source.departments.includes(desk)) continue;
    for (const set of sets) {
      for (const def of set.fields) {
        if (def.retired || def.kind === 'computed' || def.kind === 'status' || def.kind === 'longtext' || def.sameAs) continue;
        every.push({ address: { fn: set.fn, set: set.id, field: def.key }, label: `${set.title}: ${def.label}` });
      }
    }
  }
  // A department keeps more fields than a model is shown at once. Any of them can be named: the ones whose sheet and label share
  // the most words with what changed on the page are the ones listed, in the catalog's order. Chosen by code, from the page's own words.
  const words = new Set((source.about ?? []).flatMap((line) => line.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  const shared = (label: string): number => (label.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => words.has(word)).length;
  const kept = every.length <= LAW_LIST_FIELDS_AT_MOST ? every : every.map((held, index) => ({ held, index, score: shared(held.label) })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, LAW_LIST_FIELDS_AT_MOST).sort((a, b) => a.index - b.index).map((ranked) => ranked.held);
  const fields: LawLists['fields'] = kept.map((held, index) => ({ mark: `f${index + 1}`, ...held }));
  const place = source.jurisdiction.trim();
  const here = rows.filter((row) => row.from <= today && (row.to === undefined || row.to >= today) && (!place || sameText(place, 'India') || !row.jurisdiction.state || sameText(row.jurisdiction.state, place) || sameText(row.jurisdiction.city, place)));
  return {
    fields,
    approvals: APPROVAL_KINDS.map((kind) => ({ key: kind.key, label: kind.label })),
    rows: here.map((row, at) => ({ mark: `r${at + 1}`, row, label: `${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}, in force from ${row.from}${row.jurisdiction.authority ? `, ${row.jurisdiction.authority}` : ''}` })),
  };
}

/* ==================================================================== */
/* Holding a model's fields to the page                                   */
/* ==================================================================== */

const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Whether a line writes this day, in any of the ways an official page does. */
export function lawDayOnPage(iso: string, lines: readonly string[]): boolean {
  if (!DAY.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const month = MONTHS[m - 1]!;
  const days = [...new Set([String(d), String(d).padStart(2, '0')])];
  const months = [...new Set([String(m), String(m).padStart(2, '0')])];
  const forms: string[] = [iso];
  for (const day of days) {
    for (const mm of months) for (const sep of ['.', '/', '-']) forms.push(`${day}${sep}${mm}${sep}${y}`, `${day}${sep}${mm}${sep}${String(y).slice(2)}`);
    for (const name of [month, month.slice(0, 3)]) for (const th of ['', 'st', 'nd', 'rd', 'th']) forms.push(`${day}${th} ${name} ${y}`, `${day}${th} ${name}, ${y}`, `${name} ${day}${th}, ${y}`, `${name} ${day}${th} ${y}`, `${day}${th} day of ${name}, ${y}`, `${day}${th} day of ${name} ${y}`);
  }
  // A form is on the line only where no digit runs on from either end of it: 1.10.2026 is not in 21.10.2026.
  return lines.some((line) => {
    const flat = squeezed(line);
    return forms.some((form) => {
      for (let at = flat.indexOf(form); at !== -1; at = flat.indexOf(form, at + 1)) {
        if (!/\d/.test(flat[at - 1] ?? '') && !/\d/.test(flat[at + form.length] ?? '')) return true;
      }
      return false;
    });
  });
}

/** Whether a line writes this number, with or without its commas. */
export function lawNumberOnPage(n: number, lines: readonly string[]): boolean {
  if (!Number.isFinite(n)) return false;
  const wanted = String(n);
  return lines.some((line) => (line.replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).some((found) => Number(found) === n || found === wanted));
}

function figureHeld(said: unknown, lines: readonly string[]): LawFigure | undefined {
  const given = (said && typeof said === 'object' ? said : {}) as { number?: unknown; n?: unknown; unit?: unknown; date?: unknown };
  const n = typeof given.number === 'number' ? given.number : typeof given.n === 'number' ? given.n : undefined;
  const unit = LAW_UNITS.find((known) => known === given.unit);
  if (n !== undefined && lawNumberOnPage(n, lines)) return { n, ...(unit ? { unit } : {}) };
  const date = typeof given.date === 'string' ? given.date.trim() : '';
  if (date && lawDayOnPage(date, lines)) return { date };
  return undefined;
}

function aboutHeld(mark: unknown, lists: LawLists): LawAbout | undefined {
  const asked = String(mark ?? '').trim().replace(/^\[|\]$/g, '');
  if (!asked) return undefined;
  const field = lists.fields.find((held) => held.mark === asked);
  if (field) return { kind: 'field', address: field.address };
  const row = lists.rows.find((held) => held.mark === asked);
  if (row) return { kind: 'rule_row', row: lawRuleRowRef(row.row) };
  const approval = lists.approvals.find((held) => held.key === asked);
  return approval ? { kind: 'approval', approval: approval.key } : undefined;
}

const aboutKey = (about: LawAbout): string => JSON.stringify(about);

/**
 * What of a model's fields is kept: a pick only where it is on its list, a
 * reference, a date and a figure only where the changed lines write them,
 * and what is affected only where it is on the lists the model was given.
 * A member that fails is left out; the rest stand. Nothing here is a
 * sentence, and none the model sends beside these is read.
 */
export function lawFieldsHeld(said: unknown, diff: { added: readonly string[]; removed: readonly string[] }, lists: LawLists): LawChangeFields {
  const given = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>;
  const lines = [...diff.added, ...diff.removed];
  const instrument = LAW_INSTRUMENTS.find((known) => known === given.instrument);
  const change = LAW_CHANGE_TYPES.find((known) => known === given.change);
  const reference = typeof given.reference === 'string' ? given.reference.replace(/\s+/g, ' ').trim().slice(0, LAW_REFERENCE) : '';
  const day = (value: unknown): string | undefined => (typeof value === 'string' && lawDayOnPage(value.trim(), lines) ? value.trim() : undefined);
  const dated = day(given.dated);
  const effectiveFrom = day(given.effective_from ?? given.effectiveFrom);
  const was = figureHeld(given.was, diff.removed);
  const now = figureHeld(given.now, diff.added);
  const affects: LawAbout[] = [];
  for (const mark of Array.isArray(given.affects) ? given.affects : []) {
    const about = aboutHeld(mark, lists);
    if (about && affects.length < LAW_AFFECTS_AT_MOST && !affects.some((held) => aboutKey(held) === aboutKey(about))) affects.push(about);
  }
  return {
    ...(instrument ? { instrument } : {}),
    ...(reference && lines.some((line) => squeezed(line).includes(squeezed(reference))) ? { reference } : {}),
    ...(dated ? { dated } : {}),
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(change ? { change } : {}),
    ...(was ? { was } : {}),
    ...(now ? { now } : {}),
    affects,
  };
}

/** Whether the fields say anything at all. */
export function lawFieldsSaySomething(fields: LawChangeFields | undefined): boolean {
  return Boolean(fields && (fields.instrument || fields.reference || fields.dated || fields.effectiveFrom || fields.change || fields.was || fields.now || fields.affects.length));
}

/** An action's `about` as a model gave it, held to the lists. */
export function lawAboutHeld(mark: unknown, lists: LawLists): LawAbout | undefined {
  return aboutHeld(mark, lists);
}

/**
 * Fields as a person sent them, checked for shape and for what they name.
 * A person has read the instrument, so their reference and dates are not
 * held to the page; what is affected still has to exist. Throws on a member
 * that is not what it should be.
 */
export function lawFieldsFrom(given: unknown, catalog: FieldCatalog = fieldCatalog(), rows: readonly RuleRow[] = RULE_ROWS): LawChangeFields {
  const sent = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, list: readonly T[], what: string): T | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const found = list.find((known) => known === value);
    if (!found) throw new Error(`${what} is not one on the list.`);
    return found;
  };
  const day = (value: unknown, what: string): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${what} is not a day.`);
    return value;
  };
  const figure = (value: unknown, what: string): LawFigure | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const held = value as LawFigure;
    if (held.n !== undefined && held.n !== null) {
      if (typeof held.n !== 'number' || !Number.isFinite(held.n)) throw new Error(`${what} is not a number.`);
      const unit = pick(held.unit, LAW_UNITS, `${what}'s unit`);
      return { n: held.n, ...(unit ? { unit } : {}) };
    }
    const date = day(held.date, what);
    return date ? { date } : undefined;
  };
  const instrument = pick(sent.instrument, LAW_INSTRUMENTS, 'The instrument');
  const change = pick(sent.change, LAW_CHANGE_TYPES, 'The kind of change');
  const reference = typeof sent.reference === 'string' ? sent.reference.replace(/\s+/g, ' ').trim().slice(0, LAW_REFERENCE) : '';
  const dated = day(sent.dated, 'The date');
  const effectiveFrom = day(sent.effectiveFrom, 'The day it takes effect');
  const was = figure(sent.was, 'What it was');
  const now = figure(sent.now, 'What it is now');
  const affects = (Array.isArray(sent.affects) ? sent.affects : []).map((about) => lawAboutFrom(about, catalog, rows));
  if (affects.length > LAW_AFFECTS_AT_MOST) throw new Error(`At most ${LAW_AFFECTS_AT_MOST} things a change affects.`);
  return { ...(instrument ? { instrument } : {}), ...(reference ? { reference } : {}), ...(dated ? { dated } : {}), ...(effectiveFrom ? { effectiveFrom } : {}), ...(change ? { change } : {}), ...(was ? { was } : {}), ...(now ? { now } : {}), affects };
}

/** One thing a change affects, as a person sent it. Throws where it names nothing that exists. */
export function lawAboutFrom(given: unknown, catalog: FieldCatalog = fieldCatalog(), rows: readonly RuleRow[] = RULE_ROWS): LawAbout {
  const about = (given && typeof given === 'object' ? given : {}) as Partial<{ kind: string; address: FieldAddress; approval: string; row: LawRuleRowRef }>;
  if (about.kind === 'field' && about.address && fieldDefAt(about.address, catalog)) {
    const set = catalog.sets.get(about.address.set)!;
    return { kind: 'field', address: { fn: set.fn, set: set.id, field: about.address.field } };
  }
  if (about.kind === 'approval' && APPROVAL_KINDS.some((kind) => kind.key === about.approval)) return { kind: 'approval', approval: about.approval! };
  if (about.kind === 'rule_row' && about.row) {
    const row = lawRuleRowAt(about.row, rows);
    if (row) return { kind: 'rule_row', row: lawRuleRowRef(row) };
  }
  throw new Error('A change affects a field, an approval or a rule row that exists.');
}

/* ==================================================================== */
/* The words, from the fields                                            */
/* ==================================================================== */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function daySaid(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${d} ${MONTH_NAMES[m - 1]} ${y}` : iso;
}

export function lawFigureSaid(figure: LawFigure | undefined): string {
  if (!figure) return '';
  if (figure.date) return daySaid(figure.date);
  if (figure.n === undefined) return '';
  const n = figure.n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  return figure.unit ? UNIT_SAID[figure.unit](n) : n;
}

/** What a thing a change affects is called, from the catalog, the register or the rule table. */
export function lawAboutSaid(about: LawAbout, catalog: FieldCatalog = fieldCatalog(), rows: readonly RuleRow[] = RULE_ROWS): string {
  if (about.kind === 'field') {
    const def = fieldDefAt(about.address, catalog);
    const set = catalog.sets.get(about.address.set);
    return def ? `${def.label}${set ? ` (${set.title})` : ''}` : 'A field this build does not declare';
  }
  if (about.kind === 'approval') return APPROVAL_KINDS.find((kind) => kind.key === about.approval)?.label ?? 'An approval this build does not know';
  return lawRuleRowAt(about.row, rows)?.label ?? `Rule row ${about.row.key}`;
}

/**
 * A change in one line, made from its fields: the instrument and its
 * reference, its date, the kind of change, what it was and now is, and when
 * it takes effect. Empty where the fields say nothing.
 */
export function lawChangeSaid(fields: LawChangeFields | undefined): string {
  if (!fields) return '';
  const head = [fields.instrument ? LAW_INSTRUMENT_LABEL[fields.instrument] : '', fields.reference ?? ''].filter(Boolean).join(' ');
  const dated = fields.dated ? `dated ${daySaid(fields.dated)}` : '';
  const moved = fields.was && fields.now ? `${lawFigureSaid(fields.was)} to ${lawFigureSaid(fields.now)}` : fields.now ? `now ${lawFigureSaid(fields.now)}` : fields.was ? `was ${lawFigureSaid(fields.was)}` : '';
  const body = [fields.change ? LAW_CHANGE_TYPE_LABEL[fields.change] : '', moved, fields.effectiveFrom ? `in force from ${daySaid(fields.effectiveFrom)}` : ''].filter(Boolean).join(', ');
  const front = [head, dated].filter(Boolean).join(', ');
  const line = [front, body].filter(Boolean).join(': ');
  return line ? `${line}.` : '';
}

/** An action as a project carries it: the next step and what it is about. */
export function lawActionSaid(action: { next?: LawNext; about?: LawAbout; title?: string }, catalog: FieldCatalog = fieldCatalog(), rows: readonly RuleRow[] = RULE_ROWS): string {
  if (!action.next) return action.title ?? '';
  return `${LAW_NEXT_LABEL[action.next]}${action.about ? `: ${lawAboutSaid(action.about, catalog, rows)}` : ''}`;
}

/* ==================================================================== */
/* The rule row a change offers                                          */
/* ==================================================================== */

/** A new dated row a confirmed change offers for the rule table. Unverified until a person marks it verified. */
export interface LawRuleRowOffer {
  id: string;
  changeId: string;
  /** The row it would supersede. */
  supersedes: LawRuleRowRef;
  row: RuleRow;
  offeredBy: string;
  offeredAt: string;
}

/**
 * The row a change offers, where it moves a rate or a limit: the row it
 * names, with the new figure, in force from the day the change takes effect
 * (the day it is dated where no other is given, the day it was seen where
 * neither is), citing the instrument and the watched page. Never verified
 * here. Undefined where the change names no row or gives no figure.
 */
export function lawRuleRowOffered(fields: LawChangeFields, change: { id: string; sourceTitle: string; url: string; seenAt: string }, by: string, now: string, rows: readonly RuleRow[] = RULE_ROWS): LawRuleRowOffer | undefined {
  const about = fields.affects.find((held): held is Extract<LawAbout, { kind: 'rule_row' }> => held.kind === 'rule_row');
  const old = about ? lawRuleRowAt(about.row, rows) : undefined;
  if (!about || !old || fields.change !== 'rate_changed' || fields.now?.n === undefined) return undefined;
  const from = fields.effectiveFrom ?? fields.dated ?? change.seenAt.slice(0, 10);
  if (from <= old.from) return undefined;
  const regulation = [fields.instrument ? LAW_INSTRUMENT_LABEL[fields.instrument] : '', fields.reference ?? ''].filter(Boolean).join(' ') || change.sourceTitle;
  return {
    id: `lrr_${change.id}`,
    changeId: change.id,
    supersedes: about.row,
    row: { key: old.key, label: old.label, jurisdiction: old.jurisdiction, ...(old.when ? { when: old.when } : {}), value: fields.now.n, ...(old.unit ? { unit: old.unit } : {}), from, source: { regulation, url: change.url }, verified: false },
    offeredBy: by,
    offeredAt: now,
  };
}

/** Mark an offered row verified, by name: the person has checked it against the instrument. */
export function verifyLawRuleRow(offers: LawRuleRowOffer[], id: string, by: string, now: string): LawRuleRowOffer {
  const offer = offers.find((held) => held.id === id);
  if (!offer) throw new Error('No offered rule row by that id.');
  if (offer.row.verified) throw new Error('This row was verified already.');
  Object.assign(offer.row, { verified: true, verifiedBy: by, verifiedOn: now.slice(0, 10) });
  return offer;
}

/**
 * The rule table with a firm's offered rows in it: each offered row beside
 * the built-in ones, and the row it supersedes ended the day before it
 * begins. What `resolveFields` is handed as its rules where the firm's rows
 * are to be read.
 */
export function ruleRowsWithOffers(offers: readonly LawRuleRowOffer[], rows: readonly RuleRow[] = RULE_ROWS): RuleRow[] {
  const dayBefore = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const ended = new Map<RuleRow, string>();
  for (const offer of offers) {
    const old = lawRuleRowAt(offer.supersedes, rows);
    if (old && (old.to === undefined || old.to >= offer.row.from)) ended.set(old, dayBefore(offer.row.from));
  }
  // A row that begins the day the row it supersedes began takes its place: the old one is left out, never kept as a row that ends before it begins.
  return [...rows.flatMap((row) => (!ended.has(row) ? [row] : ended.get(row)! < row.from ? [] : [{ ...row, to: ended.get(row)! }])), ...offers.map((offer) => offer.row)];
}

/**
 * The rule table a firm reads once it has verified rows of its own: the
 * built-in table with each verified row laid in. Undefined where none is
 * verified, so the built-in table stands. An offered row nobody has verified
 * is left out: it is a proposal, and changes no figure.
 */
export function firmRuleRows(offers: readonly LawRuleRowOffer[] | undefined, rows: readonly RuleRow[] = RULE_ROWS): RuleRow[] | undefined {
  const verified = (offers ?? []).filter((offer) => offer.row.verified);
  return verified.length ? ruleRowsWithOffers(verified, rows) : undefined;
}
