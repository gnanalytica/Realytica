/**
 * What one chat message changed on the record, and putting it back.
 *
 * A message that changes the record is compared with the record as it stood
 * before it (`changesBetween`). What comes out is a list of groups, one for
 * each thing a person would name: a value accepted, a field set, a paper
 * filed, a meeting kept, a report drafted, a questionnaire taken in. A group
 * says it in one line and holds what it takes to put the thing back. For a
 * field that is what stood there before. For a record the message added it
 * is nothing but a fingerprint of how the message left it.
 *
 * `undoChanges` puts a message's groups back, each on its own. A group goes
 * back only while every part of it still stands as the message left it. One
 * that was changed again since is left alone, and the caller is told which
 * and why. A record the message added is not taken away while anything else
 * on the record still rests on it. Nothing else is touched, so an undo never
 * takes back later work.
 *
 * It is one comparison for every kind of record and not a rule for each. A
 * record of a list is told from its neighbours by its id, a value read off a
 * paper by its key, and everything else is a field. So a kind of record the
 * project gains later is listed and undone with no change here; only the
 * words of its line are the plain ones.
 */

import { REPORT_KIND_LABEL } from './catalogs';
import { chatPlaceLabel } from './chat-places';
import type { ChatChoice } from '../types';
import type { DocumentFact } from './document-parse';
import { acceptedFacts, factReview, proposedFacts } from './fact-review';
import type { DdProject, EvidenceRecord, ProjectChatTurn } from './types';

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The parts of a project that are not the record a message changes: what was said, the trail of it, the clock, and what is worked out from the rest. */
const NOT_THE_RECORD = new Set(['conversation', 'audit', 'updatedAt', 'lastUndo', 'health', 'alerts']);
/** A key that says when something was last touched and nothing of what it holds. */
const CLOCK_KEYS = new Set(['updatedAt']);
/** How far down plain fields are told apart below a record. Past this a value is one thing, put back whole. */
const FIELDS_DEEP = 4;
/** What stood before is kept only up to this size for one field. A larger one is listed and cannot be put back. */
export const CHANGE_KEPT_AT_MOST = 20_000;
/** How many lines a reply keeps of what it changed. The rest are counted. */
export const CHANGE_LINES_AT_MOST = 12;

/** A copy that shares nothing with what it was made from. The record is plain data, so it is copied as that. */
const copyOf = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** The record as it stands, copied, for a message to be compared with once it is done. */
export type RecordBase = Rec;

export function recordAsItStands(project: DdProject | RecordBase): RecordBase {
  const out: RecordBase = {};
  for (const [key, value] of Object.entries(project)) if (!NOT_THE_RECORD.has(key) && value !== undefined) out[key] = copyOf(value);
  return out;
}

/* ==================================================================== */
/* Telling whether two values say the same                                */
/* ==================================================================== */

const holdsNothing = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (isRec(value) && Object.keys(value).length === 0);

/** A value in one fixed form: keys in order, nothing that holds nothing, and no clock. Two values that say the same come out the same. */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canon(item) ?? null);
  if (!isRec(value)) return value;
  const out: Rec = {};
  for (const key of Object.keys(value).sort()) {
    if (CLOCK_KEYS.has(key)) continue;
    const held = canon(value[key]);
    if (!holdsNothing(held)) out[key] = held;
  }
  return out;
}

const said = (value: unknown): string => {
  const fixed = canon(value);
  return holdsNothing(fixed) ? '' : JSON.stringify(fixed);
};

