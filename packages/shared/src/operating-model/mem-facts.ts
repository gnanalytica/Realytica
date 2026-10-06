/**
 * The facts of the project's memory: what the record holds for true, value
 * by value, each with where it stands.
 *
 * An entry (`mem-delta.ts`) says that something happened. A fact says what
 * the project holds now: the extent a khata states, the stage the project is
 * at, the rate recorded on a check. Each is tagged. `approved` is a value a
 * person typed or accepted, always a person. `proposed` is a value read off
 * a paper or raised on a card that nobody has decided: it carries who read
 * it and what stands behind it, and whether it may be acted on is asked of
 * the record's own rule (`standingFacts`) when the fact is told, never
 * decided here. `thought` is the assistant's own note, written by one
 * function and never by this file; see `mem-thought.ts`.
 *
 * A fact is one slot: one value, for one key, about one thing on the record.
 * A slot whose value changes is the same fact with a new value, and what it
 * was before is kept on it as a few lines, newest first. So memory holds as
 * many facts as the record has values, however often they changed, and a
 * slot the record no longer fills is a fact memory lets go.
 *
 * `memoryFacts` is pure: the same record gives the same facts under the same
 * ids. Memory is brought to it by difference (`memFactsDiff`), so telling a
 * record step by step and telling it once at the end leave the same facts.
 * That, and not an order of events, is what makes memory rebuildable.
 *
 * What a fact may hold is decided here and nowhere else, by what the fact is
 * and not by looking for bad words in it. Its key is on a fixed list, the
 * rules' own or this file's, and its label is that list's. Its value is in
 * the form the list gives the key: a date, a number, yes or no, one of a few
 * words, or a line. A line is one line, short, with no address for mail in
 * it, no permanent account number, and no run of nine digits or more, which
 * is what an identity number, a phone number and a bank account are made of.
 * A value that is not that is not kept, and is counted. A person's name is
 * kept: a title cannot be read without the names on it.
 */

import { allChecks } from './engagements';
import { MENU_DEPARTMENTS, functionDepartment, functionKey, workstreamOfCheck } from './departments';
import type { DocumentFact, FactForm } from './document-parse';
import { acceptedFacts, proofOf, proposedFacts, standingFacts } from './fact-review';
import { CHECK_DEFINITIONS } from './libraries';
import { meetingOfRecord } from './meetings';
import { MEM_PARCEL_REF, isMemId, memHash, memKeyOfValueEvent, memPointer, memRuleOfKey, memWho } from './mem-delta';
import { checkSchema } from './operations';
import { revenueReads } from './revenue-map';
import { normalizeDigits } from '../script';
import type { AuditEvent, CheckFieldKind, DdProject, EvidenceRecord } from './types';
import { documentWorkstream } from './vault';

/** Where a fact stands. `thought` is written by `mem-thought.ts` only. */
export const MEM_FACT_TAGS = ['approved', 'proposed', 'thought'] as const;

export type MemFactTag = (typeof MEM_FACT_TAGS)[number];

/** Who read a value nobody has decided: this server's rules, a model, or the card it waits on. */
export const MEM_FACT_READERS = ['rules', 'model', 'card'] as const;

export type MemFactReader = (typeof MEM_FACT_READERS)[number];

/** What stands behind a model's value, as the reader keeps it. A value with neither is not among a paper's values, and is no fact. */
export const MEM_FACT_PROOFS = ['page_text', 'second_reader'] as const;

/** One thing that happened to a fact before now. */
export interface MemFactPast {
  at: string;
  /** What happened, in one of this file's own words. */
  what: 'accepted' | 'corrected' | 'set_aside' | 'reopened' | 'changed';
  /** Who did it, as memory names a person. */
  by: string;
  /** What the value was said to be then, as the record's trail kept it. */
  said?: string;
}

export interface MemFact {
  /** The project's id, `::fact::` (or `::thought::`), then the slot: the same slot is always the same id. */
  id: string;
  tag: MemFactTag;
  /** A key on a fixed list. */
  key: string;
  /** The name that list gives the key. Never the record's words for it. */
  label: string;
  value: string | number | boolean;
  unit?: string;
  /** The value as the record writes it for a person, where that is not the value itself. */
  display?: string;
  /** The id on the record of what the fact is about: a paper, a check, the project, a question. */
  aboutId: string;
  /** The department and function it belongs to, in the menu's own words. */
  department?: string;
  fn?: string;
  /** When it is true of the world: the period a certificate searched, the days an approval holds. */
  validFrom?: string;
  validTo?: string;
  /** When the record came to hold it. */
  recordedAt: string;
  /** Who approved it, as memory names a person, and when. */
  by?: string;
  at?: string;
  /** For a value nobody has decided: who read it, what stands behind it, and whether the record's rule lets it be acted on. */
  readBy?: MemFactReader;
  proof?: (typeof MEM_FACT_PROOFS)[number];
  stands?: boolean;
  /** The id on the record of what states it: the paper, the card, the turn. Itself, where nothing else does. */
  source: string;
  page?: number;
  /** The few words of the page that are its proof. */
  quote?: string;
  /** The id of the fact that reads the same thing differently. */
  contests?: string;
  /** What it was before, newest first. */
  was?: MemFactPast[];
}

