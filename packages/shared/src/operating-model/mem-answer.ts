/**
 * Memory said to a person, by rule: made by code from the facts, and worded
 * by no model.
 *
 * Two things. Under an answer the chat gave by rule, the facts memory holds
 * that bear on what was asked, each with its tag: at most four, the ones that
 * wait first, and nothing where none does (`memUnderAnswer`). And the answer
 * to a question put to memory itself: what it holds about something, what
 * was agreed about it, what is still undecided, what changed
 * (`memAsksMemory`, `memAnswer`).
 *
 * A fact is said in one line: what it says, its tag, who approved it or how
 * it was read, when, and what states it. The tag is printed here from the
 * fact, and the line keeps where in the text it stands, so that a page draws
 * it as a tag there and nowhere else (`MemRest`). A paper that states a fact
 * is written as a citation, which the page draws as a chip that opens the
 * paper at the page. What follows the tag is words with commas between, and
 * the citation ends the line after a space: wherever the line wraps, no mark
 * is left alone at an end or carried to the next. A value two papers state
 * alike, as two copies of one paper do, is one line cited to both.
 *
 * Pure. The caller hands in the facts this reader may see, and `project` is
 * the record as they may see it: it gives every title and every name.
 */

import { ACTION_KIND_LABEL, ACTION_STATUS_LABEL, DECISION_STATUS_LABEL, DECISION_TYPE_LABEL } from './catalogs';
import { chatPlaceLabel } from './chat-places';
import { DEPARTMENT_SHORT, MENU_DEPARTMENTS, menuFunctions } from './departments';
import { allChecks } from './engagements';
import { acceptedFacts } from './fact-review';
import { asksForAFact, citeToken, factKeysAsked, saidInPassing, withoutFarAsACommonWord } from './file-answers';
import { memIsNear, memNear, memSeeds, memTagPrinted, memTellingWords, memTitles, type MemAsk, type MemRest, type MemSeed } from './mem-context';
import { memWho } from './mem-delta';
import { memFormOfKey, type MemFact } from './mem-facts';
import { meetingCalled, meetingDayIn, meetingItemStands, meetingNotesMark, meetingOfRecord, meetingsHeld } from './meetings';
import type { DdProject } from './types';

/** How many facts are said under an answer the chat gave by rule. */
export const MEM_UNDER_ANSWER = 4;

/** How many facts, records and notes one answer from memory lists, at most. */
export const MEM_ANSWER_FACTS = 8;
export const MEM_ANSWER_RECORDS = 4;
export const MEM_ANSWER_NOTES = 3;

/** Something said from memory: the words, and the facts they rest on with where each one's tag stands in them. */
export interface MemSaid {
  text: string;
  rests: MemRest[];
}

/** What the server reading a paper is called on the record. */
const SERVER = 'system';

/** The people the record names, by the id memory keeps for each on this project. */
export function memPeople(project: DdProject): Map<string, string> {
  const people = new Map<string, string>([[memWho(project.id, SERVER), SERVER]]);
  const named = [
    ...(project.audit ?? []).map((event) => event.actor),
    ...(project.conversation ?? []).map((turn) => turn.actor),
    // Who recorded a value on a check, decided a paper's value or a comparable, or answered a question is kept beside it, and may be on no line of the trail.
    ...allChecks(project).flatMap((check) => Object.values(check.fields ?? {}).map((held) => held.by)),
    ...project.evidence.flatMap((row) => acceptedFacts(row).map((fact) => fact.decidedBy)),
    ...(project.comparables ?? []).flatMap((comparable) => [comparable.addedBy, comparable.decidedBy]),
    ...(project.questionnaires ?? []).flatMap((questionnaire) => questionnaire.questions.map((question) => question.answeredBy)),
    // So is who made a site entry, who approved a draft for sending, and who marked a paper reviewed.
    ...(project.siteLog ?? []).map((entry) => entry.author),
    ...(project.outgoing ?? []).map((draft) => draft.approvedBy),
    ...Object.values(project.reviewTable?.reviewed ?? {}).map((mark) => mark.by),
  ];
  for (const actor of named) if (actor) people.set(memWho(project.id, actor), actor);
  return people;
}

interface Names {
  projectId: string;
  titles: ReadonlyMap<string, string>;
  /** The papers on the register, by id: a fact one of them states is cited to it. */
  papers: ReadonlySet<string>;
  people: ReadonlyMap<string, string>;
  /** Where each decision and action stands on the record, in the record's own words, whether it is still open, and the meeting it came out of where it came out of one. */
  records: ReadonlyMap<string, { stands: string; open: boolean; unmade?: boolean; from?: string }>;
}

/** The standings a decision has while nobody has settled it. */
const DECISION_OPEN = new Set(['proposed', 'pending', 'deferred']);