/** A short mark of a value, the same for two values that say the same. Not a secret and not a proof: only a way to tell whether something moved. */
export function fingerprintOf(value: unknown): string {
  const text = said(value);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** How the records of a list are told apart: by `id`, else by `key`, where every one has it and no two share it. */
function namedBy(list: readonly unknown[]): 'id' | 'key' | undefined {
  for (const by of ['id', 'key'] as const) {
    const seen = new Set<string>();
    const all = list.every((item) => {
      const name = isRec(item) ? item[by] : undefined;
      if (typeof name !== 'string' || !name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    if (list.length && all) return by;
  }
  return undefined;
}

/* ==================================================================== */
/* What changed                                                           */
/* ==================================================================== */

/** One thing that changed, at one place on the record. */
export interface KeptChange {
  /** Where: keys from the top of the record. A record of a list is named by `#` and its id, or its key. */
  path: string[];
  did: 'added' | 'removed' | 'set';
  /** What stood there before: for a field that was set, and for a record that was removed. Absent where nothing stood there. */
  before?: unknown;
  /** A fingerprint of what the message left there. Undo puts it back only while it still reads so. */
  left?: string;
  /** Where in its list a removed record stood. */
  at?: number;
  /** The record is one of a list told apart by `key`, which is a word and not an id. */
  byKey?: true;
  /** What stood before was too large to keep, so this cannot be put back. */
  lost?: true;
}

/** Everything a message changed about one thing a person would name. It is put back whole or not at all. */
export interface KeptGroup {
  /** The thing: the path of the record or field the group is about. */
  path: string[];
  /** The same, joined, to name the group by. */
  key: string;
  /** What the message did to it, in one line. */
  line: string;
  /** Lines of one kind about one parent are said as one when there are many: the key they share, and the words for many (`{n}` is how many). */
  bulk?: { key: string; many: string };
  /** Not listed: a card raised, words held to ask about. It goes back only when what it is about did. */
  quiet?: true;
  /**
   * The other groups this one was made for, by their keys: a card raised
   * about a paper names that paper, and the papers a due diligence expects
   * name it. The group goes back only when all of those did. A group that is
   * not listed and names none goes back only when every listed one did.
   */
  about?: string[];
  /** The groups that have to go back for this one to: a card accepted goes back to waiting only with what accepting it recorded. */
  needs?: string[];
  /** Files in storage the message added with it. They are removed when the group is put back and nothing else points at them. */
  files?: string[];
  /**
   * For a value read off a paper and an answer on a questionnaire: a
   * fingerprint of the whole of it as the message left it. Such a thing is
   * one statement, so a later change to any part of it is a change to it. A
   * record with fields of its own is judged field by field.
   */
  left?: string;
  changes: KeptChange[];
}

/** Whether a group is about one statement and not a record with fields of its own: a value on a paper, an answer on a questionnaire. */
const oneStatement = (path: readonly string[]): boolean => path.length === 4 && ((path[0] === 'evidence' && path[2] === 'facts') || (path[0] === 'questionnaires' && path[2] === 'questions'));

function walk(path: string[], a: unknown, b: unknown, deep: number, out: KeptChange[]): void {
  if (said(a) === said(b)) return;
  const lists = (a === undefined || a === null || Array.isArray(a)) && (b === undefined || b === null || Array.isArray(b));
  if (lists) {
    const from = (a as unknown[] | undefined) ?? [];
    const to = (b as unknown[] | undefined) ?? [];
    const fromBy = from.length ? namedBy(from) : undefined;
    const toBy = to.length ? namedBy(to) : undefined;
    // Both lists have to tell their records apart the same way. An empty one goes by the other's.
    const same = from.length && to.length ? (fromBy === toBy ? fromBy : undefined) : (fromBy ?? toBy);
    if (same) {
      const was = new Map(from.map((item, at) => [String((item as Rec)[same]), { item, at }]));
      const is = new Map(to.map((item) => [String((item as Rec)[same]), item]));
      const mark = same === 'key' ? ({ byKey: true } as const) : {};
      for (const [name, { item, at }] of was) if (!is.has(name)) out.push({ path: [...path, `#${name}`], did: 'removed', before: item, at, ...mark });
      for (const [name, item] of is) {
        const old = was.get(name);
        if (!old) out.push({ path: [...path, `#${name}`], did: 'added', left: fingerprintOf(item), ...mark });
        else walk([...path, `#${name}`], old.item, item, 0, out);
      }
      return;
    }
  } else if ((a === undefined || isRec(a)) && (b === undefined || isRec(b)) && deep < FIELDS_DEEP) {
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (!CLOCK_KEYS.has(key)) walk([...path, key], (a as Rec | undefined)?.[key], (b as Rec | undefined)?.[key], deep + 1, out);
    }
    return;
  }
  out.push({ path, did: 'set', ...(a === undefined ? {} : { before: a }), left: fingerprintOf(b) });
}

/**
 * The path of the thing a change is about.
 *
 * A field of the project is itself the thing. A record of one of the
 * project's lists is the thing for everything inside it: its fields, its
 * files, what was read off it. Three kinds of record inside another are
 * things of their own, because a person decides each on its own: a value on
 * a paper, a question of a questionnaire, and a check of a due diligence.
 */
function groupPath(change: KeptChange): string[] {
  const { path } = change;
  // Where a value came from is kept beside the project's own figure: it is part of that figure.
  if (path[0] === 'valueSources' && path[1]) return [path[1]];
  if (!path[1]?.startsWith('#')) return path.slice(0, 1);
  const check = path.indexOf('checks');
  if (check !== -1 && path[check + 1]?.startsWith('#') && path.length > check + 2) return path.slice(0, check + 2);
  // A value or a question that is added or removed is part of its paper or its sheet. Decided, it is itself the thing.
  if (path.length > 4 && oneStatement(path.slice(0, 4))) return path.slice(0, 4);
  return path.slice(0, 2);
}

/* ==================================================================== */
/* Saying it                                                              */
/* ==================================================================== */

const cut = (text: string, most = 80): string => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);
const quoted = (text: unknown): string => `“${cut(String(text ?? '').trim() || 'untitled')}”`;
const nameOf = (record: unknown): string | undefined => {
  if (!isRec(record)) return undefined;
  for (const key of ['title', 'name', 'subject', 'label', 'fileName', 'text', 'date', 'heldOn']) {
    const held = record[key];
    if (typeof held === 'string' && held.trim()) return held.trim();
  }
  return undefined;
};

/** The record of a list that a path segment names, where there is exactly one. */
function member(list: unknown, segment: string): { item: Rec; at: number } | undefined {
  if (!Array.isArray(list)) return undefined;
  const name = segment.slice(1);
  const byId = list.findIndex((item) => isRec(item) && item.id === name);
  if (byId !== -1) return { item: list[byId] as Rec, at: byId };
  // A key is a word, and two readings of one paper can carry the same one: then neither is the one meant.
  const byKey = list.flatMap((item, at) => (isRec(item) && item.id === undefined && item.key === name ? [at] : []));
  return byKey.length === 1 ? { item: list[byKey[0]!] as Rec, at: byKey[0]! } : undefined;
}

interface Reached {
  /** The place is there to be read: its parent exists. For a record of a list, the record itself exists. */
  found: boolean;
  value?: unknown;
  /** What holds it: the object a field is on, or the list a record is in. */
  holder?: unknown;
  last?: string;
}

function reach(root: unknown, path: readonly string[]): Reached {
  let at: unknown = root;
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i]!;
    const end = i === path.length - 1;
    if (segment.startsWith('#')) {
      const hit = member(at, segment);
      if (end) return hit ? { found: true, value: hit.item, holder: at, last: segment } : { found: false, holder: at, last: segment };
      if (!hit) return { found: false };
      at = hit.item;
    } else {
      if (!isRec(at)) return { found: false };
      if (end) return { found: true, value: at[segment], holder: at, last: segment };
      at = at[segment];
    }
  }
  return { found: true, value: at };
}