/** How long a line may be to be a value. A paragraph is page text. */
export const MEM_VALUE_LINE = 160;

/** How long the words kept as a fact's proof may be. */
export const MEM_QUOTE_LINE = 200;

/** How many lines of its past a fact keeps. */
export const MEM_FACT_PAST = 6;

interface KeyRule {
  label: string;
  form: FactForm;
  choices?: readonly string[];
  /** How long a line under this key may be, where it is not `MEM_VALUE_LINE`. */
  atMost?: number;
}

/** How long the assistant's own note may be: a few sentences, not a page. */
export const MEM_NOTE_LINE = 400;

/**
 * The keys a fact is filed under that are not a paper's: the fields of the
 * record a person sets. With the rules' own list and the check catalogue's
 * fields, these are every key a fact may have.
 */
export const MEM_FIELD_KEYS: Record<string, KeyRule> = {
  project_title: { label: 'Project name', form: 'words' },
  project_type: { label: 'Project type', form: 'lower' },
  project_status: { label: 'Project status', form: 'lower' },
  location: { label: 'Location', form: 'words' },
  city: { label: 'City', form: 'words' },
  jurisdiction: { label: 'Jurisdiction', form: 'words' },
  site_address: { label: 'Site address', form: 'words' },
  project_owner: { label: 'Owner', form: 'words' },
  developer: { label: 'Developer', form: 'words' },
  land_area: { label: 'Land area', form: 'sqm' },
  built_up_area: { label: 'Built-up area', form: 'sqm' },
  saleable_area: { label: 'Saleable area', form: 'sqm' },
  budget: { label: 'Budget', form: 'number' },
  parcel: { label: 'Parcel', form: 'identifier' },
  tenure: { label: 'Tenure', form: 'lower' },
  portfolio: { label: 'Portfolio', form: 'words' },
  stage: { label: 'Stage', form: 'lower' },
  check_result: { label: 'Result of the check', form: 'lower' },
  comparable_price: { label: 'Price of the comparable', form: 'rupees' },
  comparable_area: { label: 'Area of the comparable', form: 'sqm' },
  comparable_date: { label: 'Date of the comparable', form: 'date' },
  answer: { label: 'Answer', form: 'words' },
  decision: { label: 'Decision', form: 'lower' },
  action: { label: 'Action', form: 'lower' },
  map_extent: { label: 'Extent on the public map', form: 'sqm' },
  map_survey: { label: 'Survey number on the public map', form: 'identifier' },
  paper_kind: { label: 'Kind of paper', form: 'words' },
  // What a person entered for a day on site, or accepted from a voice note.
  site_day: { label: 'Day of the site entry', form: 'date' },
  site_work: { label: 'Work done on site', form: 'words' },
  site_weather: { label: 'Weather on site that day', form: 'words' },
  site_manpower: { label: 'People on site that day', form: 'number' },
  site_issues: { label: 'Issues raised on site', form: 'number' },
  // A draft a person approved for sending: what it is, and who it is to as the record names them.
  outgoing_kind: { label: 'Draft approved to send', form: 'lower' },
  outgoing_to: { label: 'Addressed to', form: 'words' },
  // A paper a person marked reviewed on the review table.
  paper_reviewed: { label: 'Reviewed', form: 'yes_no' },
  note: { label: 'Note', form: 'words', atMost: MEM_NOTE_LINE },
};

/** The form a check field's kind gives its value, for the kinds that hold one value. A table, a list or a paragraph is not a value. */
const CHECK_FORM: Partial<Record<CheckFieldKind, FactForm>> = {
  text: 'words',
  number: 'number',
  money: 'rupees',
  area: 'sqm',
  percent: 'number',
  duration: 'number',
  date: 'date',
  boolean: 'yes_no',
  enum: 'words',
};

/** The check catalogue's fields that hold one value, by key. A key can be a field of several checks, each with a label of its own. */
let catalogue: Map<string, KeyRule[]> | undefined;

function catalogueFields(key: string): readonly KeyRule[] {
  if (!catalogue) {
    catalogue = new Map();
    for (const definition of CHECK_DEFINITIONS) {
      for (const field of definition.fields ?? []) {
        const form = CHECK_FORM[field.kind];
        if (!form) continue;
        const rule: KeyRule = { label: field.label, form, ...(field.kind === 'enum' && field.options ? { choices: field.options } : {}) };
        catalogue.set(field.key, [...(catalogue.get(field.key) ?? []), rule]);
      }
    }
  }
  return catalogue.get(key) ?? [];
}

/**
 * The rule for a key: the rules' list first, then this file's, then the
 * check catalogue's field of that key. Where several checks have a field of
 * the key, `label` says which, and a label the catalogue does not give the
 * key picks none of them.
 */
function ruleOf(key: string, label?: string): KeyRule | undefined {
  const rule = memRuleOfKey(key);
  if (rule) return rule;
  if (Object.hasOwn(MEM_FIELD_KEYS, key)) return MEM_FIELD_KEYS[key];
  const fields = catalogueFields(key);
  return fields.find((field) => field.label === label) ?? fields[0];
}

/** The form the fixed lists give a key's value, or nothing for a key on none of them. `label` says which field, where several checks have one of the key. */
export function memFormOfKey(key: string, label?: string): FactForm | undefined {
  return ruleOf(key, label)?.form;
}

