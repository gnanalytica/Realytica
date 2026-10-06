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

/** Words too common in a label to say which key a question means. */
const GENERIC = new Set(['number', 'date', 'from', 'with', 'this', 'that', 'what', 'when', 'paper', 'project', 'record', 'value', 'public', 'check', 'result', 'kind', 'still', 'only', 'above', 'ground']);

/** The words of some text, lower case, a plural read as its singular. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
}

let labelWords: Array<{ key: string; words: string[] }> | undefined;

/** The words of each key's label that tell it from the others: every key a fact told from a paper or a field can have. */
function keysByWord(): Array<{ key: string; words: string[] }> {
  labelWords ??= Object.entries({ ...MEM_FIELD_KEYS, ...RULES_FACT_KEYS, ...STANDARD_FACT_KEYS }).flatMap(([key, rule]) => {
    const words = wordsOf(rule.label).filter((word) => word.length >= 4 && !GENERIC.has(word));
    return words.length ? [{ key, words }] : [];
  });
  return labelWords;
}

/** How many kinds of value one question is taken to name, at most. */
const KEYS_NAMED_AT_MOST = 6;

/** The keys a question names: those whose label shares at least half its telling words with the question, the closest first. */
function keysNamed(question: string): string[] {
  const said = new Set(wordsOf(question));
  return keysByWord()
    .map(({ key, words }) => ({ key, share: words.filter((word) => said.has(word)).length / words.length }))
    .filter(({ share }) => share >= 0.5)
    .sort((a, b) => b.share - a.share || (a.key < b.key ? -1 : 1))
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
function titlesOf(project: DdProject): Map<string, string> {
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
 * The lines the assistant is shown, from the facts this reader may see.
 *
 * `project` is the record as the reader may see it: it names the seeds and
 * gives every title. `facts` is what memory holds for them, or what the
 * record gives when memory has not answered.
 */
export function memContext(project: DdProject, facts: readonly MemFact[], ask: MemAsk, seeds: MemSeed[] = memSeeds(project, ask)): MemContext {
  const past = memAsksAboutChange(ask.question);
  const titles = titlesOf(project);
  const named = new Set(seeds.flatMap((seed) => seed.keys));
  const taken = new Set<string>();
  const lines: MemContextLine[] = [];
  seeds.forEach((seed, at) => {
    const near = memNear(project.id, [seed]);
    const own = facts.filter((fact) => !taken.has(fact.id) && memIsNear(fact, near));
    // Notes take at most two of a seed's places, unless notes are what the question asked for by name.
    const notes = own.filter((fact) => fact.tag === 'thought').sort(newestFirst).slice(0, seed.keys.includes('note') ? MEM_SEED_FACTS : MEM_SEED_THOUGHTS);
    const held = own
      .filter((fact) => fact.tag !== 'thought')
      .sort((a, b) => Number(named.has(b.key)) - Number(named.has(a.key)) || rank(a) - rank(b) || newestFirst(a, b))
      .slice(0, MEM_SEED_FACTS - notes.length);
    for (const fact of [...held, ...notes]) {
      if (lines.length >= MEM_CONTEXT_FACTS) return;
      taken.add(fact.id);
      lines.push({
        mark: `m${lines.length + 1}`,
        id: fact.id,
        tag: fact.tag,
        ...(fact.tag === 'proposed' ? { stands: fact.stands === true } : {}),
        seed: at,
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

/** A fact an answer rests on, with the tag it had when the answer was given. */
export interface MemRest {
  id: string;
  tag: MemFactTag;
  stands?: boolean;
}

/** A mark, or several, in square brackets. Not in round ones: "(m2)" in an answer is square metres. */
const MARKS = /[ \t]*\[\s*(m\d{1,3}(?:\s*[,;]\s*m\d{1,3})*)\s*\]/gi;
const OWN_TAG = /[ \t]*\[(?:approved|proposed|waiting(?:\s*[·,]\s*stands)?|thought)\]/gi;

/**
 * An answer with its tags printed.
 *
 * Every mark the answer cites is replaced by the tag of the line it names,
 * as this file words it. A mark that names no line is taken out. A tag the
 * answer wrote itself is taken out first, so the only tags left in the text
 * are the ones printed here from a fact. `rests` is the facts cited, once
 * each, in the order they were.
 */
export function memTagsPrinted(text: string, context: Pick<MemContext, 'lines'> | undefined): { text: string; rests: MemRest[] } {
  const byMark = new Map((context?.lines ?? []).map((line) => [line.mark, line]));
  const rests: MemRest[] = [];
  const printed = text.replace(OWN_TAG, '').replace(MARKS, (_whole, marks: string) => {
    const tags: string[] = [];
    for (const mark of marks.toLowerCase().split(/\s*[,;]\s*/)) {
      const line = byMark.get(mark);
      if (!line) continue;
      if (!rests.some((rest) => rest.id === line.id)) rests.push({ id: line.id, tag: line.tag, ...(line.stands === undefined ? {} : { stands: line.stands }) });
      const tag = memTagPrinted(line.tag, line.stands);
      if (!tags.includes(tag)) tags.push(tag);
    }
    return tags.length ? ` ${tags.join(' ')}` : '';
  });
  return { text: printed, rests };
}