const FIELD_SAID: Record<string, string> = {
  name: 'the project’s name',
  description: 'the description',
  location: 'the location',
  city: 'the city',
  jurisdiction: 'the jurisdiction',
  siteAddress: 'the site address',
  status: 'the project’s status',
  currentStage: 'the stage',
  owner: 'the owner',
  developer: 'the developer',
  landAreaSqm: 'the land area',
  builtUpAreaSqm: 'the built-up area',
  saleableAreaSqm: 'the saleable area',
  budget: 'the budget',
  portfolio: 'the portfolio',
  subtype: 'the kind of project',
  parcelId: 'the parcel',
  tenure: 'the tenure',
  plot: 'the plot’s details',
  karnataka: 'the Karnataka details',
  reviewTable: 'the review table',
  departments: 'the departments in use',
  stageHistory: 'the stages gone through',
  lastScreen: 'the last screen',
  lastScreenResult: 'the last screen',
  siteContext: 'what is known of the site',
  siteCoordinate: 'the site’s place on the map',
  surveyBoundary: 'the survey boundary',
  revenueMap: 'the revenue map read',
  revenueMaps: 'the revenue map reads',
  revenueShapes: 'the revenue map’s shapes',
  comparableSearch: 'the search for comparables',
  valueSetAside: 'the values set aside',
};

/** What a list's records are called: the words for one added, for many added, and for one of them. */
const LIST_SAID: Record<string, { added: string; many: string; a: string }> = {
  decisions: { added: 'Recorded the decision', many: 'Recorded {n} decisions', a: 'the decision' },
  actions: { added: 'Recorded the action', many: 'Recorded {n} actions', a: 'the action' },
  findings: { added: 'Raised the finding', many: 'Raised {n} findings', a: 'the finding' },
  risks: { added: 'Recorded the risk', many: 'Recorded {n} risks', a: 'the risk' },
  requests: { added: 'Asked for', many: 'Asked for {n} papers', a: 'the request for' },
  reports: { added: 'Drafted', many: 'Drafted {n} reports', a: 'the report' },
  outgoing: { added: 'Drafted', many: 'Drafted {n} letters', a: 'the draft' },
  assessments: { added: 'Started', many: 'Started {n} due diligences', a: 'the due diligence' },
  assets: { added: 'Added the asset', many: 'Added {n} assets', a: 'the asset' },
  stakeholders: { added: 'Added', many: 'Added {n} stakeholders', a: 'the stakeholder' },
  team: { added: 'Added to the team:', many: 'Added {n} people to the team', a: 'the team member' },
  milestones: { added: 'Added the milestone', many: 'Added {n} milestones', a: 'the milestone' },
  siteLog: { added: 'Added the site entry of', many: 'Added {n} site entries', a: 'the site entry of' },
  siteVisits: { added: 'Recorded the site visit', many: 'Recorded {n} site visits', a: 'the site visit' },
  links: { added: 'Added the link', many: 'Added {n} links', a: 'the link' },
  comparables: { added: 'Added the comparable', many: 'Added {n} comparables', a: 'the comparable' },
  engagements: { added: 'Added the engagement', many: 'Added {n} engagements', a: 'the engagement' },
  questionnaires: { added: 'Took in the questionnaire', many: 'Took in {n} questionnaires', a: 'the questionnaire' },
  valuationRuns: { added: 'Ran the valuation', many: 'Ran {n} valuations', a: 'the valuation' },
  aiDrafts: { added: 'Drafted', many: 'Drafted {n} records', a: 'the draft' },
};

