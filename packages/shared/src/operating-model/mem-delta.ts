/**
 * What the project's memory is told, from the record.
 *
 * Memory is kept in the graph store, beside the graph and apart from it. Its
 * ground is an entry for every event that changes what a project knows: a
 * paper filed, a value accepted, a question asked. This file is the rule
 * that turns the record into those entries. It is pure, so that two builds
 * given the same record tell the same entries under the same ids, and
 * telling an entry twice is telling it once.
 *
 * The record is not told whole each time. Memory holds a watermark: the last
 * audit event and the last chat turn it was told, and the shape it was told
 * them in. `memoryDelta` answers what comes after. A copy of the project that
 * does not hold what the watermark names is an older copy, or a record that
 * has lost that event, and tells nothing: the caller is the one who can ask
 * the project store which.
 *
 * What an entry holds is who, when, what kind of event, and the ids of the
 * records it is about. It never holds what a page says, what was said in a
 * chat, a file, or a value, and it holds no words of the record's, with one
 * exception: the key of a parcel read off the public map, which the record
 * itself keeps the read under and which names land and no person. Every
 * other word in an entry is one of this product's own fixed lists, the name
 * the list of value keys gives a key and the names the menu gives its
 * pages. A reader gets titles by looking the ids up on the record as it
 * stands, so a title corrected on the record is corrected in every entry
 * that points at it, and a record a reader may not see stays an id they
 * cannot resolve. `scrubMemEntry` is what keeps an entry to that. It is
 * applied here, and again by the one function that writes to memory.
 */

import { menuPlaceOfWords } from './chat-places';
import { isProjectCockpitPane } from './cockpit';
import { RULES_FACT_KEYS, STANDARD_FACT_KEYS, type FactForm } from './document-parse';
import { isPaneWriteReply } from './sitting';
import type { MemFact } from './mem-facts';
import type { AuditEvent, DdProject, ProjectChatTurn } from './types';

/**
 * The shape of memory this build writes. It is raised with every change to
 * what an entry holds or to which events are told. A project's memory says
 * which shape it holds. A build with a lower one stands down rather than
 * write an older shape over a newer. A build with a higher one that may
 * raise it lets the project's entries go and tells the whole record again,
 * so that no entry stays as an earlier rule wrote it. Which build may raise
 * is `shapeRule` in the API's `graph/mem/types.ts`.
 *
 * 2: a work-pane note is one entry of its own kind, where it was a question
 * and an answer; a map read points at a parcel only by a key of the fixed
 * form.
 * 3: facts. Beside the entries, one node for each value the record holds
 * about something, tagged with where it stands; see `mem-facts.ts`.
 */
export const MEM_SCHEMA = 3;

/**
 * How many audit events and chat turns one delta tells. A record that holds
 * more is told over several writes, each moving the watermark as far as it
 * told, so the first telling of a long record is not one write that has to
 * finish inside the graph store's time limit or not at all.
 */
export const MEM_AT_MOST = 500;

/**
 * How long a chat turn with no author waits to be told. The request that
 * writes a turn names its author before it ends, and none runs this long: a
 * turn still unnamed after it is one nobody is coming to name.
 */
export const MEM_TURN_WAIT_MS = 15 * 60_000;

/** The events memory is told of. */
export const MEM_ENTRY_KINDS = [
  'paper_filed',
  'file_added',
  'paper_read',
  'value_accepted',
  'value_corrected',
  'value_set_aside',
  'value_reopened',
  'chat_asked',
  'chat_answered',
  'decision_recorded',
  'action_recorded',
  'finding_raised',
  'map_read_kept',
  'map_read_removed',
  'undone',
  'edit_noted',
] as const;

export type MemEntryKind = (typeof MEM_ENTRY_KINDS)[number];

/**
 * The entries told from the conversation: a question, an answer, and the
 * note a work-pane write leaves there. They go when the conversation is
 * deleted; see `memoryReplay`.
 */
export const MEM_TURN_KINDS: readonly MemEntryKind[] = ['chat_asked', 'chat_answered', 'edit_noted'];

