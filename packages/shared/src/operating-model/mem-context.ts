/**
 * What of the project's memory the assistant is shown with a question.
 *
 * Not all of it. A question has a few things it is about, its seeds: the
 * page it was asked on, the record the sitting is on, and what the question
 * names, a record by its title or a kind of value by its label. At most five.
 * Each seed brings at most eight facts and the whole at most forty. With a
 * question that names nothing on a page that is none of the menu's, the one
 * seed is the project itself.
 *
 * Each fact is one line: a mark the answer can cite it by, the tag, what it
 * says, what states it, and its date. The tag is this file's word for where
 * the fact stands: approved, waiting (and whether the record's own rule lets
 * it stand), or thought. What a fact was before is on its line only when
 * the question is about change.
 *
 * An answer cites a line by its mark, and `memTagsPrinted` puts the tag where
 * the mark stood. So the tag beside a statement is printed here, from the
 * fact the mark names, and a tag a model wrote itself is taken out before any
 * is printed.
 *
 * Pure, and the same over facts read from the graph store and facts told
 * from the record. The caller hands in the facts this reader may see: the
 * cut by a reader's reach is made before anything here runs.
 *
 * A thought is shown, tagged, and no more than two a seed unless the
 * question asks for notes by name. It is the assistant's own earlier note
 * and no fact of the file. The check on an
 * answer's figures (`verifyAttribution`) reads the record and nothing here,
 * and the record holds no thought, so a figure only a thought gives is
 * marked as one the file does not support.
 */

import { SCOPE_LABEL } from './catalogs';
import { chatLinkLabels, chatPlaceLabel, menuPlaceOfWords } from './chat-places';
import { RULES_FACT_KEYS, STANDARD_FACT_KEYS } from './document-parse';
import { allChecks } from './engagements';
import { memPointer, type MemPlace } from './mem-delta';
import { MEM_FIELD_KEYS, type MemFact, type MemFactTag } from './mem-facts';
import { parcelLabels, revenueReads } from './revenue-map';
import { rankTalkSittings } from './sitting';
import type { DdProject } from './types';

/** How many things a question is taken to be about, at most. */
export const MEM_SEEDS_AT_MOST = 5;

/** How many facts one seed brings, at most, and how many of those may be the assistant's own notes. */
export const MEM_SEED_FACTS = 8;
export const MEM_SEED_THOUGHTS = 2;

/** How many facts the assistant is shown with one question, at most. */
export const MEM_CONTEXT_FACTS = 40;

/** A question as memory needs to know it. */
export interface MemAsk {
  /** The words of the question. */
  question: string;
  /** The page it was asked on. */
  place?: MemPlace;
  /** The record the sitting is on. */
  sitting?: { ddId?: string; scopeId?: string; checkId?: string };
}

/** One thing a question is about. */
export interface MemSeed {
  /** How it was found: the page, the sitting, a name in the question, or the project where there is nothing else. */
  from: 'page' | 'sitting' | 'named' | 'project';
  /** What it is called, in the menu's words or the record's. */
  title: string;
  /** The records it is: a fact about any of them is on it. */
  aboutIds: string[];
  /** Or the function of the menu it is, or the department. */
  fn?: string;
  department?: string;
  /** Or the kinds of value it is, by key. */
  keys: string[];
}

export interface MemContextLine {
  /** What the answer cites the line by: m1, m2 and on. */
  mark: string;
  /** The fact's id in memory. */
  id: string;
  tag: MemFactTag;
  /** For a fact that waits: whether the record's rule lets it be acted on. */
  stands?: boolean;
  /** Which of the seeds brought it. */
  seed: number;
  /** The id on the record of what the fact is about. */
  aboutId: string;
  /** The line as the assistant reads it, without its mark. */
  text: string;
}

export interface MemContext {
  seeds: MemSeed[];
  lines: MemContextLine[];
  /** True when the question is about what changed, and a line says what its fact was before. */
  past: boolean;
}

/** The words that make a question one about change. */
const ABOUT_CHANGE = /\b(chang(?:e|ed|es|ing)|before|previous(?:ly)?|earlier|used to|histor(?:y|ical)|what was|was it|correct(?:ed|ion)|revis(?:ed|ion)|updated?|since when|no longer|replaced|set aside|reopen(?:ed)?|originally|at first)\b/i;