const inWords = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const dayOf = (iso: unknown): string | undefined => {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return undefined;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function valueSaid(value: unknown): string | undefined {
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' && value.trim() && value.length <= 60) return value.trim();
  return undefined;
}

interface Told {
  line: string;
  bulk?: { key: string; many: string };
  quiet?: true;
}

/** One group in words: what the message did to the thing, read from the record before and after. */
function tell(path: string[], changes: readonly KeptChange[], before: RecordBase, after: RecordBase): Told {
  const list = path[0]!;
  const own = changes.find((change) => change.path.length === path.length && change.did !== 'set');
  const record = (reach(after, path).value ?? reach(before, path).value) as Rec | undefined;
  const was = reach(before, path).value as Rec | undefined;
  const fields = new Set(changes.filter((change) => change.path.length > path.length).map((change) => change.path[path.length]!));

  // A field of the project itself.
  if (path.length === 1 && !own) {
    const now = (after as Rec)[list];
    const label = FIELD_SAID[list] ?? inWords(list);
    const shown = isRec(now) || Array.isArray(now) ? undefined : valueSaid(now);
    if (holdsNothing(now)) return { line: `Cleared ${label}` };
    return { line: shown ? `Set ${label} to ${shown}${list.endsWith('Sqm') ? ' sqm' : ''}` : `Changed ${label}` };
  }

  // A value read off a paper, decided.
  if (list === 'evidence' && path[2] === 'facts' && path.length === 4 && !own) {
    const paper = reach(after, path.slice(0, 2)).value as Rec | undefined;
    const on = `on ${quoted(nameOf(paper))}`;
    const label = String(record?.label ?? inWords(path[3]!.slice(1)));
    const review = record ? factReview(record as unknown as DocumentFact) : 'accepted';
    const earlier = was ? factReview(was as unknown as DocumentFact) : 'accepted';
    const shown = valueSaid(record?.display);
    if (review === 'accepted' && earlier !== 'accepted') return { line: `Accepted ${label} ${on}${shown ? `: ${shown}` : ''}`, bulk: { key: `accepted:${path[1]}`, many: `Accepted {n} values ${on}` } };
    if (review === 'rejected' && earlier !== 'rejected') return { line: `Set aside ${label} ${on}`, bulk: { key: `aside:${path[1]}`, many: `Set aside {n} values ${on}` } };
    if (review === 'proposed' && earlier !== 'proposed') return { line: `Put ${label} ${on} back to waiting`, bulk: { key: `reopened:${path[1]}`, many: `Put {n} values ${on} back to waiting` } };
    return { line: `Changed ${label} ${on}`, bulk: { key: `value:${path[1]}`, many: `Changed {n} values ${on}` } };
  }

  const title = quoted(nameOf(record));

  if (list === 'evidence' && path.length === 2) {
    // A row with a file on it is a paper filed. One with none is a paper the register expects, listed and not yet held.
    if (own?.did === 'added') {
      const held = Array.isArray(record?.attachments) && record.attachments.length > 0;
      return held ? { line: `Filed ${title}`, bulk: { key: 'filed', many: 'Filed {n} papers' } } : { line: `Listed ${title} on the register, to be got`, bulk: { key: 'listed', many: 'Listed {n} papers on the register, to be got' } };
    }
    if (own?.did === 'removed') return { line: `Took ${title} off the register` };
    if (fields.has('workstream') && typeof record?.workstream === 'string') return { line: `Filed ${title} under ${chatPlaceLabel({ fn: record.workstream })}` };
    if (fields.has('facts') || fields.has('readMethod') || fields.has('modelReadAt')) {
      // Values that could not be told apart one by one: counted from the row as it stood and as it stands.
      const now = record as unknown as EvidenceRecord;
      const then = was as unknown as EvidenceRecord | undefined;
      const more = acceptedFacts(now).length - (then ? acceptedFacts(then).length : 0);
      if (more > 0 && proposedFacts(now).length < (then ? proposedFacts(then).length : 0)) return { line: `Accepted ${more === 1 ? 'a value' : `${more} values`} on ${title}` };
      return { line: `Read ${title}`, bulk: { key: 'read', many: 'Read {n} papers' } };
    }
    if (fields.has('attachments')) return { line: `Added a file to ${title}` };
    if (fields.has('status') && typeof record?.status === 'string') return { line: `Marked ${title} as ${inWords(record.status).replace(/_/g, ' ')}` };
    if (fields.has('documentType') && typeof record?.documentType === 'string') return { line: `Said ${title} is ${record.documentType}` };
    return { line: `Changed ${title}`, bulk: { key: 'papers', many: 'Changed {n} papers' } };
  }

  if (list === 'chatProposals' && path.length === 2) {
    if (own?.did === 'added') return { line: `Raised: ${nameOf(record) ?? 'a card'}`, quiet: true };
    if (record?.status === 'committed') return { line: `Accepted: ${nameOf(record) ?? 'a card'}`, bulk: { key: 'cards', many: 'Accepted {n} cards' } };
    if (record?.status === 'rejected') return { line: `Set aside: ${nameOf(record) ?? 'a card'}`, bulk: { key: 'cards-aside', many: 'Set aside {n} cards' } };
    return { line: `Changed the card ${title}` };
  }

  if (list === 'meetings' && path.length === 2) {
    // Words the chat is holding while it asks what they are: nothing is kept as a meeting yet.
    if (record?.standing === 'asked') return { line: 'Held some words to ask about', quiet: true };
    const day = dayOf(record?.heldOn);
    if (own?.did === 'added' || was?.standing === 'asked') return { line: `Kept the notes of a meeting${day ? ` of ${day}` : ''}` };
    if (own?.did === 'removed') return { line: `Let go of the notes of a meeting${day ? ` of ${day}` : ''}` };
    return { line: `Changed the meeting${day ? ` of ${day}` : ''}` };
  }

  if (list === 'questionnaires') {
    const sheet = reach(after, path.slice(0, 2)).value as Rec | undefined;
    const of = quoted(nameOf(sheet));
    if (path.length === 2 && own?.did === 'added') {
      const n = Array.isArray(record?.questions) ? record.questions.length : 0;
      return { line: `Took in the questionnaire ${title}${n ? `, ${n === 1 ? '1 question' : `${n} questions`}` : ''}` };
    }
    if (path.length === 4 && path[2] === 'questions' && !own) {
      const suggested = record?.suggested === true && was?.suggested !== true;
      const answered = !holdsNothing(record?.answer) && said(record?.answer) !== said(was?.answer);
      if (suggested || (answered && record?.suggested === true)) return { line: `Suggested an answer to ${title}`, bulk: { key: `suggested:${path[1]}`, many: `Suggested answers to {n} questions of ${of}` } };
      if (answered) return { line: `Answered ${title}`, bulk: { key: `answered:${path[1]}`, many: `Answered {n} questions of ${of}` } };
      return { line: `Changed the question ${title}`, bulk: { key: `questions:${path[1]}`, many: `Changed {n} questions of ${of}` } };
    }
  }

  if (list === 'reports' && path.length === 2 && own?.did === 'added') {
    const kind = typeof record?.kind === 'string' ? REPORT_KIND_LABEL[record.kind as keyof typeof REPORT_KIND_LABEL] : undefined;
    return { line: `Drafted ${nameOf(record) ? title : `the ${kind ?? 'report'}`}` };
  }

  // A check of a due diligence, however deep it sits.
  if (path.includes('checks') && isRec(record) && typeof record.title === 'string' && !own) {
    if (fields.has('result') && typeof record.result === 'string') return { line: `Marked the check ${title} as ${record.result.replace(/_/g, ' ')}` };
    return { line: `Recorded on the check ${title}`, bulk: { key: 'checks', many: 'Recorded on {n} checks' } };
  }

  const words = LIST_SAID[list];
  if (path.length === 2 && words) {
    if (own?.did === 'added') return { line: `${words.added} ${title}`, bulk: { key: `added:${list}`, many: words.many } };
    if (own?.did === 'removed') return { line: `Removed ${words.a} ${title}` };
    if (list === 'actions' && fields.has('status') && record?.status === 'closed') return { line: `Closed the action ${title}` };
    if (fields.has('status') && typeof record?.status === 'string') return { line: `Marked ${words.a} ${title} as ${record.status.replace(/_/g, ' ')}` };
    return { line: `Changed ${words.a} ${title}` };
  }

  // Anything else: said plainly, by what it is called where it is called anything.
  const where = FIELD_SAID[list] ?? LIST_SAID[list]?.a ?? inWords(list);
  if (own?.did === 'added') return { line: nameOf(record) ? `Added ${title} to ${where}` : `Added to ${where}` };
  if (own?.did === 'removed') return { line: nameOf(record) ? `Removed ${title} from ${where}` : `Removed from ${where}` };
  return { line: nameOf(record) ? `Changed ${title} (${where})` : `Changed ${where}` };
}

/** Every storage key a value names. */
function filesIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) filesIn(item, out);
  else if (isRec(value)) {
    for (const [key, held] of Object.entries(value)) {
      if (key === 'storageKey' && typeof held === 'string' && held) out.add(held);
      else filesIn(held, out);
    }
  }
  return out;
}