/** Where a question was asked: the words the chat keeps on a turn, and no others. */
export interface MemPlace {
  pane?: string;
  department?: string;
  fn?: string;
  stage?: string;
}

export interface MemEntry {
  /** The project's id, `::mem::`, then the id of what told it, so the same event always has the same id. */
  id: string;
  kind: MemEntryKind;
  /** When it happened, as the record says. */
  at: string;
  /** Who did it, as an id that is not their email. See `memWho`. */
  by: string;
  /** The audit event, the chat turn or the paper the entry was told from. */
  sourceId: string;
  /** The ids on the record that the event is about. Read back to titles, never stored as titles. */
  about: string[];
  /** On an entry about a value: the value's key, when it is one of the fixed list of keys. Never the value. */
  key?: string;
  /** The name the fixed list gives that key. Never words from the record. */
  label?: string;
  /** For a chat turn, the page it was asked on. */
  place?: MemPlace;
}

/** Where a project's memory stands: what a `MemProject` node holds. */
export interface MemWatermark {
  /** The shape the entries were last written in. */
  schema?: number;
  /** The last audit event told. */
  auditThrough?: string;
  /** The last chat turn told. A turn has no audit event of its own. */
  turnThrough?: string;
  /** True when the live site wrote this project's memory. No other deployment sets it. */
  live?: boolean;
  /** Which facts memory holds, as one digest of them all: see `memFactsRev`. Absent when it holds none. */
  factsRev?: string;
}

export interface MemDelta {
  projectId: string;
  /** What to write, each id once. */
  entries: MemEntry[];
  /** Where memory stands once they are written. */
  through: MemWatermark;
  /** True when the copy holds events after `through` that can be told now: the delta from there tells them. */
  more?: true;
  /** Kinds of entry memory lets go of before these are written. See `memoryReplay`. */
  forget?: MemEntryKind[];
  /**
   * The facts to write and the ids of the facts to let go, to bring what
   * memory holds to what the record gives. Set by the pass that tells
   * memory, from `memFactsDiff`; `through.factsRev` is the digest of the
   * facts memory holds once they are written.
   */
  factChanges?: { put: MemFact[]; drop: string[] };
  /**
   * Set when nothing is to be written and why: memory was last written by a
   * newer build (`newer`), or this copy of the project does not hold the
   * event or the turn the watermark names (`behind`).
   */
  standsDown?: 'newer' | 'behind';
}

/** A short digest of some text, the same on every build: what tells two versions of a thing apart without keeping either. */
export function memHash(text: string): string {
  return hash53(text).toString(16).padStart(14, '0');
}

/** Bryc's cyrb53, public domain: fifty-three bits from a string, the same on every build. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A token that stands for words on the record and cannot be read back into them. The same words on the same project give the same token. */
function token(prefix: string, projectId: string, words: string): string {
  return `${prefix}_${hash53(`${projectId}|${words.trim().toLowerCase()}`).toString(16).padStart(14, '0')}`;
}

const WHO = /^who_[0-9a-f]{14}$/;

/**
 * A person as memory names them: an id that is not their email and cannot be
 * read as one. The same person on the same project is always the same id, so
 * a reader who knows who is on the project can tell whose it is, and nobody
 * else can. Different on every project.
 */
export function memWho(projectId: string, actor: string): string {
  return token('who', projectId, actor);
}

/** The shape of an id this product mints or keeps: no spaces, no address. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/~-]{0,199}$/;

/** Whether some text has the shape of an id; see `memPointer` for an id an entry or a fact may point at. */
export function isMemId(text: unknown): text is string {
  return typeof text === 'string' && ID.test(text);
}

/**
 * The parts of the graph whose ids are made from words on the record, by the
 * mark each has in an id, and the token the words are kept as: a person's
 * node carries their email, and a node of the title chain carries a name or
 * a number read off a paper.
 */
const WORDED = [
  { mark: '::member::', prefix: 'who', kept: WHO },
  { mark: '::title::', prefix: 'ref', kept: /^ref_[0-9a-f]{14}$/ },
];