/** Whether a question is about what changed, which is when a fact's past is shown. */
export function memAsksAboutChange(question: string): boolean {
  return ABOUT_CHANGE.test(question);
}

/** Words too common, in a label or a question, to say which thing is meant. */
const GENERIC = new Set([
  ...['date', 'paper', 'project', 'record', 'value', 'public', 'check', 'result', 'kind', 'ground'],
  ...['the', 'and', 'for', 'per', 'not', 'yet', 'any', 'all', 'has', 'was', 'are', 'who', 'how', 'its', 'our', 'you', 'can', 'did', 'does', 'have'],
  ...['from', 'with', 'this', 'that', 'what', 'when', 'still', 'only', 'above', 'about', 'there', 'whether', 'anything', 'tell', 'show', 'give', 'say'],
]);

/** A word people say for something the fixed lists name otherwise, and the list's word for it. */
const SAID_AS: Record<string, string> = { seller: 'vendor', buyer: 'purchaser', price: 'consideration', size: 'area', registration: 'registered' };

/** The words of some text, lower case, a plural read as its singular, and a word people say read as the lists' word for it. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))
    .map((word) => SAID_AS[word] ?? word);
}

/** The words of some text that can tell one thing from another: three letters or more, and none of the common ones. */
export function memTellingWords(text: string): string[] {
  return [...new Set(wordsOf(text).filter((word) => word.length >= 3 && !GENERIC.has(word)))];
}

let labelWords: Array<{ key: string; words: string[] }> | undefined;

/** The words of each key's label that tell it from the others: every key a fact told from a paper or a field can have. */
function keysByWord(): Array<{ key: string; words: string[] }> {
  labelWords ??= Object.entries({ ...MEM_FIELD_KEYS, ...RULES_FACT_KEYS, ...STANDARD_FACT_KEYS }).flatMap(([key, rule]) => {
    const words = memTellingWords(rule.label);
    return words.length ? [{ key, words }] : [];
  });
  return labelWords;
}

/** How many kinds of value one question is taken to name, at most. */
const KEYS_NAMED_AT_MOST = 6;

/**
 * The keys a question names, the closest first: those whose label shares at
 * least half its telling words with the question. A label named in full
 * counts before one named in part, and one that shares only words a label
 * named in full already has is not named: "the land area" is the land area,
 * and not the built-up area as well.
 */
function keysNamed(question: string): string[] {
  const said = new Set(wordsOf(question));
  const near = keysByWord()
    .map(({ key, words }) => ({ key, shared: words.filter((word) => said.has(word)), of: words.length }))
    .filter(({ shared, of }) => shared.length / of >= 0.5);
  const inFull = new Set(near.filter(({ shared, of }) => shared.length === of).flatMap(({ shared }) => shared));
  return near
    .filter(({ shared, of }) => shared.length === of || shared.some((word) => !inFull.has(word)))
    .sort((a, b) => b.shared.length / b.of - a.shared.length / a.of || (a.key < b.key ? -1 : 1))
    .slice(0, KEYS_NAMED_AT_MOST)
    .map(({ key }) => key);
}

/** How many records one question is taken to name, at most. */
const RECORDS_NAMED_AT_MOST = 3;

/**
 * What a question is about, at most five things, in the order they are
 * filled: the page, the sitting's record, the records the question names by
 * title, then the kinds of value it names. `project` is the record as this
 * reader may see it, so a record out of their reach is never a seed.
 */