/**
 * What a message changed: the record as it stood before it, against the
 * record now. Nothing when the message changed nothing a person would want
 * back: a reply that only raised cards, or only holds words it is asking
 * about, has changed nothing.
 */
export function changesBetween(stood: RecordBase | DdProject, project: DdProject | RecordBase): KeptGroup[] {
  const before = stood as RecordBase;
  const after: RecordBase = {};
  for (const [key, value] of Object.entries(project)) if (!NOT_THE_RECORD.has(key)) after[key] = value;
  const found: KeptChange[] = [];
  // `before` may be a whole copy of the project: what is not the record is passed over on both sides.
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (!NOT_THE_RECORD.has(key)) walk([key], before[key], after[key], 1, found);
  if (!found.length) return [];

  const byGroup = new Map<string, { path: string[]; changes: KeptChange[] }>();
  for (const change of found) {
    const path = groupPath(change);
    const key = path.join('/');
    const held = byGroup.get(key) ?? { path, changes: [] };
    held.changes.push(change);
    byGroup.set(key, held);
  }

  const hadFiles = filesIn(before);
  const groups: KeptGroup[] = [];
  for (const [key, { path, changes }] of byGroup) {
    const told = tell(path, changes, before, after);
    const files = new Set<string>();
    for (const change of changes) if (change.did !== 'removed') for (const file of filesIn(reach(after, change.path).value)) if (!hadFiles.has(file)) files.add(file);
    for (const change of changes) {
      if (change.before !== undefined && JSON.stringify(change.before).length > CHANGE_KEPT_AT_MOST) {
        delete change.before;
        change.lost = true;
      }
    }
    const whole = oneStatement(path) ? reach(after, path) : undefined;
    groups.push({
      path,
      key,
      line: told.line,
      ...(told.bulk ? { bulk: told.bulk } : {}),
      ...(told.quiet ? { quiet: true } : {}),
      ...(files.size ? { files: [...files] } : {}),
      ...(whole?.found ? { left: fingerprintOf(whole.value) } : {}),
      changes,
    });
  }

  // A card that was accepted goes back to waiting only with what accepting it recorded: the record it became, or the fields it set.
  const fieldGroups = groups.filter((group) => group.path.length === 1);
  for (const group of groups) {
    if (group.path[0] !== 'chatProposals' || group.path.length !== 2 || group.changes.some((change) => change.did !== 'set')) continue;
    const card = reach(after, group.path).value as Rec | undefined;
    if (card?.status !== 'committed') continue;
    const became = typeof card.committedRecordId === 'string' ? groups.filter((other) => other !== group && other.path.includes(`#${card.committedRecordId}`)) : [];
    const payload = isRec(card.payload) ? Object.keys(card.payload) : [];
    const set = became.length ? [] : fieldGroups.filter((other) => payload.includes(other.key));
    const needs = [...became, ...set].map((other) => other.key);
    if (needs.length) {
      group.needs = needs;
      // What it recorded is listed. The card itself need not be said twice.
      group.quiet = true;
    }
  }
  // What a record was made for: an unlisted card names the listed thing it is about, and a record that was added names the
  // other records added with it that it belongs to. Each goes back only when those did.
  const listed = groups.filter((group) => !group.quiet && group.path[1]?.startsWith('#'));
  const isAdded = (group: KeptGroup): boolean => group.changes.some((change) => change.did === 'added' && change.path.length === group.path.length);
  for (const group of groups) {
    if (group.needs || !(group.quiet || isAdded(group))) continue;
    const text = JSON.stringify(reach(after, group.path).value ?? null);
    const about = listed.filter((other) => other !== group && (group.quiet || isAdded(other)) && text.includes(other.path[1]!.slice(1))).map((other) => other.key);
    if (about.length) group.about = about;
  }
  return groups.some((group) => !group.quiet) ? groups : [];
}