/**
 * An id as an entry may point at it, or nothing when it is not an id.
 *
 * A record's id is kept as it is. An id made from words on the record is
 * kept as a token for those words under the same heading, so the pointer
 * still names one thing and a reader with the record can find which, without
 * the email, the name or the number being in memory. The same id always gives
 * the same pointer, and a pointer given again is left as it is.
 */
export function memPointer(projectId: string, id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  let pointer = id.trim();
  for (const { mark, prefix, kept } of WORDED) {
    const at = pointer.indexOf(mark);
    if (at === -1) continue;
    const words = pointer.slice(at + mark.length);
    if (!words) return undefined;
    if (!kept.test(words)) pointer = `${pointer.slice(0, at)}${mark}${token(prefix, projectId, words)}`;
    break;
  }
  return ID.test(pointer) ? pointer : undefined;
}

/**
 * A place as an entry may keep it: the words the product itself has for a
 * pane, a department, a function and a stage, and no word it does not have.
 */
function memPlace(place: MemPlace | undefined): MemPlace {
  if (!place || typeof place !== 'object') return {};
  const pane = typeof place.pane === 'string' && isProjectCockpitPane(place.pane) ? place.pane : undefined;
  const words = (key: 'department' | 'fn' | 'stage'): string | undefined => (typeof place[key] === 'string' ? place[key] : undefined);
  return { ...(pane ? { pane } : {}), ...menuPlaceOfWords({ department: words('department'), fn: words('fn'), stage: words('stage') }) };
}

/**
 * The key the record keeps a parcel read off the public map under: the map
 * it came from, a code for the place, and for a survey its number. It is the
 * one thing an entry points at that is made of what the record says, and it
 * is kept only in this form, which is the map reader's own
 * (`PARCEL_REF_PATTERN` in `packages/site-intel/src/cadastre.ts`; a test
 * holds the two together). It names land and no person.
 */
export const MEM_PARCEL_REF = /^((ulb|rural):\d{1,12}|kgis:\d{10}:[0-9]{1,5}([/-][0-9A-Za-z]{1,6}){0,3})$/;

/** The kinds of entry that point at a parcel by its key, and at nothing else. */
const MAP_READ_KINDS: readonly MemEntryKind[] = ['map_read_kept', 'map_read_removed'];

/**
 * The keys the rules file a value under, each with its label and the form
 * its value takes: the list a model is told (`STANDARD_FACT_KEYS`), and the
 * rest of the rules' own keys (`RULES_FACT_KEYS`). A value under a key that
 * is on neither has no key memory may keep.
 */
export function memRuleOfKey(key: unknown): { label: string; form: FactForm; choices?: readonly string[] } | undefined {
  if (typeof key !== 'string') return undefined;
  if (Object.hasOwn(STANDARD_FACT_KEYS, key)) return STANDARD_FACT_KEYS[key];
  return Object.hasOwn(RULES_FACT_KEYS, key) ? RULES_FACT_KEYS[key] : undefined;
}

/** The name the fixed list of value keys gives a key, or nothing for a key that is not on it. */
function nameOfKey(key: unknown): string | undefined {
  return memRuleOfKey(key)?.label;
}

/**
 * An entry as it may be kept, or nothing when it cannot be made one.
 *
 * Only the properties an entry has are carried: anything else a caller hung
 * on it, a turn's words or a page's, is left behind. Ids stay ids and a
 * person stays an id that is not an email. A map read points at a parcel by
 * a key of the fixed form and at nothing else. A label is never taken from
 * the caller: it is the fixed list's name for the entry's key, so no name,
 * no number and no other word of the record's can be one. A place is the
 * product's own words for its pages.
 */
export function scrubMemEntry(projectId: string, entry: MemEntry): MemEntry | undefined {
  if (!MEM_ENTRY_KINDS.includes(entry.kind)) return undefined;
  if (typeof entry.id !== 'string' || !entry.id.startsWith(`${projectId}::mem::`) || !ID.test(entry.id)) return undefined;
  if (typeof entry.sourceId !== 'string' || !ID.test(entry.sourceId)) return undefined;
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return undefined;
  const parcelOnly = MAP_READ_KINDS.includes(entry.kind);
  const about = [...new Set((Array.isArray(entry.about) ? entry.about : []).map((id) => memPointer(projectId, id)).filter((id): id is string => id !== undefined))]
    .filter((id) => !parcelOnly || MEM_PARCEL_REF.test(id))
    .slice(0, 40);
  const label = nameOfKey(entry.key);
  const place = memPlace(entry.place);
  return {
    id: entry.id,
    kind: entry.kind,
    at: entry.at,
    by: typeof entry.by === 'string' && WHO.test(entry.by) ? entry.by : memWho(projectId, String(entry.by ?? '')),
    sourceId: entry.sourceId,
    about,
    ...(label ? { key: entry.key, label } : {}),
    ...(Object.keys(place).length ? { place } : {}),
  };
}