export function memSeeds(project: DdProject, ask: MemAsk): MemSeed[] {
  const seeds: MemSeed[] = [];
  const seen = new Set<string>();
  const add = (seed: MemSeed): void => {
    const what = `${seed.fn ?? ''}|${seed.department ?? ''}|${[...seed.aboutIds].sort().join(',')}|${seed.keys.join(',')}`;
    if (seen.has(what) || seeds.length >= MEM_SEEDS_AT_MOST) return;
    seen.add(what);
    seeds.push(seed);
  };

  const at = menuPlaceOfWords(ask.place);
  if (at.fn) add({ from: 'page', title: chatPlaceLabel(at), aboutIds: [], fn: at.fn, keys: [] });
  else if (at.department) add({ from: 'page', title: chatPlaceLabel(at), aboutIds: [], department: at.department, keys: [] });

  const checks = allChecks(project);
  const papersOf = (checkId: string): string[] => project.evidence.filter((row) => row.checkIds?.includes(checkId)).map((row) => row.id);
  const sat = ask.sitting?.checkId ? checks.find((check) => check.id === ask.sitting?.checkId) : undefined;
  if (sat) {
    add({ from: 'sitting', title: sat.title, aboutIds: [...new Set([sat.id, ...sat.evidenceIds, ...papersOf(sat.id)])], keys: [] });
  } else if (ask.sitting?.scopeId) {
    const scope = project.assessments.flatMap((assessment) => assessment.scopes).find((held) => held.id === ask.sitting?.scopeId);
    if (scope) add({ from: 'sitting', title: SCOPE_LABEL[scope.scopeKey], aboutIds: scope.checks.slice(0, 30).map((check) => check.id), keys: [] });
  }

  // A seed is kept for the kinds of value the question names, however many records it names as well.
  const keys = keysNamed(ask.question);
  const room = MEM_SEEDS_AT_MOST - (keys.length ? 1 : 0);
  let named = 0;
  for (const { confident, sitting } of rankTalkSittings(project, ask.question, 8)) {
    if (!confident || named >= RECORDS_NAMED_AT_MOST || seeds.length >= room) continue;
    const { checkId, evidenceId, actionId } = sitting.extra;
    if (sitting.kind === 'check' && checkId) add({ from: 'named', title: sitting.label, aboutIds: [...new Set([checkId, ...papersOf(checkId)])], keys: [] });
    else if (sitting.kind === 'evidence' && evidenceId) add({ from: 'named', title: sitting.label, aboutIds: [evidenceId], keys: [] });
    else if (sitting.kind === 'action' && actionId) add({ from: 'named', title: sitting.label, aboutIds: [actionId], keys: [] });
    else continue;
    named += 1;
  }
  // Papers named by their kind and not their title: "the sale deed" is every paper the register holds as one.
  const said = new Set(wordsOf(ask.question));
  const kinds = new Map<string, string[]>();
  for (const row of project.evidence) if (row.documentType) kinds.set(row.documentType, [...(kinds.get(row.documentType) ?? []), row.id]);
  for (const [kind, rows] of kinds) {
    const telling = memTellingWords(kind);
    const shared = telling.filter((word) => said.has(word)).length;
    if (!shared || shared / telling.length < 0.5 || named >= RECORDS_NAMED_AT_MOST || seeds.length >= room) continue;
    add({ from: 'named', title: kind, aboutIds: rows.slice(0, 20), keys: [] });
    named += 1;
  }

  if (keys.length) add({ from: 'named', title: 'what the question names', aboutIds: [], keys });

  if (!seeds.length) add({ from: 'project', title: project.name, aboutIds: [project.id], keys: [] });
  return seeds;
}

/** What to ask a store for, to hold every fact any of these seeds can bring. */
export interface MemNear {
  aboutIds: string[];
  fns: string[];
  departments: string[];
  keys: string[];
}

export function memNear(projectId: string, seeds: readonly MemSeed[]): MemNear {
  const pointers = seeds.flatMap((seed) => seed.aboutIds.flatMap((id) => memPointer(projectId, id) ?? []));
  return {
    aboutIds: [...new Set(pointers)],
    fns: [...new Set(seeds.flatMap((seed) => seed.fn ?? []))],
    departments: [...new Set(seeds.flatMap((seed) => seed.department ?? []))],
    keys: [...new Set(seeds.flatMap((seed) => seed.keys))],
  };
}

/** Whether a fact is among what a store is asked for with `near`. A store without a query of its own filters with this. */
export function memIsNear(fact: MemFact, near: MemNear): boolean {
  return (
    near.aboutIds.includes(fact.aboutId) ||
    (fact.fn !== undefined && near.fns.includes(fact.fn)) ||
    (fact.department !== undefined && near.departments.includes(fact.department)) ||
    near.keys.includes(fact.key)
  );
}