/** The lines of some groups, as a person reads them: many of one kind about one thing are said as one. */
export function changeLines(groups: readonly Pick<KeptGroup, 'line' | 'bulk' | 'quiet'>[], suffix: (group: Pick<KeptGroup, 'line' | 'bulk' | 'quiet'>) => string = () => ''): string[] {
  const listed = groups.filter((group) => !group.quiet);
  const counts = new Map<string, number>();
  for (const group of listed) if (group.bulk) counts.set(`${group.bulk.key}|${suffix(group)}`, (counts.get(`${group.bulk.key}|${suffix(group)}`) ?? 0) + 1);
  const done = new Set<string>();
  const lines: string[] = [];
  for (const group of listed) {
    const tail = suffix(group);
    const shared = group.bulk ? `${group.bulk.key}|${tail}` : undefined;
    const n = shared ? (counts.get(shared) ?? 0) : 0;
    if (shared && n >= 3) {
      if (done.has(shared)) continue;
      done.add(shared);
      lines.push(`${group.bulk!.many.replace('{n}', String(n))}${tail}`);
    } else lines.push(`${group.line}${tail}`);
  }
  return lines;
}

/** What a reply keeps of what it changed: the lines a person reads, and whether it can still be undone. */
export interface TurnChanged {
  lines: string[];
  /** How many more lines there are than are kept here. */
  more?: number;
  /** What it takes to put the changes back is kept beside the project. Absent where it could not be kept: then the message is listed and cannot be undone. */
  kept?: true;
  /** It was undone: when, by whom, and how many of its things were put back. */
  undone?: { at: string; by: string; back: number; of: number };
}