/**
 * The key of the value an audit line is about, when it is one of the fixed
 * list of keys. The line reads "label: value". The paper's own fact under
 * that label says which key it is; when the paper or the fact has gone since,
 * the fixed list's own labels say. Neither the label nor the value is kept.
 */
export function memKeyOfValueLine(project: DdProject, evidenceId: string, line: string | undefined): string | undefined {
  if (!line) return undefined;
  const names = (label: string): boolean => line.startsWith(`${label}: `);
  const onPaper = project.evidence.find((e) => e.id === evidenceId)?.facts?.find((fact) => names(fact.label))?.key;
  const key = onPaper ?? Object.keys(STANDARD_FACT_KEYS).find((known) => names(STANDARD_FACT_KEYS[known]!.label));
  return nameOfKey(key) ? key : undefined;
}

/**
 * The key of the value an audit event is about. The event says, where the
 * record writes the key on it. An event written before it did is read by its
 * line (`memKeyOfValueLine`).
 */
export function memKeyOfValueEvent(project: DdProject, event: AuditEvent): string | undefined {
  if (typeof event.factKey === 'string') return nameOfKey(event.factKey) ? event.factKey : undefined;
  return memKeyOfValueLine(project, event.entityId, event.newValue ?? event.oldValue);
}

/** What the server reading a paper is called in an entry. */
const READER = 'system';

/** Whose a chat turn is when nobody named its author. No person on the record has this name, so a reader is shown none. */
const NOBODY = 'nobody';

/** How the audit trail writes a map read kept or removed: `revenueMap`, then the parcel if it names one. */
const MAP_READ = /^revenueMap(?: (\S+))?$/;

/** The entries one audit event tells: usually one, none for an event memory is not told of. */
function entriesOfEvent(project: DdProject, event: AuditEvent): MemEntry[] {
  const tell = (kind: MemEntryKind, about: string[], key?: string): MemEntry => ({
    id: `${project.id}::mem::${event.id}`,
    kind,
    at: event.at,
    by: memWho(project.id, event.actor),
    sourceId: event.id,
    about,
    ...(key ? { key } : {}),
  });

  if (event.entityType === 'evidence') {
    const paper = [event.entityId];
    const key = (): string | undefined => memKeyOfValueEvent(project, event);
    if (event.action === 'accept_fact') return [tell('value_accepted', paper, key())];
    if (event.action === 'accept_fact_corrected') return [tell('value_corrected', paper, key())];
    if (event.action === 'set_aside_fact') return [tell('value_set_aside', paper, key())];
    if (event.action === 'reopen_fact') return [tell('value_reopened', paper, key())];
    // A reading the record wrote down as one: each is told, the first and every one after.
    if (event.action === 'read') return [tell('paper_read', paper)];
    if (event.action !== 'create' && event.action !== 'upload') return [];
    const filed = tell(event.action === 'create' ? 'paper_filed' : 'file_added', paper);
    /*
     * A paper read before the record wrote readings down has no event of its
     * own. It is told with the paper's filing, when the row already carries
     * what was read off it, and a later reading of such a paper is not told.
     * One entry a paper, whoever tells it.
     */
    const row = project.evidence.find((e) => e.id === event.entityId);
    if (!row || (!row.readMethod && !row.facts?.length)) return [filed];
    if ((project.audit ?? []).some((other) => other.action === 'read' && other.entityType === 'evidence' && other.entityId === row.id)) return [filed];
    return [
      filed,
      { id: `${project.id}::mem::${row.id}`, kind: 'paper_read', at: row.modelReadAt ?? event.at, by: memWho(project.id, READER), sourceId: row.id, about: paper },
    ];
  }
  if (event.action === 'create') {
    if (event.entityType === 'decision') return [tell('decision_recorded', [event.entityId])];
    if (event.entityType === 'action') return [tell('action_recorded', [event.entityId])];
    if (event.entityType === 'finding') return [tell('finding_raised', [event.entityId])];
    return [];
  }
  if (event.entityType === 'project' && event.action === 'patch') {
    // The parcel's key as the trail writes it. Whether it is one an entry may keep is the scrub's to say.
    const parcel = (key: string | undefined): string[] => (key ? [key] : []);
    const kept = event.newValue?.match(MAP_READ);
    if (kept) return [tell('map_read_kept', parcel(kept[1]))];
    const removed = event.oldValue?.match(MAP_READ);
    if (removed) return [tell('map_read_removed', parcel(removed[1]))];
  }
  // What an instruction changed was put back. The events it wrote stay in the trail, and so in memory: this says they no longer stand.
  if (event.entityType === 'project' && event.action === 'undo') return [tell('undone', [])];
  return [];
}