/** Every id a line can point at, with the words the record has for it now, keyed as memory keeps the id. */
export function memTitles(project: DdProject): Map<string, string> {
  const titles = new Map<string, string>();
  const name = (id: string, title: string): void => {
    const pointer = memPointer(project.id, id);
    if (pointer && title && !titles.has(pointer)) titles.set(pointer, title);
  };
  name(project.id, 'the project');
  for (const row of project.evidence) name(row.id, row.title);
  for (const check of allChecks(project)) name(check.id, check.title);
  for (const comparable of project.comparables ?? []) name(comparable.id, comparable.title);
  for (const questionnaire of project.questionnaires ?? []) for (const question of questionnaire.questions) name(question.id, question.text.slice(0, 80));
  for (const action of project.actions) name(action.id, action.title);
  for (const card of project.chatProposals ?? []) name(card.id, card.title);
  for (const [parcelRef, label] of parcelLabels(revenueReads(project))) name(parcelRef, `Sy. ${label}`);
  for (const { id, label } of chatLinkLabels(project)) name(id, label);
  return titles;
}

/** Every way a tag is worded, to the assistant and beside an answer. A page that draws a printed tag reads it by this list. */
export const MEM_TAG_WORDS = ['approved', 'waiting · stands', 'waiting', 'thought'] as const;

export type MemTagWords = (typeof MEM_TAG_WORDS)[number];

function tagWords(tag: MemFactTag, stands: boolean | undefined): MemTagWords {
  if (tag === 'approved') return 'approved';
  if (tag === 'thought') return 'thought';
  return stands ? 'waiting · stands' : 'waiting';
}

/** A tag as it is printed beside a statement in an answer. */
export function memTagPrinted(tag: MemFactTag, stands?: boolean): string {
  return `[${tagWords(tag, stands)}]`;
}

const READ_BY: Record<string, string> = { rules: 'read by the rules', model: 'read by a model', card: 'raised on a card' };

/** One fact as one line: the tag, what it says, what states it, and its date. */
function lineOf(fact: MemFact, titles: ReadonlyMap<string, string>, past: boolean): string {
  const said = typeof fact.value === 'boolean' ? (fact.value ? 'yes' : 'no') : String(fact.value);
  const measured = fact.unit ? `${said} ${fact.unit}` : said;
  const value = fact.display ? (typeof fact.value === 'number' ? `${fact.display} (${measured})` : fact.display) : measured;
  // A note's source is the reply it was left with, whether or not the thread still holds that reply.
  const source = fact.tag === 'thought' ? 'a reply in chat' : (titles.get(fact.source) ?? 'a record no longer on file');
  const about = titles.get(fact.aboutId);
  const parts = [
    tagWords(fact.tag, fact.stands),
    fact.tag === 'thought' ? said : `${fact.label}: ${value}`,
    ...(about && fact.aboutId !== fact.source ? [`about: ${about}`] : []),
    `source: ${source}${fact.page ? `, p.${fact.page}` : ''}`,
    ...(fact.tag === 'proposed' && fact.readBy ? [READ_BY[fact.readBy]!] : []),
    ...(fact.contests ? ['another reader reads it differently'] : []),
    ...(fact.validFrom || fact.validTo ? [`holds ${fact.validFrom ?? 'from a day not stated'} to ${fact.validTo ?? 'a day not stated'}`] : []),
    (fact.at ?? fact.recordedAt).slice(0, 10),
    ...(past && fact.was?.length ? [`before: ${fact.was.map((was) => `${was.what.replace('_', ' ')} ${was.at.slice(0, 10)}${was.said ? ` (${was.said})` : ''}`).join('; ')}`] : []),
  ];
  return parts.join(' · ');
}

/** Where a fact comes in a seed's eight: a person's word first, then a reading the record lets stand, then one that waits. */
function rank(fact: MemFact): number {
  return fact.tag === 'approved' ? 0 : fact.stands ? 1 : 2;
}

const newestFirst = (a: MemFact, b: MemFact): number => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? 1 : -1);

/**
 * The facts each seed brings, in the order of the seeds: at most eight a
 * seed and forty in all, a fact once, under the first seed that takes it.
 * On a seed, the kinds of value the question names come first, then a
 * person's word before a reading, then the newest.
 */