export function turnChanged(groups: readonly KeptGroup[], kept: boolean): TurnChanged | undefined {
  const lines = changeLines(groups);
  if (!lines.length) return undefined;
  return { lines: lines.slice(0, CHANGE_LINES_AT_MOST), ...(lines.length > CHANGE_LINES_AT_MOST ? { more: lines.length - CHANGE_LINES_AT_MOST } : {}), ...(kept ? { kept: true } : {}) };
}

/* ==================================================================== */
/* Putting it back                                                        */
/* ==================================================================== */

/** Why a group is left as it is. */
const WHY = {
  gone: 'it is no longer there',
  changed: 'it was changed again since',
  lost: 'what stood before was too large to keep with the message',
  rests: 'something else on the record still rests on it',
  needs: 'what it recorded could not be put back',
  quiet: 'not everything else went back',
  with: 'what it was added for could not be put back',
} as const;

/** The statuses an action may have had before the clock called it overdue. */
const BEFORE_OVERDUE = ['not_started', 'in_progress', 'blocked', 'submitted', 'under_review'];

/** Whether a record or a value still reads as the message left it. The clock calling an action overdue is not a change anybody made. */
function readsAs(value: unknown, left: string | undefined, path: readonly string[]): boolean {
  if (fingerprintOf(value) === left) return true;
  if (path[0] !== 'actions') return false;
  if (path.length === 3 && path[2] === 'status' && value === 'overdue') return true;
  if (path.length === 2 && isRec(value) && value.status === 'overdue') return BEFORE_OVERDUE.some((status) => fingerprintOf({ ...value, status }) === left);
  return false;
}

function standing(root: unknown, change: KeptChange): keyof typeof WHY | undefined {
  if (change.lost) return 'lost';
  if (change.did === 'removed') {
    const list = reach(root, change.path.slice(0, -1));
    if (!list.found) return 'gone';
    return member(list.value, change.path[change.path.length - 1]!) ? 'changed' : undefined;
  }
  const hit = reach(root, change.path);
  if (!hit.found) return 'gone';
  return readsAs(hit.value, change.left, change.path) ? undefined : 'changed';
}

function putBack(root: unknown, change: KeptChange): void {
  if (change.did === 'set') {
    const hit = reach(root, change.path);
    if (!hit.found || !isRec(hit.holder) || !hit.last) return;
    if (change.before === undefined) delete hit.holder[hit.last];
    else hit.holder[hit.last] = copyOf(change.before);
    return;
  }
  const last = change.path[change.path.length - 1]!;
  const list = reach(root, change.path.slice(0, -1));
  if (!list.found) return;
  if (change.did === 'added') {
    const hit = member(list.value, last);
    if (hit) (list.value as unknown[]).splice(hit.at, 1);
    return;
  }
  let into = list.value;
  if (into === undefined && isRec(list.holder) && list.last && !list.last.startsWith('#')) {
    into = [];
    list.holder[list.last] = into;
  }
  if (Array.isArray(into) && !member(into, last)) into.splice(Math.min(change.at ?? into.length, into.length), 0, copyOf(change.before));
}

const backOut = (root: unknown, groups: readonly KeptGroup[]): void => {
  for (const group of [...groups].reverse()) for (const change of [...group.changes].reverse()) putBack(root, change);
};

export interface UndoOutcome {
  /** The groups that were put back. */
  back: KeptGroup[];
  /** The groups left as they are, each with why. Those that are not listed are not here. */
  left: Array<{ group: KeptGroup; why: string }>;
  /** Files in storage that nothing on the record points at any more. */
  files: string[];
  /** The ids of the records it put something back on. */
  about: string[];
}

/**
 * Put back what a message changed, where each thing still stands as the
 * message left it. The project is changed in place. What is left alone is
 * given back with why, and nothing that was changed again since, and nothing
 * anything else rests on, is touched.
 */