const MAIL = /@/;
const ACCOUNT_NUMBER = /(?<![A-Za-z0-9])[A-Za-z]{5}[\s-]*\d{4}[\s-]*[A-Za-z](?![A-Za-z0-9])/;
/** Nine digits or more with nothing between them but what a number is spaced with: an identity number, a phone number, a bank account. */
const LONG_NUMBER = /\d(?:[\s().+-]*\d){8,}/;

/** One line of the record's words as a fact may keep it, or nothing: trimmed, short, and none of what is never kept. */
export function memLine(text: unknown, atMost = MEM_VALUE_LINE): string | undefined {
  if (typeof text !== 'string') return undefined;
  const line = text.trim();
  if (!line || line.length > atMost || /[\r\n\t]/.test(line)) return undefined;
  const plain = normalizeDigits(line);
  if (MAIL.test(plain) || ACCOUNT_NUMBER.test(plain) || LONG_NUMBER.test(plain)) return undefined;
  return line;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const head = value.slice(0, 10);
  return DAY.test(head) && !Number.isNaN(Date.parse(head)) ? head : undefined;
}

function instant(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** A value in the form its key takes, or nothing when it is not that. */
function valueInForm(value: unknown, rule: KeyRule): MemFact['value'] | undefined {
  switch (rule.form) {
    case 'date':
      return day(value);
    case 'rupees':
    case 'sqm':
    case 'feet':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'yes_no':
      return typeof value === 'boolean' ? value : undefined;
    case 'identifier':
      return memLine(value, 80);
    default: {
      const line = memLine(value, rule.atMost);
      if (line === undefined || !rule.choices) return line;
      return rule.choices.find((choice) => choice.toLowerCase() === line.toLowerCase());
    }
  }
}

const WHO = /^who_[0-9a-f]{14}$/;
const PAST = ['accepted', 'corrected', 'set_aside', 'reopened', 'changed'];

/**
 * A fact as it may be kept, or nothing when it cannot be made one.
 *
 * Applied where facts are told and again by the one function that writes to
 * memory, whoever made the fact. Only a fact's own properties are carried.
 * The label is never the caller's words: it is the fixed list's for the key,
 * or one the check catalogue gives a field of that key.
 */
export function scrubMemFact(projectId: string, fact: MemFact): MemFact | undefined {
  if (typeof fact.id !== 'string' || !isMemId(fact.id)) return undefined;
  const thought = fact.tag === 'thought';
  if (!fact.id.startsWith(`${projectId}::${thought ? 'thought' : 'fact'}::`)) return undefined;
  if (!MEM_FACT_TAGS.includes(fact.tag)) return undefined;
  // A note is filed under the one key notes have, and nothing else is.
  if (thought !== (fact.key === 'note')) return undefined;
  const rule = ruleOf(fact.key, fact.label);
  if (!rule) return undefined;
  const value = valueInForm(fact.value, rule);
  if (value === undefined) return undefined;
  const aboutId = memPointer(projectId, fact.aboutId);
  const source = memPointer(projectId, fact.source);
  const recordedAt = instant(fact.recordedAt);
  if (!aboutId || !source || !recordedAt) return undefined;

  // The menu's own words for a place: a function it has, and that function's department, or a department alone.
  const fn = typeof fact.fn === 'string' && functionDepartment(fact.fn) ? fact.fn : undefined;
  const department = fn ? functionDepartment(fn) : MENU_DEPARTMENTS.find((key) => key === fact.department);
  const placed = { ...(department ? { department } : {}), ...(fn ? { fn } : {}) };
  // A note is a sentence, what it is about, where it was left and the reply it came from. Nobody approved it and nothing read it.
  if (thought) return { id: fact.id, tag: 'thought', key: fact.key, label: rule.label, value, aboutId, ...placed, recordedAt, source };

  const who = (name: unknown): string | undefined => (typeof name === 'string' && name ? (WHO.test(name) ? name : memWho(projectId, name)) : undefined);
  const unit = memLine(fact.unit, 20);
  const display = memLine(fact.display, 80);
  const by = who(fact.by);
  const at = instant(fact.at);
  const quote = memLine(fact.quote, MEM_QUOTE_LINE);
  const contests = memPointer(projectId, fact.contests);
  const was = (Array.isArray(fact.was) ? fact.was : [])
    .flatMap((past): MemFactPast[] => {
      const when = instant(past?.at);
      const whose = who(past?.by);
      if (!when || !whose || !PAST.includes(past.what)) return [];
      const said = memLine(past.said, 80);
      return [{ at: when, what: past.what, by: whose, ...(said ? { said } : {}) }];
    })
    .slice(0, MEM_FACT_PAST);
  return {
    id: fact.id,
    tag: fact.tag,
    key: fact.key,
    label: rule.label,
    value,
    ...(unit ? { unit } : {}),
    ...(display && display !== String(value) ? { display } : {}),
    aboutId,
    ...placed,
    ...(day(fact.validFrom) ? { validFrom: day(fact.validFrom) } : {}),
    ...(day(fact.validTo) ? { validTo: day(fact.validTo) } : {}),
    recordedAt,
    // Only a person approves, and only an approved fact says who and when.
    ...(by && fact.tag === 'approved' ? { by } : {}),
    ...(at && fact.tag === 'approved' ? { at } : {}),
    ...(fact.tag === 'proposed' && MEM_FACT_READERS.includes(fact.readBy as MemFactReader) ? { readBy: fact.readBy } : {}),
    ...(MEM_FACT_PROOFS.includes(fact.proof as (typeof MEM_FACT_PROOFS)[number]) ? { proof: fact.proof } : {}),
    ...(fact.tag === 'proposed' ? { stands: fact.stands === true } : {}),
    source,
    ...(typeof fact.page === 'number' && Number.isInteger(fact.page) && fact.page > 0 && fact.page < 100_000 ? { page: fact.page } : {}),
    ...(quote ? { quote } : {}),
    ...(contests ? { contests } : {}),
    ...(was.length ? { was } : {}),
  };
}

/** Why a value the record holds was not made a fact. */
export interface MemFactsWithheld {
  /** Under a key that is on no fixed list. */
  offList: number;
  /** Not in the form its key takes, or not a single short line. */
  notAValue: number;
}

export interface MemFacts {
  /** Every fact the record gives, in the order of their ids. */
  held: MemFact[];
  /** How many values the record holds that were not made facts, and why. */
  withheld: MemFactsWithheld;
}

/** The audit trail by what each event is about, in the order it was written. */
interface Trail {
  of(entityType: string, entityId: string): readonly AuditEvent[];
  last(entityType: string, entityId: string, action: string): AuditEvent | undefined;
}

function trailOf(project: DdProject): Trail {
  const by = new Map<string, AuditEvent[]>();
  for (const event of project.audit ?? []) {
    const about = `${event.entityType}\n${event.entityId}`;
    const held = by.get(about);
    if (held) held.push(event);
    else by.set(about, [event]);
  }
  const of = (entityType: string, entityId: string): readonly AuditEvent[] => by.get(`${entityType}\n${entityId}`) ?? [];
  return {
    of,
    last: (entityType, entityId, action) => {
      const events = of(entityType, entityId);
      for (let i = events.length - 1; i >= 0; i -= 1) if (events[i]!.action === action) return events[i];
      return undefined;
    },
  };
}

/** A fact before it has its id and has been scrubbed: what a part of the record says of one slot. */
interface Told extends Omit<MemFact, 'id' | 'label' | 'value' | 'department'> {
  slot: string;
  value: unknown;
  /** For a check's own field, the catalogue's label for it. */
  label?: string;
}

/** The department and function a workstream is, in the menu's words. */
function placeOf(workstream: string | undefined): Pick<Told, 'fn'> {
  if (!workstream) return {};
  const fn = functionKey(workstream);
  return functionDepartment(fn) ? { fn } : {};
}

/** The part of an audit line after its label: "Extent per khata: 11,850 sq ft" says 11,850 sq ft. */
function saidOf(line: string | undefined): string | undefined {
  if (!line) return undefined;
  const at = line.indexOf(': ');
  return at === -1 ? undefined : line.slice(at + 2);
}

const VALUE_EVENTS: Record<string, MemFactPast['what']> = {
  accept_fact: 'accepted',
  accept_fact_corrected: 'corrected',
  set_aside_fact: 'set_aside',
  reopen_fact: 'reopened',
};

/** The keys under which a paper states the day it holds from, and the day it holds until. */
const HOLDS_FROM = ['ec_from', 'issued_on', 'sanction_date', 'rera_approved_on', 'oc_date', 'conversion_date'];
const HOLDS_UNTIL = ['ec_to', 'valid_until', 'rera_valid_until'];

const KIND_EVENTS: Record<string, MemFactPast['what']> = {
  type_confirmed: 'accepted',
  type_corrected: 'corrected',
  type_refused: 'set_aside',
};

/**
 * What a paper is. The kind on its row is approved where the trail says a
 * person confirmed or corrected it to that. Where the row was read and nobody
 * has said, it is the rules' reading, which the record acts on. A paper typed
 * by hand with nothing read off it has nobody on record as saying so, and is
 * not told. The kind a model offers and nobody has answered waits beside it.
 */
function kindFacts(project: DdProject, row: EvidenceRecord, trail: Trail): Told[] {
  if (!row.documentType && !row.proposedDocumentType) return [];
  const events = trail.of('evidence', row.id).filter((event) => KIND_EVENTS[event.action]);
  const was = [...events].reverse().map((event) => ({ at: event.at, what: KIND_EVENTS[event.action]!, by: event.actor, said: event.newValue }));
  const about = { key: 'paper_kind', aboutId: row.id, ...placeOf(documentWorkstream(project, row)), source: row.id };
  const readAt = row.modelReadAt ?? row.createdAt;
  const told: Told[] = [];
  if (row.documentType) {
    const said = [...events].reverse().find((event) => event.action !== 'type_refused' && event.newValue === row.documentType);
    if (said) told.push({ ...about, slot: `${row.id}::paper_kind`, tag: 'approved', value: row.documentType, recordedAt: said.at, by: said.actor, at: said.at, was });
    else if (row.readMethod) told.push({ ...about, slot: `${row.id}::paper_kind`, tag: 'proposed', value: row.documentType, recordedAt: readAt, readBy: 'rules', stands: true, was });
  }
  if (row.proposedDocumentType) {
    told.push({ ...about, slot: `${row.id}::paper_kind::offer`, tag: 'proposed', value: row.proposedDocumentType, recordedAt: readAt, readBy: 'model', stands: false, ...(told.length ? {} : { was }) });
  }
  return told;
}

/** What a paper states: each value a person accepted, and each read and waiting. */
function paperFacts(project: DdProject, row: EvidenceRecord, trail: Trail): Told[] {
  const accepted = acceptedFacts(row);
  const waiting = proposedFacts(row);
  if (!accepted.length && !waiting.length) return [];
  // Asked of the record's own rule, whatever that rule is this week.
  const standing = new Set(standingFacts(row));
  const dayUnder = (keys: readonly string[]): string | undefined => {
    for (const fact of standing) if (keys.includes(fact.key) && day(fact.value)) return day(fact.value);
    return undefined;
  };
  const validFrom = dayUnder(HOLDS_FROM);
  const validTo = dayUnder(HOLDS_UNTIL);
  const place = placeOf(documentWorkstream(project, row));

  // What the trail says was decided about each key of this paper, newest first.
  const past = new Map<string, MemFactPast[]>();
  for (const event of trail.of('evidence', row.id)) {
    const what = VALUE_EVENTS[event.action];
    if (!what) continue;
    const key = memKeyOfValueEvent(project, event);
    if (!key) continue;
    past.set(key, [{ at: event.at, what, by: event.actor, said: saidOf(event.newValue ?? event.oldValue) }, ...(past.get(key) ?? [])]);
  }

  const told: Told[] = [];
  const seen = new Map<string, number>();
  const slotOf = (key: string, role: string): string => {
    const base = `${row.id}::${key}::${role}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}~${n}` : base;
  };
  const read = (fact: Omit<DocumentFact, 'otherReading'>, role: string): Told => ({
    slot: slotOf(fact.key, role),
    tag: 'proposed',
    key: fact.key,
    value: fact.value,
    unit: fact.unit,
    display: fact.display,
    aboutId: row.id,
    ...place,
    validFrom,
    validTo,
    recordedAt: row.modelReadAt ?? row.createdAt,
    source: row.id,
    page: fact.page,
    quote: fact.quote,
  });
  const proof = (fact: Omit<DocumentFact, 'otherReading'>): Told['proof'] => {
    const kept = proofOf(fact);
    return kept === 'unverified' ? undefined : kept;
  };

  for (const fact of accepted) {
    told.push({
      ...read(fact, 'a'),
      tag: 'approved',
      recordedAt: fact.decidedAt ?? row.modelReadAt ?? row.createdAt,
      by: fact.decidedBy,
      at: fact.decidedAt,
      proof: proof(fact),
    });
  }
  for (const fact of waiting) {
    const mine: Told = { ...read(fact, 'r'), readBy: fact.source === 'model' ? 'model' : 'rules', proof: proof(fact), stands: standing.has(fact) };
    told.push(mine);
    if (!fact.otherReading) continue;
    // Two readers read the same thing differently. Each is a reading of its own, and names the other.
    const other = fact.otherReading;
    const theirs: Told = { ...read(other, 'o'), readBy: other.source === 'model' ? 'model' : 'rules', proof: proof(other), stands: false };
    mine.contests = `${project.id}::fact::${theirs.slot}`;
    theirs.contests = `${project.id}::fact::${mine.slot}`;
    told.push(theirs);
  }
  // A key's past is kept once, on the value that is in force, or on the one waiting where none is.
  for (const [key, lines] of past) {
    const holder = told.find((fact) => fact.key === key && fact.tag === 'approved') ?? told.find((fact) => fact.key === key);
    if (holder) holder.was = lines;
  }
  return told;
}

/** What is recorded on the checks: each field's value with who recorded it, and each result. */
function checkFacts(project: DdProject, trail: Trail): Told[] {
  const told: Told[] = [];
  for (const check of allChecks(project)) {
    const place = placeOf(workstreamOfCheck(check.definitionId));
    const fields = new Map(checkSchema(check).fields.map((field) => [field.key, field]));
    for (const [key, held] of Object.entries(check.fields ?? {})) {
      const field = fields.get(key);
      const form = field ? CHECK_FORM[field.kind] : undefined;
      // A field that holds a table, a list, a paragraph or a sum worked out from the others holds no value of its own.
      if (field && !form) continue;
      told.push({
        slot: `${check.id}::${key}`,
        tag: 'approved',
        key,
        label: field?.label,
        value: held.value,
        unit: field?.unit,
        aboutId: check.id,
        ...place,
        recordedAt: held.at,
        by: held.by,
        at: held.at,
        source: held.sourceEvidenceId ?? check.id,
        page: held.page,
        quote: held.quote,
      });
    }
    if (check.result === 'pending') continue;
    const decided = trail.last('check', check.id, 'check_result');
    told.push({
      slot: `${check.id}::check_result`,
      tag: 'approved',
      key: 'check_result',
      value: check.result,
      aboutId: check.id,
      ...place,
      recordedAt: decided?.at ?? check.updatedAt,
      by: decided?.actor,
      at: decided?.at,
      source: check.id,
    });
  }
  return told;
}

/** The project's own fields, by the key each is told under. */
const PROJECT_FIELDS: ReadonlyArray<[field: keyof DdProject, key: string]> = [
  ['name', 'project_title'],
  ['type', 'project_type'],
  ['status', 'project_status'],
  ['location', 'location'],
  ['city', 'city'],
  ['jurisdiction', 'jurisdiction'],
  ['siteAddress', 'site_address'],
  ['owner', 'project_owner'],
  ['developer', 'developer'],
  ['landAreaSqm', 'land_area'],
  ['builtUpAreaSqm', 'built_up_area'],
  ['saleableAreaSqm', 'saleable_area'],
  ['budget', 'budget'],
  ['parcelId', 'parcel'],
  ['tenure', 'tenure'],
  ['portfolio', 'portfolio'],
];

/** The fields of a project an audit event says it changed, where the event says. */
function fieldsOf(event: AuditEvent): readonly string[] {
  return Array.isArray(event.fields) ? event.fields.filter((field): field is string => typeof field === 'string') : [];
}

/** What a person has put on the project itself: its fields as they stand, and the stage it is at. */
function projectFacts(project: DdProject, trail: Trail): Told[] {
  const told: Told[] = [];
  const own = trail.of('project', project.id);
  const patches = own.filter((event) => event.action === 'patch');
  const created = own.find((event) => event.action === 'create');
  // The trail names the fields a change touched only on events written since it began to. A project never changed since it was made is its maker's, whole.
  const untouched = patches.length === 0;
  for (const [field, key] of PROJECT_FIELDS) {
    const value = project[field];
    if (value === undefined || value === null || value === '') continue;
    const sourced = (project.valueSources as Record<string, { evidenceId?: string; page?: number; at: string; by: string }> | undefined)?.[field];
    const changed = [...patches].reverse().find((event) => fieldsOf(event).includes(field));
    const who = sourced ?? (changed ? { by: changed.actor, at: changed.at } : untouched && created ? { by: created.actor, at: created.at } : undefined);
    told.push({
      slot: `${project.id}::${key}`,
      tag: 'approved',
      key,
      value,
      unit: key === 'budget' ? project.currency : undefined,
      aboutId: project.id,
      recordedAt: who?.at ?? project.createdAt,
      by: who?.by,
      at: who?.at,
      source: sourced?.evidenceId ?? project.id,
      page: sourced?.page,
    });
  }
  const moves = own.filter((event) => event.action === 'stage_change');
  const last = moves[moves.length - 1];
  told.push({
    slot: `${project.id}::stage`,
    tag: 'approved',
    key: 'stage',
    value: project.currentStage,
    aboutId: project.id,
    recordedAt: last?.at ?? project.createdAt,
    by: last?.actor ?? created?.actor,
    at: last?.at ?? created?.at,
    source: project.id,
    was: moves
      .slice(0, -1)
      .reverse()
      .map((event) => ({ at: event.at, what: 'changed' as const, by: event.actor, said: event.newValue })),
  });
  return told;
}

/** What a draft that goes out is called for a person, by its kind. The product's own words. */
const DRAFT_SAID: Record<string, string> = { letter: 'Letter', reply: 'Reply', rfi: 'Request for information', minutes: 'Minutes' };

/**
 * What a person entered for a day on site: an entry of the site log, typed
 * there or proposed from a voice note and accepted. The day, the work done,
 * the weather, how many people were there and how many issues were raised,
 * each in the form its key takes. It holds for that day. Work said over
 * several lines is one line where it fits one, and is not kept where it does
 * not. A model's reading of a voice note is on a card until a person accepts
 * it, and is no fact before that.
 */
function siteFacts(project: DdProject): Told[] {
  const told: Told[] = [];
  for (const entry of project.siteLog ?? []) {
    const about = {
      tag: 'approved' as const,
      aboutId: entry.id,
      ...placeOf('construction.progress'),
      validFrom: entry.date,
      validTo: entry.date,
      recordedAt: entry.createdAt,
      by: entry.author,
      at: entry.createdAt,
      source: entry.id,
    };
    told.push({ ...about, slot: `${entry.id}::site_day`, key: 'site_day', value: entry.date });
    const work = (entry.workDone ?? '')
      .split(/\s*[\r\n]+\s*/)
      .filter(Boolean)
      .join('; ');
    if (work) told.push({ ...about, slot: `${entry.id}::site_work`, key: 'site_work', value: work });
    if (entry.weather?.trim()) told.push({ ...about, slot: `${entry.id}::site_weather`, key: 'site_weather', value: entry.weather });
    const people = (entry.manpower ?? []).reduce((sum, row) => sum + (Number.isFinite(row.count) ? row.count : 0), 0);
    if (people > 0) told.push({ ...about, slot: `${entry.id}::site_manpower`, key: 'site_manpower', value: people });
    if (entry.issues?.length) told.push({ ...about, slot: `${entry.id}::site_issues`, key: 'site_issues', value: entry.issues.length });
  }
  return told;
}

/**
 * A draft a person approved for sending: what it is, and who it is to as the
 * record names them, with who approved it and when. What states it is the
 * paper, the meeting or the action it is about, where it is about one. A
 * draft nobody has approved, or one put back to draft, is no fact: its words
 * are a drafter's, a model's among them, and nothing reads them as true.
 */
function outgoingFacts(project: DdProject): Told[] {
  const told: Told[] = [];
  const onRecord = new Set<string>([...project.evidence.map((row) => row.id), ...(project.meetings ?? []).map((meeting) => meeting.id), ...project.actions.map((action) => action.id)]);
  for (const draft of project.outgoing ?? []) {
    if (draft.status !== 'approved' || !draft.approvedBy || !draft.approvedAt) continue;
    const about = {
      tag: 'approved' as const,
      aboutId: draft.id,
      recordedAt: draft.approvedAt,
      by: draft.approvedBy,
      at: draft.approvedAt,
      source: draft.about && onRecord.has(draft.about.id) ? draft.about.id : draft.id,
    };
    told.push({ ...about, slot: `${draft.id}::outgoing_kind`, key: 'outgoing_kind', value: draft.kind, display: DRAFT_SAID[draft.kind] });
    if (draft.to?.trim()) told.push({ ...about, slot: `${draft.id}::outgoing_to`, key: 'outgoing_to', value: draft.to });
  }
  return told;
}

/**
 * The papers a person marked reviewed on the review table, each with who and
 * when. A mark taken off is a fact let go. The table's answers are not here
 * and are told nowhere: a model's answer to a question, or a search's, is
 * not a value of the record, whoever looked at it.
 */
function reviewedFacts(project: DdProject): Told[] {
  const told: Told[] = [];
  const marks = project.reviewTable?.reviewed ?? {};
  for (const row of project.evidence) {
    const mark = marks[row.id];
    if (!mark) continue;
    told.push({ slot: `${row.id}::paper_reviewed`, tag: 'approved', key: 'paper_reviewed', value: true, aboutId: row.id, ...placeOf(documentWorkstream(project, row)), recordedAt: mark.at, by: mark.by, at: mark.at, source: row.id });
  }
  return told;
}

/** What else a person has recorded: comparables accepted, answers given, decisions and actions, and the reads kept off the public map. */
function recordFacts(project: DdProject, trail: Trail): Told[] {
  const told: Told[] = [];
  const made = (entityType: string, entityId: string): AuditEvent | undefined => trail.of(entityType, entityId).find((event) => event.action === 'create');

  for (const comparable of project.comparables ?? []) {
    if (comparable.status !== 'accepted') continue;
    const who = { by: comparable.decidedBy ?? comparable.addedBy, at: comparable.decidedAt ?? comparable.addedAt };
    const about = { tag: 'approved' as const, aboutId: comparable.id, fn: 'finance.valuation', recordedAt: who.at, ...who, source: comparable.evidenceId ?? comparable.id };
    told.push({ ...about, slot: `${comparable.id}::comparable_price`, key: 'comparable_price', value: comparable.price });
    told.push({ ...about, slot: `${comparable.id}::comparable_area`, key: 'comparable_area', value: comparable.areaSqm, unit: 'sqm' });
    if (comparable.date) told.push({ ...about, slot: `${comparable.id}::comparable_date`, key: 'comparable_date', value: comparable.date });
  }

  for (const questionnaire of project.questionnaires ?? []) {
    for (const question of questionnaire.questions) {
      if (!question.answer?.trim()) continue;
      // An answer a model suggested waits until a person confirms it.
      const waits = question.suggested === true;
      // The paper behind it, where it names one that is on the file: the first it gives, with its page and its words.
      const behind = question.proof?.find((proof) => project.evidence.some((row) => row.id === proof.evidenceId));
      told.push({
        slot: `${question.id}::answer`,
        tag: waits ? 'proposed' : 'approved',
        key: 'answer',
        value: question.answer,
        aboutId: question.id,
        recordedAt: question.answeredAt ?? questionnaire.updatedAt,
        ...(waits ? { readBy: 'model' as const, stands: false } : { by: question.answeredBy, at: question.answeredAt }),
        source: behind?.evidenceId ?? question.id,
        ...(behind ? { page: behind.page, quote: behind.quote } : {}),
      });
    }
  }

  // A decision or an action made from a meeting's notes is stated by the meeting, in the words of its notes. Any other states itself.
  const statedBy = (recordId: string): { source: string; quote?: string } => {
    const from = meetingOfRecord(project, recordId);
    return from ? { source: from.meeting.id, quote: from.item.quote } : { source: recordId };
  };
  for (const decision of project.decisions ?? []) {
    const event = made('decision', decision.id);
    told.push({ slot: `${decision.id}::decision`, tag: 'approved', key: 'decision', value: decision.decisionType, aboutId: decision.id, recordedAt: decision.createdAt, by: event?.actor, at: event?.at, ...statedBy(decision.id) });
  }
  for (const action of project.actions ?? []) {
    const event = made('action', action.id);
    told.push({ slot: `${action.id}::action`, tag: 'approved', key: 'action', value: action.kind, aboutId: action.id, recordedAt: event?.at ?? project.createdAt, by: event?.actor, at: event?.at, ...statedBy(action.id) });
  }

  for (const read of revenueReads(project)) {
    if (!MEM_PARCEL_REF.test(read.parcelRef)) continue;
    const kept = [...trail.of('project', project.id)].reverse().find((event) => event.action === 'patch' && event.newValue === `revenueMap ${read.parcelRef}`);
    const about = { tag: 'approved' as const, aboutId: read.parcelRef, recordedAt: read.readAt, by: kept?.actor, at: kept?.at, source: read.parcelRef };
    told.push({ ...about, slot: `${read.parcelRef}::map_survey`, key: 'map_survey', value: read.surveyNo });
    told.push({ ...about, slot: `${read.parcelRef}::map_extent`, key: 'map_extent', value: read.areaSqm, unit: 'sqm' });
  }
  return told;
}

/** What waits on a card raised in chat: values offered for a check's fields, and for the project's own. */
function cardFacts(project: DdProject): Told[] {
  const told: Told[] = [];
  const checks = new Map(allChecks(project).map((check) => [check.id, check]));
  for (const card of project.chatProposals ?? []) {
    if (card.status !== 'proposed') continue;
    const waits = { tag: 'proposed' as const, readBy: 'card' as const, stands: false, recordedAt: card.createdAt, source: card.id };
    if (card.kind === 'record_check_fields') {
      const check = checks.get(String(card.payload.checkId));
      if (!check) continue;
      const fields = new Map(checkSchema(check).fields.map((field) => [field.key, field]));
      const decided = (card.payload.decided ?? {}) as Record<string, unknown>;
      const cited = (card.payload.citations ?? {}) as Record<string, { page?: number; quote?: string }>;
      for (const [key, value] of Object.entries((card.payload.values ?? {}) as Record<string, unknown>)) {
        if (decided[key]) continue;
        const field = fields.get(key);
        const form = field ? CHECK_FORM[field.kind] : undefined;
        if (field && !form) continue;
        told.push({
          ...waits,
          slot: `${check.id}::${key}::card::${card.id}`,
          key,
          label: field?.label,
          value,
          unit: field?.unit,
          aboutId: check.id,
          ...placeOf(workstreamOfCheck(check.definitionId)),
          page: cited[key]?.page,
          quote: cited[key]?.quote,
        });
      }
    } else if (card.kind === 'patch_project') {
      for (const [field, key] of PROJECT_FIELDS) {
        const value = card.payload[field];
        if (value === undefined || value === null || value === '') continue;
        told.push({ ...waits, slot: `${project.id}::${key}::card::${card.id}`, key, value, aboutId: project.id });
      }
    }
  }
  return told;
}

/**
 * Every fact this copy of the record gives.
 *
 * Pure: nothing but the record is read, and the same record gives the same
 * facts under the same ids, in the order of the ids. A value that may not be
 * kept is left out and counted.
 */
export function memoryFacts(project: DdProject): MemFacts {
  const trail = trailOf(project);
  const told = [
    ...project.evidence.flatMap((row) => [...kindFacts(project, row, trail), ...paperFacts(project, row, trail)]),
    ...checkFacts(project, trail),
    ...projectFacts(project, trail),
    ...recordFacts(project, trail),
    ...siteFacts(project),
    ...outgoingFacts(project),
    ...reviewedFacts(project),
    ...cardFacts(project),
  ];
  const withheld: MemFactsWithheld = { offList: 0, notAValue: 0 };
  const facts = new Map<string, MemFact>();
  for (const { slot, ...fact } of told) {
    if (!ruleOf(fact.key, fact.label)) {
      withheld.offList += 1;
      continue;
    }
    const id = `${project.id}::fact::${slot}`;
    const clean = scrubMemFact(project.id, { ...fact, id, label: fact.label ?? '' } as MemFact);
    if (!clean) withheld.notAValue += 1;
    else if (!facts.has(id)) facts.set(id, clean);
  }
  return { held: [...facts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), withheld };
}

/** A fact's own digest: two facts with the same one say the same thing. */
export function memFactRev(fact: MemFact): string {
  const ordered = Object.fromEntries(Object.entries(fact).sort(([a], [b]) => (a < b ? -1 : 1)));
  return memHash(JSON.stringify(ordered));
}

/** One digest for a set of facts, from each one's id and its own digest. Nothing for none. */
export function memFactsRev(index: ReadonlyMap<string, string>): string | undefined {
  if (index.size === 0) return undefined;
  return memHash([...index].map(([id, rev]) => `${id}=${rev}`).sort().join('\n'));
}

export interface MemFactsDiff {
  /** The facts memory does not hold as the record now gives them. */
  put: MemFact[];
  /** The ids of facts memory holds that the record no longer gives. */
  drop: string[];
  /** What memory holds once these are written: each fact's id and its digest. */
  index: Map<string, string>;
  /** True when more facts differ than one write takes: the difference from `index` tells them. */
  more?: true;
}

/**
 * What to write to bring the facts memory holds to the facts the record
 * gives. `held` is each fact memory has from the record, by id, with its
 * digest. At most `atMost` facts are put at once, so a long record's first
 * telling is not one write.
 */
export function memFactsDiff(facts: readonly MemFact[], held: ReadonlyMap<string, string>, atMost: number): MemFactsDiff {
  const index = new Map(held);
  const given = new Set(facts.map((fact) => fact.id));
  const drop = [...held.keys()].filter((id) => !given.has(id));
  for (const id of drop) index.delete(id);
  const put: MemFact[] = [];
  let more = false;
  for (const fact of facts) {
    const rev = memFactRev(fact);
    if (held.get(fact.id) === rev) continue;
    if (put.length >= Math.max(1, atMost)) {
      more = true;
      break;
    }
    put.push(fact);
    index.set(fact.id, rev);
  }
  return { put, drop, index, ...(more ? { more: true as const } : {}) };
}