export function memBySeed(projectId: string, facts: readonly MemFact[], seeds: readonly MemSeed[]): MemFact[][] {
  const named = new Set(seeds.flatMap((seed) => seed.keys));
  const taken = new Set<string>();
  let room = MEM_CONTEXT_FACTS;
  return seeds.map((seed) => {
    const near = memNear(projectId, [seed]);
    const own = facts.filter((fact) => !taken.has(fact.id) && memIsNear(fact, near));
    // Notes take at most two of a seed's places, unless notes are what the question asked for by name.
    const notes = own.filter((fact) => fact.tag === 'thought').sort(newestFirst).slice(0, seed.keys.includes('note') ? MEM_SEED_FACTS : MEM_SEED_THOUGHTS);
    const held = own
      .filter((fact) => fact.tag !== 'thought')
      .sort((a, b) => Number(named.has(b.key)) - Number(named.has(a.key)) || rank(a) - rank(b) || newestFirst(a, b))
      .slice(0, MEM_SEED_FACTS - notes.length);
    const brought = [...held, ...notes].slice(0, room);
    room -= brought.length;
    for (const fact of brought) taken.add(fact.id);
    return brought;
  });
}

/**
 * The lines the assistant is shown, from the facts this reader may see.
 *
 * `project` is the record as the reader may see it: it names the seeds and
 * gives every title. `facts` is what memory holds for them, or what the
 * record gives when memory has not answered.
 */
export function memContext(project: DdProject, facts: readonly MemFact[], ask: MemAsk, seeds: MemSeed[] = memSeeds(project, ask)): MemContext {
  const past = memAsksAboutChange(ask.question);
  const titles = memTitles(project);
  const lines: MemContextLine[] = [];
  memBySeed(project.id, facts, seeds).forEach((brought, at) => {
    for (const fact of brought) {
      lines.push({
        mark: `m${lines.length + 1}`,
        id: fact.id,
        tag: fact.tag,
        ...(fact.tag === 'proposed' ? { stands: fact.stands === true } : {}),
        seed: at,
        aboutId: fact.aboutId,
        text: lineOf(fact, titles, past),
      });
    }
  });
  return { seeds, lines, past };
}

const SEED_HEAD: Record<MemSeed['from'], string> = { page: 'On', sitting: 'On the record in front of the person,', named: 'About', project: 'About' };

/** The lines as the assistant is given them, under the seed that brought each. Nothing when memory holds nothing near the question. */
export function memContextText(context: MemContext): string {
  if (!context.lines.length) return '';
  const out = ['Memory lines for this question (each marked, and tagged by the system):'];
  context.seeds.forEach((seed, at) => {
    const own = context.lines.filter((line) => line.seed === at);
    if (!own.length) return;
    out.push(`${SEED_HEAD[seed.from]} ${seed.title}:`);
    for (const line of own) out.push(`[${line.mark}] ${line.text}`);
  });
  return out.join('\n');
}

/**
 * What the assistant is told about memory lines and about leaving a note.
 * One wording for every model that answers in the chat.
 */
export const MEM_ANSWER_RULES = `Memory lines: a question may come with lines from the project's memory, each with a mark (m1, m2 and on) and a tag the system set. "approved" is a value a person typed or accepted. "waiting" is a value read off a paper or raised on a card that nobody has decided; "waiting · stands" is one the file's own rule lets be acted on meanwhile. "thought" is an earlier note of yours and no fact of the file. When a sentence of your answer rests on a line, end that sentence with the line's mark in square brackets, like [m2]. Never write a tag yourself and never make up a mark: the system prints the tag where the mark stands. Say that a waiting value is not yet accepted when the answer turns on it. Never give a figure, a date or a name on the strength of a thought alone.
Note to memory: when this turn taught you something about the project that is worth keeping and no memory line already says it, end your answer with one last line in exactly this form: "Note to memory: " and then one plain sentence of under 300 characters. When it is about one record, put that record's id in square brackets after the word memory: "Note to memory [id]: ...". Leave the line out when there is nothing worth keeping. Never put a phone number, an identity number, an account number or an email address in it.`;