export function undoChanges(project: DdProject, groups: readonly KeptGroup[]): UndoOutcome {
  const why = new Map<string, keyof typeof WHY>();
  for (const group of groups) {
    let reason = group.changes.map((change) => standing(project, change)).find(Boolean);
    if (!reason && group.left !== undefined) {
      const now = reach(project, group.path);
      reason = !now.found ? 'gone' : fingerprintOf(now.value) === group.left ? undefined : 'changed';
    }
    if (reason) why.set(group.key, reason);
  }
  const going = (): KeptGroup[] => groups.filter((group) => !why.has(group.key));
  for (let pass = 0; pass <= groups.length; pass += 1) {
    let moved = false;
    const stay = (group: KeptGroup, reason: keyof typeof WHY): void => {
      why.set(group.key, reason);
      moved = true;
    };
    // What is not listed goes back only when what it is about did: the groups it names, or with none named, every listed one.
    const stays = (keys: readonly string[]): boolean => keys.some((key) => why.has(key));
    const anyListedStays = groups.some((group) => !group.quiet && why.has(group.key));
    for (const group of going()) if (group.quiet && !group.needs && (group.about ? stays(group.about) : anyListedStays)) stay(group, 'quiet');
    for (const group of going()) if (!group.quiet && group.about && stays(group.about)) stay(group, 'with');
    for (const group of going()) if (group.needs?.some((key) => why.has(key))) stay(group, 'needs');
    // A record the message added stays while anything that would be left still names it.
    const after = recordAsItStands(project);
    backOut(after, going());
    const text = JSON.stringify(after);
    for (const group of going()) {
      const ids = group.changes.filter((change) => change.did === 'added' && !change.byKey).map((change) => change.path[change.path.length - 1]!.slice(1));
      if (ids.some((id) => text.includes(id))) stay(group, 'rests');
    }
    if (!moved) break;
  }

  const back = going();
  backOut(project, back);
  const standsNow = JSON.stringify(recordAsItStands(project));
  const files = [...new Set(back.flatMap((group) => group.files ?? []))].filter((file) => !standsNow.includes(JSON.stringify(file).slice(1, -1)));
  const about = [...new Set(back.filter((group) => !group.quiet).flatMap((group) => group.path.filter((segment) => segment.startsWith('#')).slice(0, 1)).map((segment) => segment.slice(1)))];
  return {
    back,
    left: groups.filter((group) => why.has(group.key) && !group.quiet).map((group) => ({ group, why: WHY[why.get(group.key)!] })),
    files,
    about,
  };
}

/** What the chat says once an undo is done: what was put back, and what was left with why. */
export function undoSaid(outcome: Pick<UndoOutcome, 'back' | 'left' | 'files'>): string {
  const back = changeLines(outcome.back);
  const left = changeLines(
    outcome.left.map(({ group }) => group),
    (group) => `: ${outcome.left.find((held) => held.group === group)?.why ?? WHY.changed}`,
  );
  const all = back.length + left.length;
  const files = outcome.files.length ? [`${outcome.files.length === 1 ? 'The file it added is' : `The ${outcome.files.length} files it added are`} removed from storage.`] : [];
  if (!back.length) return ['Nothing was undone.', ...(left.length ? ['Left as it is:', ...left.map((line) => `- ${line}.`)] : [])].join('\n');
  return [
    left.length ? `Undone, ${back.length} of ${all}:` : 'Undone:',
    ...back.map((line) => `- ${line}.`),
    ...files,
    ...(left.length ? ['Left as it is:', ...left.map((line) => `- ${line}.`)] : []),
  ].join('\n');
}

/* ==================================================================== */
/* Asking for it                                                          */
/* ==================================================================== */

const UNDO_IT = /^(?:please\s+)?undo(?:\s+(?:that|it|this|the last (?:change|message|instruction|one|thing)|what (?:you|that) (?:just\s+)?(?:did|changed)))?$/i;

/** Whether a sentence asks for the last thing the chat changed to be undone. Read only in full. */
export function asksToUndo(sentence: string): boolean {
  return UNDO_IT.test(sentence.trim().replace(/[.!\s]+$/, ''));
}

/** The sentence the page sends when Undo is pressed under a reply. The reply it means goes beside it, and the sentence is not read. */
export function undoSentence(changed: Pick<TurnChanged, 'lines' | 'more'>): string {
  const first = changed.lines[0] ?? 'what that message changed';
  const more = changed.lines.length - 1 + (changed.more ?? 0);
  return `Undo: ${first}${more > 0 ? `, and ${more} more` : ''}`;
}

/** The choice that undoes a reply: for a caller that offers it as one. */
export function undoChoice(turn: Pick<ProjectChatTurn, 'id' | 'changed'>): ChatChoice | undefined {
  if (!turn.changed?.kept || turn.changed.undone) return undefined;
  return { id: `${turn.id}_undo`, label: 'Undo', send: undoSentence(turn.changed), sitting: { undo: { turnId: turn.id } } };
}

/** The last reply of some turns that changed the record and can still be undone. */
export function lastUndoable<T extends Pick<ProjectChatTurn, 'role' | 'changed'>>(turns: readonly T[]): T | undefined {
  return [...turns].reverse().find((turn) => turn.role === 'assistant' && turn.changed?.kept && !turn.changed.undone);
}