/** A chat turn as an entry: who, when, where, and what it cites. Not what was said. */
function entryOfTurn(project: DdProject, turn: ProjectChatTurn): MemEntry {
  return {
    id: `${project.id}::mem::${turn.id}`,
    kind: turn.role === 'user' ? 'chat_asked' : 'chat_answered',
    at: turn.at,
    by: memWho(project.id, turn.actor ?? NOBODY),
    sourceId: turn.id,
    about: [...turn.citedEvidenceIds, ...(turn.citedNodeIds ?? []), ...(turn.proposalIds ?? [])],
    ...(turn.place ? { place: turn.place } : {}),
  };
}

/**
 * A work-pane note as an entry: who made the write, when, and what it cites.
 * The note is a pair of turns, the line that says what changed and a one-word
 * reply, and is one entry, told from the line. Not what the line says.
 */
function entryOfNote(project: DdProject, note: ProjectChatTurn): MemEntry {
  return {
    id: `${project.id}::mem::${note.id}`,
    kind: 'edit_noted',
    at: note.at,
    by: memWho(project.id, note.actor ?? NOBODY),
    sourceId: note.id,
    about: [...note.citedEvidenceIds, ...(note.citedNodeIds ?? [])],
  };
}

export interface MemDeltaOptions {
  /** How many audit events and chat turns to tell at most. `MEM_AT_MOST` when left out. */
  atMost?: number;
  /**
   * The time now, in milliseconds. A chat turn nobody has named the author
   * of is told as nobody's once it is `MEM_TURN_WAIT_MS` old. Left out, such
   * a turn waits.
   */
  now?: number;
}

/**
 * The entries to write for this copy of a project, given where its memory
 * stands, and where memory stands once they are written.
 *
 * Told in the record's own order: the audit events after the one the
 * watermark names, then the chat turns after the one it names. By position
 * and not by time, because an event's time is the time of what it records.
 * At most `atMost` events and turns at once; see `MEM_AT_MOST`.
 *
 * A chat turn is told once it has its author. A request writes its turns,
 * may save the project while it waits on a model, and names who asked and
 * on which page only when the answer is back: told before that, a person's
 * question would be kept as nobody's, with no page, for good. So a turn
 * with no author waits, and every turn after it waits behind it, because
 * the watermark is a place in the conversation and cannot pass one turn to
 * tell the next.
 *
 * A work-pane note does not wait. It is written whole, with its author or
 * without, and nothing comes back to name it: one with no author is told at
 * once, as nobody's. The reply that marks a pair as a note (`pane_write`) is
 * what tells it from a question still waiting for its answer.
 */