/**
 * A fact an answer rests on, with the tag it had when the answer was given
 * and where in the answer's text the tag is printed: the place of each `[`.
 * A page draws a tag as a tag at those places and nowhere else, so nothing an
 * answer says in words can be drawn as one.
 */
export interface MemRest {
  id: string;
  tag: MemFactTag;
  stands?: boolean;
  at: number[];
}

/**
 * What in an answer reads as a tag or a mark: square brackets round a mark
 * or several ("(m2)" in round ones is square metres), or round one of the
 * words a tag is said in, whatever its case. Matched from its bracket, with
 * no run of spaces before it to read through again and again.
 */
const TOKEN = /\[\s{0,3}(?:(m\d{1,3}(?:\s{0,3}[,;]\s{0,3}m\d{1,3}){0,20})|approved|proposed|waiting(?:\s{0,3}[·,]\s{0,3}stands)?|thought)\s{0,3}\]/gi;

/** How many times over an answer is read for tags of its own before its square brackets are taken out altogether. */
const OWN_TAG_PASSES = 40;

/** Some text without the spaces and tabs it ends in. */
function closedUp(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/**
 * One reading of an answer. Each token is given to `put`, which answers what
 * to write in its place: nothing takes it out with the spaces before it, and
 * `undefined` leaves it as it is. `put` is told where in the new text what
 * it writes will begin. What has been written never ends in a space, so the
 * spaces to close up are only ever those of the stretch just before a token.
 */
function rewritten(text: string, put: (marks: string | undefined, at: number) => string | undefined): string {
  const pieces: string[] = [];
  let length = 0;
  let from = 0;
  for (const found of text.matchAll(TOKEN)) {
    const end = found.index + found[0].length;
    const before = closedUp(text.slice(from, found.index));
    const written = put(found[1], length + before.length);
    const piece = written === undefined ? text.slice(from, end) : before + written;
    pieces.push(piece);
    length += piece.length;
    from = end;
  }
  pieces.push(text.slice(from));
  return pieces.join('');
}

/**
 * An answer with its tags printed.
 *
 * First everything the answer wrote that reads as a tag goes, and every mark
 * that names no line, again and again until nothing more does: two halves of
 * a tag with something between them close up into a tag once the something
 * is taken out, and that one goes on the next reading. Then every mark left
 * names a line, and the tag of that line is printed where the mark stood.
 *
 * `rests` is the facts cited, once each, in the order they were, with the
 * place of every tag printed for them. The text is not changed after this:
 * the places are places in the text as it is returned.
 */
export function memTagsPrinted(text: string, context: { lines: ReadonlyArray<Pick<MemContextLine, 'mark' | 'id' | 'tag' | 'stands'>> } | undefined): { text: string; rests: MemRest[] } {
  const byMark = new Map((context?.lines ?? []).map((line) => [line.mark, line]));
  const named = (marks: string) => marks.toLowerCase().split(/\s*[,;]\s*/).flatMap((mark) => byMark.get(mark) ?? []);

  let clean = text;
  for (let pass = 0; ; pass += 1) {
    const next = rewritten(clean, (marks) => (marks && named(marks).length ? undefined : ''));
    if (next === clean) break;
    clean = next;
    // An answer built to need this many readings is not one to print tags on. Without a bracket it holds neither a tag nor a mark.
    if (pass >= OWN_TAG_PASSES) {
      clean = clean.replace(/[[\]]/g, '');
      break;
    }
  }

  const rests: MemRest[] = [];
  const printed = rewritten(clean, (marks, at) => {
    let written = '';
    const places = new Map<string, number>();
    for (const line of named(marks ?? '')) {
      const tag = memTagPrinted(line.tag, line.stands);
      // Two lines of one tag cited together are one tag printed, and both rest on it.
      if (!places.has(tag)) {
        places.set(tag, at + written.length + 1);
        written += ` ${tag}`;
      }
      const rest = rests.find((held) => held.id === line.id);
      if (rest) rest.at.push(places.get(tag)!);
      else rests.push({ id: line.id, tag: line.tag, ...(line.stands === undefined ? {} : { stands: line.stands }), at: [places.get(tag)!] });
    }
    return written;
  });
  return { text: printed, rests };
}