function namesOf(project: DdProject): Names {
  const records = new Map<string, { stands: string; open: boolean; unmade?: boolean; from?: string }>();
  // The meeting a record came out of, with the mark that opens its notes at the words the record rests on.
  const from = (recordId: string): { from?: string } => {
    const made = meetingOfRecord(project, recordId);
    return made ? { from: `from ${meetingCalled(made.meeting)} ${meetingNotesMark(made.meeting.id, made.item.id)}` } : {};
  };
  // Pending is how a point left open stands: a decision that is on the record and that nobody has made.
  for (const decision of project.decisions) records.set(decision.id, { stands: DECISION_STATUS_LABEL[decision.status].toLowerCase(), open: DECISION_OPEN.has(decision.status), ...(decision.status === 'pending' ? { unmade: true } : {}), ...from(decision.id) });
  for (const action of project.actions) records.set(action.id, { stands: ACTION_STATUS_LABEL[action.status].toLowerCase(), open: action.status !== 'closed', ...from(action.id) });
  return { projectId: project.id, titles: memTitles(project), papers: new Set(project.evidence.map((row) => row.id)), people: memPeople(project), records };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day as it is written for a person: 6 Oct 2026. From the day the record names, whatever the time zone of the reader. */
function dayOf(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return year && month && day ? `${day} ${MONTHS[month - 1]} ${year}` : iso;
}

const grouped = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function rupees(n: number): string {
  if (n >= 1e7) return `Rs ${grouped(n / 1e7)} Cr`;
  if (n >= 1e5) return `Rs ${grouped(n / 1e5)} lakh`;
  return `Rs ${grouped(n)}`;
}

/** A fact's value as a person reads it: the record's own way of writing it where it has one, else by the form its key takes. */
function valueOf(fact: MemFact): string {
  if (fact.key === 'decision') return DECISION_TYPE_LABEL[fact.value as keyof typeof DECISION_TYPE_LABEL] ?? String(fact.value);
  if (fact.key === 'action') return ACTION_KIND_LABEL[fact.value as keyof typeof ACTION_KIND_LABEL] ?? String(fact.value);
  if (fact.display) return fact.display;
  if (typeof fact.value === 'boolean') return fact.value ? 'yes' : 'no';
  const form = memFormOfKey(fact.key, fact.label);
  if (typeof fact.value === 'number') {
    if (form === 'rupees') return rupees(fact.value);
    if (form === 'sqm') return `${grouped(fact.value)} sqm`;
    if (form === 'feet') return `${grouped(fact.value)} ft`;
    return fact.unit ? `${grouped(fact.value)} ${fact.unit}` : grouped(fact.value);
  }
  if (form === 'date') return dayOf(fact.value);
  return form === 'lower' ? fact.value.replaceAll('_', ' ') : fact.value;
}

const HOW_READ: Record<string, string> = { rules: 'read by the rules', model: 'read by a model', card: 'raised on a card' };
const WHAT_HAPPENED: Record<string, string> = { accepted: 'accepted', corrected: 'corrected', set_aside: 'set aside', reopened: 'reopened', changed: 'changed' };

/** One line of something said, and the fact whose tag it prints, with where in the line the tag stands. */
interface Line {
  text: string;
  rest?: { fact: MemFact; at: number };
}

/** A fact to say, and the others that state the same value and are cited beside it. */
interface Stated {
  fact: MemFact;
  also: MemFact[];
}

/**
 * Facts each said once. Papers that state the same kind of value, with the
 * same value, standing the same way, say one thing: the first of them is
 * said, and the rest are cited on its line. Two copies of a paper on the
 * register would otherwise say every value twice.
 */
function saidOnce(facts: readonly MemFact[], names: Names): Stated[] {
  const out: Stated[] = [];
  const held = new Map<string, Stated>();
  for (const fact of facts) {
    const paper = names.papers.has(fact.source) && fact.tag !== 'thought' && fact.key !== 'decision' && fact.key !== 'action';
    const what = paper ? [fact.label, valueOf(fact), memTagPrinted(fact.tag, fact.stands), fact.aboutId === fact.source ? '' : fact.aboutId].join('|') : undefined;
    const first = what ? held.get(what) : undefined;
    if (first) {
      first.also.push(fact);
      continue;
    }
    const one: Stated = { fact, also: [] };
    if (what) held.set(what, one);
    out.push(one);
  }
  return out;
}

const words = (text: string): Line => ({ text });

/**
 * One fact as one line for a person: what it says, its tag, who approved it
 * or how it was read, when, and what states it. `past` adds what it was
 * before. `also` is the other papers that state the same, cited after its
 * own.
 */
function lineOf(fact: MemFact, names: Names, past = false, also: readonly MemFact[] = []): Line {
  const tag = memTagPrinted(fact.tag, fact.stands);
  const titled = (id: string): string | undefined => (id === names.projectId ? undefined : names.titles.get(id));
  const when = dayOf(fact.at ?? fact.recordedAt);
  const about = fact.aboutId === fact.source ? undefined : titled(fact.aboutId);
  const person = fact.by ? names.people.get(fact.by) : undefined;
  const by = person ? `by ${person}` : undefined;
  let head: string;
  let after: Array<string | undefined>;
  // The papers that state it, each a citation the page draws as a chip that opens the paper at the page.
  let cited: string[] = [];
  if (fact.tag === 'thought') {
    head = String(fact.value);
    after = [when, about ? `about “${about}”` : undefined];
  } else if (fact.key === 'decision' || fact.key === 'action') {
    // The tag is for the recording, which a person made. Where the decision or the action itself stands is the record's word, said beside its kind.
    const record = names.records.get(fact.aboutId);
    // A decision nobody has made yet is said to be that: its tag is for a person having put it on the record, not for its being settled.
    const what = fact.key === 'action' ? 'Action recorded' : record?.unmade ? 'Decision still to be made' : 'Decision recorded';
    // A kind that says nothing, "other", is left unsaid.
    const kind = fact.value === 'other' ? undefined : valueOf(fact);
    // Where the record stands is said once: an approved decision has the tag beside it, which says so.
    const stands = record && tag === `[${record.stands}]` ? undefined : record?.stands;
    const standing = [kind, stands].filter(Boolean).join(', ');
    head = `${what}: “${names.titles.get(fact.aboutId) ?? 'a record no longer on file'}”${standing ? ` (${standing})` : ''}`;
    after = [by, when, record?.from];
  } else {
    const source = titled(fact.source);
    head = `${fact.label}: ${valueOf(fact)}`;
    after = [
      fact.tag === 'approved' ? by : HOW_READ[fact.readBy ?? ''],
      when,
      // A card or a turn that states it is named in words. A paper is cited, at the end of the line.
      source && !names.papers.has(fact.source) ? `“${source}”${fact.page ? `, p.${fact.page}` : ''}` : undefined,
      about ? `on “${about}”` : undefined,
      fact.contests ? 'another reader reads it differently' : undefined,
      // What holds for one day says the day once.
      fact.validFrom && fact.validFrom === fact.validTo
        ? `holds for ${dayOf(fact.validFrom)}`
        : fact.validFrom || fact.validTo
          ? `holds ${fact.validFrom ? dayOf(fact.validFrom) : 'from a day not stated'} to ${fact.validTo ? dayOf(fact.validTo) : 'a day not stated'}`
          : undefined,
      past && fact.was?.length
        ? `before: ${fact.was.map((was) => `${WHAT_HAPPENED[was.what] ?? was.what} ${dayOf(was.at)}${was.said ? ` (${was.said})` : ''}`).join('; ')}`
        : undefined,
    ];
    cited = [...new Set([fact, ...also].filter((stated) => names.papers.has(stated.source)).map((stated) => citeToken(stated.source, stated.page)))];
  }
  const lead = `- ${head} `;
  // The tag, then the rest in words with commas between: a line that ends anywhere leaves no mark alone at its end or at the head of the next.
  return { text: [`${lead}${tag}`, after.filter(Boolean).join(', '), ...cited].filter(Boolean).join(' '), rest: { fact, at: lead.length } };
}

/** Lines as one text, with the place of every tag in it. A fact said twice rests once, with both places. */
function said(lines: readonly Line[]): MemSaid {
  const rests: MemRest[] = [];
  let length = 0;
  for (const line of lines) {
    if (line.rest) {
      const { fact, at } = line.rest;
      const held = rests.find((rest) => rest.id === fact.id);
      if (held) held.at.push(length + at);
      else rests.push({ id: fact.id, tag: fact.tag, ...(fact.tag === 'proposed' ? { stands: fact.stands === true } : {}), at: [length + at] });
    }
    length += line.text.length + 1;
  }
  return { text: lines.map((line) => line.text).join('\n'), rests };
}

/** Something said from memory, put under an answer: a line left blank between, and every place moved by what stands above. */
export function memSaidUnder(answer: string, under: MemSaid): MemSaid {
  const above = answer.trimEnd();
  if (!above) return under;
  const moved = above.length + 2;
  return { text: `${above}\n\n${under.text}`, rests: under.rests.map((rest) => ({ ...rest, at: rest.at.map((at) => at + moved) })) };
}

/** Where a fact comes among those said under an answer: what waits before what stands, a person's word next, a note last. */
function waitingFirst(fact: MemFact): number {
  if (fact.tag === 'proposed') return fact.stands ? 1 : 0;
  return fact.tag === 'approved' ? 2 : 3;
}

const newestFirst = (a: MemFact, b: MemFact): number => {
  const [x, y] = [a.at ?? a.recordedAt, b.at ?? b.recordedAt];
  return x === y ? (a.id < b.id ? -1 : 1) : x < y ? 1 : -1;
};

/** The words that make a question one about the project as a whole. */
const OF_THE_PROJECT = /\b(?:this|the|our|my) (?:project|file|site|plot|property|deal)\b|\bso far\b|\boverall\b/i;

/**
 * Where a word that is also the name of a kind of value is the common word
 * and not the name: "let me know", "let's see". "Far" in "how far back" and
 * "so far" is taken out the same way (`withoutFarAsACommonWord`): FAR is the
 * floor area ratio, and neither is about it.
 */
const LET_AS_A_COMMON_WORD = /\blet(?:'s|’s)?\s+(?:me|us|them|him|her|it)\b/gi;

/** A kind of value written out in full where its label has the short form. */
const SAID_IN_FULL = /\bfloor[\s-]+area[\s-]+ratio\b|\bfloor[\s-]+space[\s-]+index\b|\bfsi\b/gi;

/** A word for something done. It is said of anything ("has it been paid", "when was it issued"), so alone it names no kind of value. */
const SOMETHING_DONE = /(?<!e)ed$|^(?:paid|done|sold|built|held|kept|made|given|taken)$/;

/** A question that asks who. It is answered by a name: "who paid the tax?" is not answered by how much was paid. */
const ASKS_WHO = /^\W*(?:(?:so|and|ok|okay|hey|please)[\s,]+)?who(?:m|se)?\b/i;
const namesSomebody = (fact: MemFact): boolean => typeof fact.value === 'string' && memFormOfKey(fact.key, fact.label) !== 'date';

/** The kinds a fact can be that are a record and no value: asked by name they are the registers' to list. */
const A_RECORD = new Set(['decision', 'action', 'answer', 'note']);

/** A question as it is meant: a word used as the common word it also is left out, and a kind of value written out in full read as its short name. */
function asMeant(question: string): string {
  return withoutFarAsACommonWord(question).replace(LET_AS_A_COMMON_WORD, ' ').replace(SAID_IN_FULL, ' FAR ');
}

/** The words of a question that say what it is about: the ones of the question as it is meant that can tell one thing from another. */
function subjectWords(question: string): Set<string> {
  return new Set(memTellingWords(asMeant(question)));
}

/**
 * Whether the words name this kind of value in full: every word of its label
 * that tells it apart, and not only a word for something done. A label with
 * one such word ("Project status", "Stage") is named only where that word is
 * all the question is about: in "the status of the mortgage" the question is
 * about the mortgage, and "status" is said of it.
 */
function namesInFull(subject: ReadonlySet<string>, label: string): boolean {
  const telling = memTellingWords(label);
  if (telling.length === 1 && subject.size > 1) return false;
  return telling.some((word) => !SOMETHING_DONE.test(word)) && telling.every((word) => subject.has(word));
}

/**
 * What is said under an answer the chat gave by rule: the facts memory holds
 * that bear on what was asked, at most four, the ones that wait first.
 *
 * A fact bears on a question in one of three ways. The question names its
 * kind of value in full, by the question's own subject words ("the land
 * area", "the permissible FAR"). Or it names no kind in full and is about
 * one the file answers from: "is there a mortgage?" is about what the
 * encumbrance certificate searched and found. Or the question names the
 * record the fact is about, by its title or its kind. A kind of value named
 * is closer to what was asked than a record named, and is what is said.
 *
 * Nothing else brings a fact: not the page the question was asked on, not
 * the record a sitting is on, and not a common word that happens to be in a
 * label. So "far" in "so far" names no FAR, and one word that is a whole
 * label ("status", "type", "name", "stage") names it only where the question
 * is about nothing else. A greeting or a thank-you has nothing under it, with
 * whatever few words were added to it. Nor has a reply that is no answer to
 * what was asked: the caller says nothing under one.
 *
 * A question about the project as a whole, or an answer that is (`whole`),
 * brings what waits anywhere on the project and then the newest of what a
 * named person approved: a field nobody is on record as setting, the city a
 * project was made with, is not news to anybody. No lines are better than
 * lines about something else, so where nothing bears on the question nothing
 * is said. A value two papers state alike is one line (`saidOnce`).
 *
 * `named` is for a question no rule answered. Then only a kind of value the
 * question names in full is said, and it is the answer: "what is the project
 * type?" is the project's own field. A record the question names, or the
 * project as a whole, is where the file stands and not what was asked. And
 * only a question put for a fact is answered so: "why is it residential?" is
 * not answered by saying that it is, nor "who paid the tax?" by the amount.
 */
export function memUnderAnswer(project: DdProject, facts: readonly MemFact[], ask: MemAsk, options: { whole?: boolean; named?: boolean } = {}): MemSaid | undefined {
  if (saidInPassing(ask.question)) return undefined;
  const subject = subjectWords(ask.question);
  const fitting = options.named && ASKS_WHO.test(ask.question) ? facts.filter(namesSomebody) : facts;
  const inFull = fitting.filter((fact) => !A_RECORD.has(fact.key) && namesInFull(subject, fact.label));
  if (options.named && (!inFull.length || !asksForAFact(ask.question))) return undefined;
  const answeredFrom = new Set(inFull.length ? [] : factKeysAsked(ask.question));
  const kinds = inFull.length ? inFull : facts.filter((fact) => answeredFrom.has(fact.key));
  const records = memSeeds(project, { question: ask.question }).filter((seed) => seed.from === 'named' && seed.aboutIds.length);
  const near = memNear(project.id, records);
  const ofRecords = records.length ? facts.filter((fact) => memIsNear(fact, near)) : [];
  let chosen = [...(kinds.length ? kinds : ofRecords)].sort((a, b) => waitingFirst(a) - waitingFirst(b) || newestFirst(a, b));
  if (!chosen.length && (options.whole || OF_THE_PROJECT.test(ask.question))) {
    chosen = facts.filter((fact) => fact.tag === 'proposed' || (fact.tag === 'approved' && fact.by)).sort((a, b) => waitingFirst(a) - waitingFirst(b) || newestFirst(a, b));
  }
  if (!chosen.length) return undefined;
  const names = namesOf(project);
  return said([words('In this project’s memory:'), ...saidOnce(chosen, names).slice(0, MEM_UNDER_ANSWER).map(({ fact, also }) => lineOf(fact, names, false, also))]);
}

/** What a question asks of memory itself. */
export type MemAskedKind = 'holds' | 'agreed' | 'undecided' | 'changed';

export interface MemAsked {
  kind: MemAskedKind;
  /** The words the question gives for what it is about, when it gives them: what follows "about". */
  about?: string;
}

/** A sentence that opens by telling the chat to do something is an instruction, whatever else it says. */
const INSTRUCTION = /^\s*(?:please\s+)?(?:add|log|record|create|request|set|mark|close|open|start|run|file|assign|approve|accept|reject|generate|draft|write|note|delete|clear|remove)\b/i;
const UNDECIDED = /\bundecided\b|\bnot (?:yet )?(?:been )?(?:decided|agreed)\b|\b(?:awaiting|waiting (?:for|on)) (?:a |my |our |your )?decision\b|\bstill to (?:be )?decided?\b/i;
const CHANGED = /\bwhat(?:'s|’s| has| have| had)? changed\b|\bhow (?:has|have|did) [^.?!]{1,80}? changed?\b|\bhistory of\b/i;
const AGREED = /\bwhat (?:was|were|has been|have been|had been|have we|had we|did we|do we)\b[^.?!]{0,40}?\b(?:agreed?|decided?|settled?)\b|\bwhat(?:'s|’s) been (?:agreed|decided|settled)\b/i;
const HOLDS =
  /\bmemory\b[^.?!]{0,40}?\b(?:holds?|says?|knows?|ha(?:s|ve)|contains?|remembers?)\b|\b(?:what(?:'s|’s| is)|anything|everything) in (?:the |this project(?:'s|’s) )?memory\b|\bwhat (?:do|did) we (?:already |currently |actually )?know\b|\bwhat is (?:known|on record)\b/i;
const ABOUT = /\b(?:about|regarding|concerning)\s+([^?!]{1,200})/i;
const AFTER = /^\W{0,3}(?:on|for|of|in|at|with|to)\s+([^?!]{1,200})/i;

/**
 * Whether a question asks memory itself, and what about: what memory holds
 * or what we know, what was agreed or decided, what is still undecided, or
 * what changed. Nothing for any other sentence, and nothing for one that
 * opens as an instruction. "What do you know about" is put to the assistant
 * and not to memory, and is left to it.
 */
export function memAsksMemory(question: string): MemAsked | undefined {
  const q = question.trim();
  if (!q || q.length > 600 || INSTRUCTION.test(q)) return undefined;
  const found = ([['undecided', UNDECIDED], ['changed', CHANGED], ['agreed', AGREED], ['holds', HOLDS]] as const).flatMap(([kind, form]) => {
    const match = form.exec(q);
    return match ? [{ kind, end: match.index + match[0].length }] : [];
  })[0];
  if (!found) return undefined;
  const about = (ABOUT.exec(q)?.[1] ?? AFTER.exec(q.slice(found.end))?.[1])?.trim().replace(/[\s.,;:]+$/, '');
  return { kind: found.kind, ...(about ? { about } : {}) };
}

/** What a question to memory is about, as memory can find it. */
interface Subject {
  /** What to call it in the answer. */
  called: string;
  /** The whole project: every fact memory holds. */
  everything: boolean;
  seeds: MemSeed[];
  /** The words the question gave for it, the ones that tell one thing from another: a title, a note or a kind of value that has them is about it. */
  telling: string[];
  /** A line to end the answer with: for a meeting, how much of its notes still waits on cards. */
  also?: string;
}

const THE_PROJECT = /^(?:(?:this|the|our|my|whole|entire)\s+){0,2}(?:project|file|site|plot|property|deal)$|^(?:it|this|everything|anything|all of it)$/i;
const THIS_PAGE = /^(?:this|the) page$|^here$/i;
/** A page of the menu asked about by its name and nothing else: "title", "the Approvals page", "legal". */
const A_PAGE = /^(?:the\s+)?([a-z]+)(?:\s+(?:page|function|department))?$/i;

/** The words a person gave for what they asked about, cut at where the sentence goes on to something else. */
function calledAs(about: string): string {
  const cut = about.split(/,| and (?:whether|if|what|how|who|when|why)\b| — | - /i)[0]!.trim();
  return cut.length <= 48 ? cut : `${cut.slice(0, 47).trimEnd()}…`;
}

/**
 * What a question to memory is about. The words after "about" where the
 * question has them, and then nothing memory cannot find by them is a
 * subject. Without them, whatever the question names, or the project.
 */
function subjectOf(project: DdProject, asked: MemAsked, ask: MemAsk): Subject | undefined {
  const about = asked.about;
  const whole: Subject = { called: 'this project', everything: true, seeds: [{ from: 'project', title: project.name, aboutIds: [project.id], keys: [] }], telling: [] };
  if (about && THE_PROJECT.test(about)) return whole;
  if (about && THIS_PAGE.test(about)) {
    const here = memSeeds(project, { question: '', place: ask.place }).filter((seed) => seed.from === 'page');
    return here.length ? { called: `the ${here[0]!.title} page`, everything: false, seeds: here, telling: [] } : whole;
  }
  const met = about ? meetingAsked(project, about) : undefined;
  if (met) return met;
  const named = memSeeds(project, { question: asMeant(about ?? ask.question) }).filter((seed) => seed.from === 'named');
  const page = about ? A_PAGE.exec(about)?.[1]?.toLowerCase() : undefined;
  const pages: MemSeed[] = !page
    ? []
    : MENU_DEPARTMENTS.flatMap((menu) => [
        ...(DEPARTMENT_SHORT[menu].toLowerCase() === page ? [{ from: 'page' as const, title: chatPlaceLabel({ department: menu }), aboutIds: [], department: menu, keys: [] }] : []),
        ...menuFunctions(menu).flatMap((fn) => (fn.label.toLowerCase() === page ? [{ from: 'page' as const, title: chatPlaceLabel({ fn: fn.key }), aboutIds: [], fn: fn.key, keys: [] }] : [])),
      ]);
  const seeds = [...named, ...pages];
  if (!seeds.length && about) {
    // No record goes by these words as its title. A decision or an action is still about them when its own title has every one that tells.
    const telling = memTellingWords(calledAs(about));
    const has = (title: string): boolean => {
      const words = new Set(memTellingWords(title));
      return telling.length > 0 && telling.every((word) => words.has(word));
    };
    const ids = [...project.decisions.filter((decision) => has(decision.title)), ...project.actions.filter((action) => has(action.title))].map((record) => record.id);
    if (ids.length) return { called: calledAs(about), everything: false, seeds: [{ from: 'named', title: calledAs(about), aboutIds: ids.slice(0, 40), keys: [] }], telling: [] };
  }
  if (!seeds.length) return about ? undefined : whole;
  const titles = named.filter((seed) => seed.aboutIds.length).map((seed) => `“${seed.title}”`);
  const called = about ? calledAs(about) : [...titles, ...pages.map((seed) => `the ${seed.title} page`)].slice(0, 2).join(' and ') || 'what the question names';
  return { called, everything: false, seeds, telling: about ? memTellingWords(calledAs(about)) : [] };
}

/**
 * A meeting asked about: "the meeting of 3 October", "the last meeting".
 * The one held on the day the words give, else the latest where they give
 * no day. It is the decisions and actions made from its notes, and the
 * answer ends with how much of the notes still waits on cards.
 */
function meetingAsked(project: DdProject, about: string): Subject | undefined {
  if (!/\bmeetings?\b/i.test(about)) return undefined;
  const held = meetingsHeld(project);
  // A day and a month with no year is read in each meeting's own year.
  const dated = held.find((meeting) => meeting.heldOn && meetingDayIn(about, `${meeting.heldOn.slice(0, 4)}-01-01`) === meeting.heldOn);
  const meeting = dated ?? (/\d/.test(about) ? undefined : held[0]);
  if (!meeting) return undefined;
  const stands = meeting.items.map((item) => meetingItemStands(project, item));
  const waiting = stands.filter((item) => item.standing === 'waiting').length;
  return {
    called: `${meetingCalled(meeting)} ${meetingNotesMark(meeting.id)}`,
    everything: false,
    seeds: [{ from: 'named', title: meeting.title, aboutIds: [meeting.id, ...stands.flatMap((item) => item.recordId ?? [])], keys: [] }],
    telling: [],
    ...(waiting ? { also: `${waiting === 1 ? '1 thing from its notes is' : `${waiting} things from its notes are`} still waiting on a card, and on the record only once accepted.` } : {}),
  };
}

const HEAD: Record<MemAskedKind, (called: string) => string> = {
  holds: (called) => `In memory about ${called}:`,
  agreed: (called) => `Agreed about ${called}:`,
  undecided: (called) => `Still undecided about ${called}:`,
  changed: (called) => `What changed about ${called}:`,
};

/** A list with each thing said once, cut to its length, with a line that says how many more there are. What a fact was before is its own, so with the past asked for each fact has its line. */
function listed(facts: readonly MemFact[], atMost: number, names: Names, past = false): Line[] {
  const stated = past ? facts.map((fact) => ({ fact, also: [] })) : saidOnce(facts, names);
  const more = stated.length - atMost;
  return [...stated.slice(0, atMost).map(({ fact, also }) => lineOf(fact, names, past, also)), ...(more > 0 ? [words(`- and ${more} more`)] : [])];
}

/**
 * The answer to a question put to memory itself.
 *
 * The facts about what was asked, each with its tag, who and when: what a
 * person approved and what waits, in the order the question wants them, and
 * for a question about change what each was before. Then the decisions and
 * actions about it, then the assistant's own notes about it, set apart and
 * said to be thoughts. Asked what was agreed or decided, the decisions and
 * actions come first, those out of a meeting before the rest, and the values
 * follow. One line when the question names nothing memory can find.
 *
 * A value is about what was asked when its kind is the one the question's
 * words name, or it is about a paper they name, or it is on the page they
 * name. One that only shares a word with the question is not: the four
 * boundaries a deed recites say nothing of a boundary wall.
 *
 * `notesUnread` is for a reader of memory whose notes could not be read just
 * now, and adds a line that says so.
 */
export function memAnswer(project: DdProject, facts: readonly MemFact[], asked: MemAsked, ask: MemAsk, options: { notesUnread?: boolean } = {}): MemSaid {
  const subject = subjectOf(project, asked, ask);
  if (!subject) return { text: `Nothing in this project’s memory goes by “${calledAs(asked.about ?? '')}”: no record has that title, and no kind of value has that name.`, rests: [] };
  const names = namesOf(project);
  const near = memNear(project.id, subject.seeds);
  const told = facts.filter((fact) => fact.tag !== 'thought');
  const isRecord = (fact: MemFact): boolean => fact.key === 'decision' || fact.key === 'action';

  // A decision or an action is about the subject when the record ties it to one of the subject's records, or its title has the subject's words.
  const tied = new Set(subject.seeds.flatMap((seed) => seed.aboutIds));
  const ties = (ids: ReadonlyArray<readonly string[] | undefined>): boolean => ids.some((list) => list?.some((id) => tied.has(id)));
  const worded = (text: string | undefined): boolean => {
    if (!subject.telling.length || !text) return false;
    const has = new Set(memTellingWords(text));
    return subject.telling.every((word) => has.has(word));
  };
  const aboutIt = new Set([
    ...project.decisions.filter((d) => ties([d.evidenceIds, d.findingIds, d.riskIds, d.actionIds, d.assessmentIds]) || worded(d.title)).map((d) => d.id),
    ...project.actions.filter((a) => ties([a.evidenceIds, a.checkIds, a.findingIds, a.riskIds]) || worded(a.title)).map((a) => a.id),
  ]);

  // The subject's words name something when every word of one is in the other: "the extent" names the extent per title, "the boundary wall" no boundary.
  const isNamed = (text: string | undefined): boolean => {
    const said = memTellingWords(text ?? '');
    return said.length > 0 && (said.every((word) => subject.telling.includes(word)) || subject.telling.every((word) => said.includes(word)));
  };
  const onThePage = { aboutIds: [], keys: [], fns: near.fns, departments: near.departments };
  const kindOf = new Map(project.evidence.map((row) => [row.id, row.documentType]));
  const bears = (fact: MemFact): boolean =>
    !subject.telling.length || memIsNear(fact, onThePage) || isNamed(fact.label) || isNamed(names.titles.get(fact.aboutId)) || isNamed(kindOf.get(fact.aboutId));
  const own = (subject.everything ? told : told.filter((fact) => memIsNear(fact, near) && bears(fact))).filter((fact) => !isRecord(fact)).sort(newestFirst);
  const records = told
    .filter((fact) => isRecord(fact) && (subject.everything || aboutIt.has(fact.aboutId) || tied.has(fact.aboutId)))
    // Asked what is undecided, only the decisions nobody has settled and the actions nobody has closed.
    .filter((fact) => asked.kind !== 'undecided' || names.records.get(fact.aboutId)?.open !== false)
    .sort(newestFirst);
  const notes = facts
    .filter((fact) => fact.tag === 'thought' && (subject.everything || memIsNear(fact, near) || worded(String(fact.value))))
    .sort(newestFirst);
  const approved = own.filter((fact) => fact.tag === 'approved');
  const waiting = own.filter((fact) => fact.tag === 'proposed').sort((a, b) => waitingFirst(a) - waitingFirst(b));
  const called = subject.called;

  const lines: Line[] = [];
  const part = (head: string, body: Line[]): void => {
    if (!body.length) return;
    if (lines.length) lines.push(words(''));
    lines.push(words(head), ...body);
  };
  if (asked.kind === 'undecided') {
    if (waiting.length) part(HEAD.undecided(called), listed(waiting, MEM_ANSWER_FACTS, names));
    else lines.push(words(`Nothing about ${called} is waiting for a decision.`));
    // What stands beside what waits, where the question is about one thing. For the whole project that is everything else, and is left out.
    if (!subject.everything) part('Agreed so far:', listed(approved, MEM_ANSWER_RECORDS, names));
  } else if (asked.kind === 'agreed') {
    // What was agreed is first what people decided and took on, out of a meeting before any other. The values a person approved follow.
    const outOfAMeeting = (fact: MemFact): number => (names.records.get(fact.aboutId)?.from ? 0 : 1);
    const decided = [...records].sort((a, b) => outOfAMeeting(a) - outOfAMeeting(b));
    part(`Decisions and actions about ${called}:`, listed(decided, MEM_ANSWER_RECORDS, names));
    if (approved.length) part(decided.length ? 'Values approved:' : HEAD.agreed(called), listed(approved, MEM_ANSWER_FACTS, names));
    else if (!decided.length) lines.push(words(`Nothing about ${called} has been agreed yet.`));
    part('Not yet agreed:', listed(waiting, MEM_ANSWER_RECORDS, names));
  } else if (asked.kind === 'changed') {
    const moved = own.filter((fact) => fact.was?.length);
    if (moved.length) part(HEAD.changed(called), listed(moved, MEM_ANSWER_FACTS, names, true));
    else if (own.length) lines.push(words(`Nothing memory holds about ${called} has changed since it was first recorded.`));
    else lines.push(words(`Memory holds nothing about ${called} yet.`));
    part('As it stands:', listed(own.filter((fact) => !fact.was?.length), MEM_ANSWER_RECORDS, names));
  } else if (own.length || records.length || notes.length) {
    // What a person approved first, and room kept for what waits, so that neither crowds the other out of the list.
    const [stands, waits] = [saidOnce(approved, names), saidOnce(waiting, names)];
    const first = stands.slice(0, Math.max(MEM_ANSWER_FACTS - MEM_ANSWER_NOTES, MEM_ANSWER_FACTS - waits.length));
    const then = waits.slice(0, MEM_ANSWER_FACTS - first.length);
    const more = stands.length + waits.length - first.length - then.length;
    part(HEAD.holds(called), [...first, ...then].map(({ fact, also }) => lineOf(fact, names, false, also)).concat(more > 0 ? [words(`- and ${more} more`)] : []));
  } else {
    lines.push(words(`Memory holds nothing about ${called} yet.`));
  }
  // Where nothing was said above them, the decisions and actions are the answer, and their heading says what they are about. Asked what was agreed, they were said first.
  if (asked.kind !== 'agreed') part(asked.kind === 'undecided' ? 'Decisions and actions still open:' : lines.length ? 'Decisions and actions:' : `Decisions and actions about ${called}:`, listed(records, MEM_ANSWER_RECORDS, names));
  part('The assistant’s own notes, which are not facts of the file:', listed(notes, MEM_ANSWER_NOTES, names));
  if (subject.also) lines.push(words(''), words(subject.also));
  if (options.notesUnread) lines.push(words(''), words('The memory store did not answer in time, so the assistant’s own notes are not among these.'));
  return said(lines);
}