export function memoryDelta(project: DdProject, watermark: MemWatermark, options: MemDeltaOptions = {}): MemDelta {
  const held = watermark.schema ?? 0;
  if (held > MEM_SCHEMA) return { projectId: project.id, entries: [], through: watermark, standsDown: 'newer' };
  // Written in an older shape, or never: everything is told, in this one.
  const from: MemWatermark = held < MEM_SCHEMA ? {} : watermark;
  const audit = project.audit ?? [];
  const turns = project.conversation ?? [];
  const auditAt = from.auditThrough === undefined ? -1 : audit.findIndex((event) => event.id === from.auditThrough);
  const turnAt = from.turnThrough === undefined ? -1 : turns.findIndex((turn) => turn.id === from.turnThrough);
  if ((from.auditThrough !== undefined && auditAt === -1) || (from.turnThrough !== undefined && turnAt === -1)) {
    return { projectId: project.id, entries: [], through: watermark, standsDown: 'behind' };
  }

  const { now } = options;
  // Named, or past the time anybody would have named it. A time that cannot be read is not waited on.
  const tellable = (turn: ProjectChatTurn): boolean => Boolean(turn.actor) || (now !== undefined && !(now - Date.parse(turn.at) <= MEM_TURN_WAIT_MS));
  // A work-pane note: a line, and straight after it the reply that marks the two as one.
  const isNote = (at: number): boolean => turns[at]?.role === 'user' && isPaneWriteReply(turns[at + 1]);
  const most = Math.max(1, options.atMost ?? MEM_AT_MOST);
  const events = audit.slice(auditAt + 1, auditAt + 1 + most);
  const entries = new Map<string, MemEntry>();
  const keep = (entry: MemEntry): void => {
    const clean = scrubMemEntry(project.id, entry);
    if (clean && !entries.has(clean.id)) entries.set(clean.id, clean);
  };
  for (const event of events) for (const entry of entriesOfEvent(project, event)) keep(entry);

  // The turns after the watermark, a note's two as one, for as many as there is room for and no further than a turn that waits.
  let next = turnAt + 1;
  let turnThrough = from.turnThrough;
  for (let room = most - events.length; room > 0 && next < turns.length; room -= 1) {
    const turn = turns[next]!;
    if (isNote(next)) {
      keep(entryOfNote(project, turn));
      // Past the reply too: memory never stands between a note's two turns.
      turnThrough = turns[next + 1]!.id;
      next += 2;
    } else if (tellable(turn)) {
      keep(entryOfTurn(project, turn));
      turnThrough = turn.id;
      next += 1;
    } else {
      break;
    }
  }

  const auditThrough = events.length ? events[events.length - 1]!.id : from.auditThrough;
  const more = auditAt + 1 + events.length < audit.length || (next < turns.length && (isNote(next) || tellable(turns[next]!)));
  return {
    projectId: project.id,
    entries: [...entries.values()],
    through: { schema: MEM_SCHEMA, ...(auditThrough ? { auditThrough } : {}), ...(turnThrough ? { turnThrough } : {}) },
    ...(more ? { more: true as const } : {}),
  };
}

/**
 * Everything this copy tells from its start, for a record that has lost what
 * memory was last told from. The caller has asked the project store, and it
 * still holds this very copy.
 *
 * An audit event the record has lost happened all the same, and its entry
 * stays. The conversation is different. When the turn memory was told
 * through is gone from the record, the conversation was deleted, or the last
 * of two writers wrote over it, and a person who deleted a chat does not
 * expect memory to go on saying a question was asked at 10:42 on Approvals.
 * So the entries told from the conversation are let go (`forget`) before the
 * turns the record holds now are told.
 */
export function memoryReplay(project: DdProject, watermark: MemWatermark, options: MemDeltaOptions = {}): MemDelta {
  const delta = memoryDelta(project, {}, options);
  const turnLost = watermark.turnThrough !== undefined && !(project.conversation ?? []).some((turn) => turn.id === watermark.turnThrough);
  return turnLost ? { ...delta, forget: [...MEM_TURN_KINDS] } : delta;
}

/** Whether two watermarks say memory stands at the same place in the record, in the same shape. Which facts it holds is asked apart. */
export function sameMemWatermark(a: MemWatermark, b: MemWatermark): boolean {
  return (a.schema ?? 0) === (b.schema ?? 0) && (a.auditThrough ?? '') === (b.auditThrough ?? '') && (a.turnThrough ?? '') === (b.turnThrough ?? '');
}
