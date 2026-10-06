/**
 * What goes out: a letter, a reply, a request for information, and the
 * minutes of a meeting to circulate, each a draft filled from the record.
 *
 * The frame is set by code: the project, a reference, the day, to whom, the
 * subject, and the paper, meeting or action it is about. So is the list of
 * what the record holds for it, its sources: a value a paper states with its
 * page, a decision, an action, an item of a meeting's notes, and the words of
 * the paper it answers. Only what counts on the record is a source. A value
 * that waits is not one, and a letter cannot state it. Minutes are the one
 * place a waiting thing is said, and there it is said to be waiting.
 *
 * The body is lines of text, one statement a line. A statement that rests on
 * the record ends with the marks of its sources, `[1]`, `[2]`. One with no
 * mark is the drafter's own, and the page shows it for a person to check. A
 * model may write the body (`outgoingBodyHeld`), and nothing it writes is
 * taken on its word: a mark is kept only where it names a source on the
 * list, the statement shares a word or a figure with it, and every figure
 * and month the statement writes is one its sources write. Minutes are put
 * together by code from the meeting the project keeps, and no model words
 * them.
 *
 * A draft changes nothing on the record. A person reads it and changes it
 * on the page. It goes out only after a lead or a signer on the project
 * approves it by name, and a change after that puts it back to draft. An
 * approval is of the draft the approver was shown (`outgoingSeen`): one that
 * has changed since is not approved until it is read again. The app sends
 * nothing: the Word file is a person's to send.
 *
 * Kept pure. This file is imported by the chat's rules, so nothing at its
 * top level calls into another module.
 */

import { roleCanDecide } from './departments';
import { standingFacts } from './fact-review';
import { memSeeds, memTellingWords } from './mem-context';
import { meetingCalled, meetingDay, meetingDayIn, meetingItemStands, meetingKeptLast, meetingsHeld, type MeetingItem, type MeetingRecord } from './meetings';
import { recordAuditEvent } from './operations';
import { reviewFileOf, reviewPapers } from './review-table';
import { departmentRole, projectDepartments } from './team';
import { can, reachesEveryProject, type WorkspaceRole } from './tenancy';
import { plural } from './text';
import type { ActionRecord, ChatChoice, DdProject, DecisionRecord, EvidenceRecord } from './types';
import { normalizeDigits } from '../script';

/* ==================================================================== */
/* What is kept                                                          */
/* ==================================================================== */

export type OutgoingKind = 'letter' | 'reply' | 'rfi' | 'minutes';

export const OUTGOING_KINDS: readonly OutgoingKind[] = ['letter', 'reply', 'rfi', 'minutes'];

export const OUTGOING_KIND_LABEL: Record<OutgoingKind, string> = { letter: 'Letter', reply: 'Reply', rfi: 'Request for information', minutes: 'Minutes' };

/** A kind as it is said in a sentence: "a reply", "the minutes". */
const KIND_SAID: Record<OutgoingKind, string> = { letter: 'a letter', reply: 'a reply', rfi: 'a request for information', minutes: 'the minutes' };

/** What a draft is about: the paper it answers or asks about, the meeting whose minutes it is, or the action it follows. */
export interface OutgoingAbout {
  kind: 'paper' | 'meeting' | 'action';
  id: string;
}

/** One thing the record holds that a statement of a draft may rest on. */
export interface OutgoingSource {
  /** Its number on the draft, from one: what a statement is marked with. */
  n: number;
  kind: 'paper' | 'meeting' | 'decision' | 'action';
  /** The record: the paper, the meeting, the decision, the action. */
  id: string;
  /** For a meeting: the item of its notes. */
  itemId?: string;
  /** What the record is called. */
  title: string;
  /** For a paper: the 1-based page. */
  page?: number;
  /** What it gives, as the record has it. For a passage of a paper, the passage. */
  says: string;
  /** The words of the paper or the notes it rests on. */
  quote?: string;
  /** The words are a passage of the paper's own text, and not a value read off it. */
  passage?: true;
  /** The page's words are OCR's reading of a scan. */
  scanned?: true;
  /** Nobody has accepted it on the record. Said only as waiting, and only in minutes. */
  waiting?: true;
}

export interface OutgoingDraft {
  id: string;
  kind: OutgoingKind;
  /** The firm's own reference, set when the draft is made. */
  ref: string;
  /** The day on it: the day it was made, then the day it was approved. */
  dated: string;
  to: string;
  subject: string;
  about?: OutgoingAbout;
  /** One statement a line, a blank line between paragraphs. A statement that rests on the record ends with the marks of its sources. */
  body: string;
  sources: OutgoingSource[];
  /** Who wrote the body as it stands: a model, code (minutes), a person who has changed it since, or nobody yet. */
  written: 'model' | 'code' | 'person' | 'none';
  /** The words it was asked for with. */
  asked?: string;
  status: 'draft' | 'approved';
  /** Who approved it for sending, as the trail names them and as they are named on the file, and when. */
  approvedBy?: string;
  approvedName?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  changedBy?: string;
  changedAt?: string;
}

/** Sources one draft holds: the record's first, then the words of the paper it answers. */
export const OUTGOING_RECORD_SOURCES = 16;
export const OUTGOING_PASSAGES = 24;
/** How long a statement, a subject and a body may be. */
export const OUTGOING_STATEMENT = 400;
export const OUTGOING_SUBJECT = 160;
export const OUTGOING_BODY = 12_000;
/** Drafts one project keeps. */
export const OUTGOING_AT_MOST = 200;

export function outgoingOf(project: Pick<DdProject, 'outgoing'>): OutgoingDraft[] {
  return project.outgoing ?? [];
}

/* ==================================================================== */
/* Who may                                                               */
/* ==================================================================== */

/** Who sees drafts: the workspace's own people. Somebody working from a grant on one project sees none. */
export function maySeeOutgoing(role: WorkspaceRole): boolean {
  return reachesEveryProject(role);
}

/** Who makes and changes a draft: the workspace's own people who may change a record. */
export function mayDraftOutgoing(role: WorkspaceRole): boolean {
  return reachesEveryProject(role) && can(role, 'write');
}

/**
 * Who approves a draft for sending: somebody who leads or signs for a
 * department this project uses. By the firm's roles that is its owners and
 * managers, and on one project whoever its team list names lead or signer.
 * Somebody who only contributes drafts and does not approve.
 */
export function mayApproveOutgoing(project: DdProject, person: { email: string; role: WorkspaceRole }): boolean {
  if (!mayDraftOutgoing(person.role)) return false;
  return projectDepartments(project).some((department) => roleCanDecide(departmentRole(project, { email: person.email, workspaceRole: person.role }, department)));
}

/* ==================================================================== */
/* The sources: what the record holds for a draft                        */
/* ==================================================================== */

type Raw = Omit<OutgoingSource, 'n'>;

/** A decision somebody has made. One still proposed, pending or deferred is nobody's decision yet. */
const DECIDED: Record<string, string> = { approved: 'Decided', implemented: 'Decided and carried out', conditional: 'Decided, with conditions', rejected: 'Decided against' };

function decisionSource(decision: DecisionRecord): Raw | undefined {
  const made = DECIDED[decision.status];
  if (!made) return undefined;
  const when = decision.decidedAt ?? decision.createdAt;
  return { kind: 'decision', id: decision.id, title: 'Decision', says: `${made}: ${decision.title}${when ? ` (${meetingDay(when)})` : ''}${decision.status === 'conditional' && decision.conditions ? `. Conditions: ${decision.conditions}` : ''}` };
}

function actionSource(action: ActionRecord): Raw {
  const stands = action.status === 'closed' ? 'Done' : action.status === 'overdue' ? 'Overdue' : 'Open';
  return { kind: 'action', id: action.id, title: 'Action', says: `${action.title}${/[.?!]$/.test(action.title) ? '' : '.'} On ${action.owner || 'nobody named'}${action.dueDate ? `, due ${meetingDay(action.dueDate)}` : ''}. ${stands}.` };
}

/** What a paper states that may be acted on, each value with its page and its words. Read through the one rule for that (`standingFacts`). */
function paperValues(row: EvidenceRecord, atMost: number, keys?: readonly string[]): Raw[] {
  return standingFacts(row)
    .filter((fact) => !keys || keys.includes(fact.key))
    .slice(0, atMost)
    .map((fact) => ({ kind: 'paper' as const, id: row.id, title: row.title, page: fact.page, says: `${fact.label}: ${fact.display}`, quote: fact.quote }));
}

/** Whether some words name a record by its title: they hold two of the title's telling words, or its only one. */
function names(words: ReadonlySet<string>, title: string): boolean {
  const own = memTellingWords(title);
  const shared = own.filter((word) => words.has(word)).length;
  return shared > 0 && shared >= Math.min(2, own.length);
}

/** Who a meeting's notes say was there, as a source gives it and as the minutes say it. */
const presentSaid = (meeting: Pick<MeetingRecord, 'attendees'>): string => `Present: ${meeting.attendees.join(', ')}`;

/** Who an action of a meeting is on and by when, as the meeting keeps them. */
const onAndBy = (item: MeetingItem): string => `On: ${item.owner ?? 'nobody named'}. By: ${item.dueDate ? meetingDay(item.dueDate) : 'no date given'}.`;

function itemSource(project: DdProject, meeting: MeetingRecord, item: MeetingItem): Raw | undefined {
  const { standing } = meetingItemStands(project, item);
  if (standing === 'set_aside') return undefined;
  const what = item.kind === 'decision' ? 'Decided' : item.kind === 'action' ? 'To be done' : 'Left open';
  // An action gives who it is on and by when as the meeting keeps them: the notes may say "by Friday", and the minutes say the day.
  const says = `${what}: ${item.text}${item.kind === 'action' ? `${/[.?!]$/.test(item.text) ? '' : '.'} ${onAndBy(item)}` : ''}`;
  return { kind: 'meeting', id: meeting.id, itemId: item.id, title: meeting.title, says, quote: item.quote, ...(standing === 'waiting' ? { waiting: true as const } : {}) };
}

/**
 * What the record holds for a draft, in the order it is listed: what the
 * draft is about first, then what its words name. A paper gives the values
 * that stand on it, a meeting its items, an action itself. Words name a
 * paper by its title or its kind, a kind of value by its label, and a
 * decision or an action by its title. Numbered from one.
 */
export function outgoingSources(project: DdProject, about: OutgoingAbout | undefined, words: string): OutgoingSource[] {
  const raw: Raw[] = [];
  const papers = reviewPapers(project);
  const said = new Set(memTellingWords(words));

  if (about?.kind === 'paper') {
    const row = papers.find((paper) => paper.id === about.id);
    if (row) raw.push(...paperValues(row, 10));
    for (const decision of project.decisions) if (decision.evidenceIds.includes(about.id)) raw.push(...[decisionSource(decision)].flatMap((source) => source ?? []));
    for (const action of project.actions) if (action.evidenceIds.includes(about.id)) raw.push(actionSource(action));
  }
  if (about?.kind === 'meeting') {
    const meeting = meetingsHeld(project).find((held) => held.id === about.id);
    // Who was there is the meeting's own, with no item of the notes to it.
    if (meeting?.attendees.length) raw.push({ kind: 'meeting', id: meeting.id, title: meeting.title, says: presentSaid(meeting) });
    for (const item of meeting?.items ?? []) raw.push(...[itemSource(project, meeting!, item)].flatMap((source) => source ?? []));
  }
  if (about?.kind === 'action') {
    const action = project.actions.find((held) => held.id === about.id);
    if (action) {
      raw.push(actionSource(action));
      for (const row of papers) if (action.evidenceIds.includes(row.id)) raw.push(...paperValues(row, 4));
      for (const decision of project.decisions) if (decision.actionIds.includes(action.id)) raw.push(...[decisionSource(decision)].flatMap((source) => source ?? []));
    }
  }

  if (said.size) {
    for (const seed of memSeeds(project, { question: words })) {
      for (const id of seed.aboutIds) {
        const row = papers.find((paper) => paper.id === id);
        if (row) raw.push(...paperValues(row, 6));
        const action = project.actions.find((held) => held.id === id);
        if (action) raw.push(actionSource(action));
      }
      if (seed.keys.length) for (const row of papers) raw.push(...paperValues(row, 4, seed.keys));
    }
    for (const decision of project.decisions) if (names(said, decision.title)) raw.push(...[decisionSource(decision)].flatMap((source) => source ?? []));
    for (const action of project.actions) if (names(said, action.title)) raw.push(actionSource(action));
  }

  const seen = new Set<string>();
  const kept = raw.filter((source) => {
    const what = `${source.kind}|${source.id}|${source.itemId ?? ''}|${source.page ?? ''}|${source.says}`;
    if (seen.has(what)) return false;
    seen.add(what);
    return true;
  });
  // A meeting's minutes hold every item of its notes, however many. Anything else holds a handful.
  const atMost = about?.kind === 'meeting' ? 60 : OUTGOING_RECORD_SOURCES;
  return kept.slice(0, atMost).map((source, at) => ({ ...source, n: at + 1 }));
}

/**
 * A paper's own words as passages a statement can rest on: its lines run
 * together until they make a sentence or two, each with its page. The words
 * are the page's, never rewritten.
 */
export function paperPassages(pages: ReadonlyArray<{ page: number; text: string }>, atMost = OUTGOING_PASSAGES): Array<{ page: number; text: string }> {
  const out: Array<{ page: number; text: string }> = [];
  for (const { page, text } of [...pages].sort((a, b) => a.page - b.page)) {
    let held = '';
    const keep = () => {
      const passage = held.replace(/\s+/g, ' ').trim();
      if (passage.length >= 12 && out.length < atMost) out.push({ page, text: passage.slice(0, 320) });
      held = '';
    };
    for (const line of text.split(/\n+/)) {
      const words = line.trim();
      if (!words) continue;
      held = held ? `${held} ${words}` : words;
      if (held.length >= 220 || (held.length >= 60 && /[.?!:;]$/.test(words))) keep();
    }
    keep();
  }
  return out;
}

/** Puts the words of the paper a draft answers among its sources, after the record's own. For a draft whose body is not written yet. */
export function addPaperPassages(draft: OutgoingDraft, row: Pick<EvidenceRecord, 'id' | 'title'>, pages: ReadonlyArray<{ page: number; text: string; scanned?: boolean }>): void {
  const scanned = new Set(pages.filter((page) => page.scanned).map((page) => page.page));
  const kept = draft.sources.filter((source) => !source.passage);
  const passages = paperPassages(pages).map(
    (passage, at): OutgoingSource => ({ n: kept.length + at + 1, kind: 'paper', id: row.id, title: row.title, page: passage.page, says: passage.text, quote: passage.text, passage: true, ...(scanned.has(passage.page) ? { scanned: true as const } : {}) }),
  );
  draft.sources = [...kept, ...passages];
}

/** Whether what a source gives still stands on the record: its paper still states it, its decision is still made, its item is not set aside. */
export function outgoingSourceStands(project: DdProject, source: OutgoingSource): boolean {
  if (source.kind === 'paper') {
    const row = reviewPapers(project).find((paper) => paper.id === source.id);
    if (!row) return false;
    return source.passage ? true : standingFacts(row).some((fact) => `${fact.label}: ${fact.display}` === source.says);
  }
  if (source.kind === 'decision') return project.decisions.some((decision) => decision.id === source.id && DECIDED[decision.status] !== undefined);
  if (source.kind === 'action') return project.actions.some((action) => action.id === source.id);
  const meeting = meetingsHeld(project).find((held) => held.id === source.id);
  if (!meeting) return false;
  if (!source.itemId) return presentSaid(meeting) === source.says;
  const item = meeting.items.find((held) => held.id === source.itemId);
  return Boolean(item) && meetingItemStands(project, item!).standing !== 'set_aside';
}

/* ==================================================================== */
/* A statement held to its sources                                       */
/* ==================================================================== */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMED = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;

/** A statement without its marks and without the number that only lists it. */
function bare(text: string): string {
  return text
    .replace(/\[\d+\]/g, ' ')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every figure some words write, as its digits: 3,18,50,000 is 31850000, 09 is 9, and 73/4 is 73 and 4. */
function figuresOf(text: string): string[] {
  return (normalizeDigits(text.normalize('NFKC')).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((run) => run.replace(/,/g, '').replace(/^0+(?=\d)/, ''));
}

function monthsOf(text: string): number[] {
  return [...text.matchAll(MONTH_NAMED)].map((found) => MONTHS.indexOf(found[1]!.slice(0, 3).toLowerCase()) + 1);
}

const wordsOfSource = (source: OutgoingSource): string => `${source.title} ${source.says} ${source.quote ?? ''}`;

/**
 * Whether a statement holds to the sources it is marked with: every figure
 * it writes is a figure one of them writes, and every month it names is one
 * of theirs, by name or by number. A date a digit out is another date.
 */
function heldTo(text: string, sources: readonly OutgoingSource[]): boolean {
  const theirs = new Set(sources.flatMap((source) => [...figuresOf(wordsOfSource(source)), ...(source.page ? [String(source.page)] : [])]));
  const months = new Set(sources.flatMap((source) => monthsOf(wordsOfSource(source))));
  return figuresOf(bare(text)).every((figure) => theirs.has(figure)) && monthsOf(text).every((month) => months.has(month) || theirs.has(String(month)));
}

/** Whether a statement has to do with a source at all: they share a word that tells one thing from another, or a figure. */
function bearsOn(text: string, source: OutgoingSource): boolean {
  const theirs = new Set([...memTellingWords(wordsOfSource(source)), ...figuresOf(wordsOfSource(source))]);
  return [...memTellingWords(bare(text)), ...figuresOf(bare(text))].some((word) => theirs.has(word));
}

/** One line of a draft's body, read. */
export interface OutgoingStatement {
  /** Its line in the body, from nought. */
  line: number;
  paragraph: number;
  /** The words, without their marks. */
  text: string;
  /** The sources it is marked with, as the draft numbers them. */
  marks: number[];
  /** A short line that names what follows. Not a statement. */
  heading: boolean;
  /** Nothing on the record is behind it. */
  own: boolean;
  /** It is marked with sources that do not give one of its figures. */
  unheld: boolean;
}

/**
 * A draft's body read line by line: what each statement says, what it is
 * marked with, and whether it holds. A mark that names no source on the list
 * is no mark.
 */
export function outgoingStatements(body: string, sources: readonly OutgoingSource[]): OutgoingStatement[] {
  const out: OutgoingStatement[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let paragraph = 0;
  let first = true;
  lines.forEach((raw, line) => {
    if (!raw.trim()) {
      if (!first) paragraph += 1;
      first = true;
      return;
    }
    const marks = [...new Set([...raw.matchAll(/\[(\d+)\]/g)].map((found) => Number(found[1])).filter((n) => sources.some((source) => source.n === n)))];
    const text = raw
      .replace(/\[\d+\]/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const next = lines[line + 1]?.trim();
    const heading = first && Boolean(next) && !marks.length && text.length <= 48 && !/[.?!:;,]$/.test(text);
    const cited = sources.filter((source) => marks.includes(source.n));
    out.push({ line, paragraph, text, marks, heading, own: !heading && !marks.length, unheld: marks.length > 0 && !heldTo(text, cited) });
    first = false;
  });
  return out;
}

/**
 * A model's body, held to the sources.
 *
 * `said` is what a model answered: paragraphs of sentences, each with the
 * numbers of the sources it says it rests on. Nothing in it is taken on its
 * word. A mark is kept only for a source that is on the list and does not
 * wait, that the sentence has to do with, and only while every figure and
 * month the sentence writes is one its sources write. A sentence that loses
 * its marks is kept as the drafter's own, which the page shows for a person
 * to check. Anything a model wrote in the text that reads as a mark is taken
 * out first. Returns the body, one statement a line.
 */
export function outgoingBodyHeld(said: unknown, sources: readonly OutgoingSource[]): string {
  const usable = sources.filter((source) => !source.waiting);
  const paragraphs: string[] = [];
  let room = 40;
  for (const paragraph of Array.isArray(said) ? said.slice(0, 12) : []) {
    const sentences = (paragraph as { sentences?: unknown } | null)?.sentences;
    const lines: string[] = [];
    for (const sentence of Array.isArray(sentences) ? sentences : []) {
      const { text, sources: named } = (sentence ?? {}) as { text?: unknown; sources?: unknown };
      if (typeof text !== 'string' || room <= 0) continue;
      const words = text.replace(/\[[^\]\n]{0,16}\]/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/\s+/g, ' ').trim().slice(0, OUTGOING_STATEMENT);
      if (!words) continue;
      const cited = usable.filter((source) => Array.isArray(named) && named.includes(source.n) && bearsOn(words, source));
      const marks = cited.length && heldTo(words, cited) ? cited.map((source) => `[${source.n}]`).join('') : '';
      lines.push(marks ? `${words} ${marks}` : words);
      room -= 1;
    }
    if (lines.length) paragraphs.push(lines.join('\n'));
  }
  return paragraphs.join('\n\n');
}

/* ==================================================================== */
/* Minutes, put together by code                                         */
/* ==================================================================== */

/**
 * The minutes of a meeting the project keeps: who was there, what was
 * decided, what is to be done by whom and by when, and what was left open,
 * each line marked with what the meeting keeps for it, and each item with
 * the words of the notes it came from. An item nobody
 * has accepted on the record is said to be waiting. One a person set aside is
 * left out. No model words any of it, so none is added and none is dropped.
 */
function minutesBody(meeting: MeetingRecord, sources: readonly OutgoingSource[]): string {
  const of = (kind: MeetingItem['kind']) => meeting.items.flatMap((item) => (item.kind === kind ? sources.filter((source) => source.itemId === item.id).map((source) => ({ item, source })) : []));
  const waits = (source: OutgoingSource) => (source.waiting ? ' (waiting to be accepted on the record)' : '');
  const closed = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
  const parts: string[] = [];
  const present = sources.find((source) => source.kind === 'meeting' && !source.itemId);
  if (present) parts.push(`${presentSaid(meeting)}. [${present.n}]`);
  const decided = of('decision');
  if (decided.length) parts.push(['Decided', ...decided.map(({ item, source }, at) => `${at + 1}. ${closed(item.text)}${waits(source)} [${source.n}]`)].join('\n'));
  const todo = of('action');
  if (todo.length) {
    parts.push(
      ['To be done', ...todo.map(({ item, source }, at) => `${at + 1}. ${closed(item.text)} ${onAndBy(item)}${waits(source)} [${source.n}]`)].join('\n'),
    );
  }
  const open = of('open');
  if (open.length) parts.push(['Left open', ...open.map(({ item, source }, at) => `${at + 1}. ${closed(item.text)}${waits(source)} [${source.n}]`)].join('\n'));
  return parts.join('\n\n');
}

/* ==================================================================== */
/* Making a draft                                                        */
/* ==================================================================== */

export interface OutgoingInput {
  kind: OutgoingKind;
  about?: OutgoingAbout;
  to?: string;
  subject?: string;
  /** What it is to be about, in the person's words. */
  topic?: string;
  /** The whole instruction, as typed. */
  asked?: string;
}

const oneLine = (text: string | undefined, atMost: number): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, atMost);
/** A draft in a line of the trail: what it is and its subject, the kind said once. */
const saidInTrail = (draft: Pick<OutgoingDraft, 'kind' | 'subject'>): string => (draft.subject.startsWith(OUTGOING_KIND_LABEL[draft.kind]) ? draft.subject : `${OUTGOING_KIND_LABEL[draft.kind]}: ${draft.subject}`).slice(0, 200);
const capital = (text: string): string => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);

function token(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** What a draft is about, in a few words: the paper's name, the meeting, the action. */
export function outgoingAboutSaid(project: DdProject, about: OutgoingAbout | undefined): string | undefined {
  if (!about) return undefined;
  if (about.kind === 'paper') return project.evidence.find((row) => row.id === about.id)?.title;
  if (about.kind === 'action') return project.actions.find((action) => action.id === about.id)?.title;
  const meeting = (project.meetings ?? []).find((held) => held.id === about.id);
  return meeting ? capital(meetingCalled(meeting)) : undefined;
}

/** A subject from what a person asked for: "asking for the khata extract" is a request for it. */
function subjectFrom(kind: OutgoingKind, topic: string): string {
  const words = topic.replace(/[.!?]+$/, '').trim();
  const request = /^(?:asking|requesting)\s+(?:them\s+|him\s+|her\s+)?(?:for\s+)?/i.exec(words);
  const rest = (request ? words.slice(request[0].length) : words.replace(/^(?:about|regarding|on|re|for|that|saying)\s+/i, '')).trim();
  // With no words to go on, a request is named after the paper or the action it is about: the caller's to say.
  if (kind === 'rfi') return rest ? `Request for information: ${rest.replace(/^the\s+/i, '')}` : '';
  if (request && rest) return `Request for ${rest}`;
  return capital(rest);
}

/**
 * Makes a draft and keeps it on the project. The frame and the sources are
 * set here, from the record. Minutes are written here too. The body of
 * anything else is left empty, for a model or a person to write, and the
 * trail keeps a line (`outgoing_drafted`).
 */
export function startOutgoing(project: DdProject, input: OutgoingInput, actor: string, at = new Date().toISOString()): OutgoingDraft {
  const { kind, about } = input;
  const paper = about?.kind === 'paper' ? reviewPapers(project).find((row) => row.id === about.id) : undefined;
  const meeting = about?.kind === 'meeting' ? meetingsHeld(project).find((held) => held.id === about.id) : undefined;
  const action = about?.kind === 'action' ? project.actions.find((held) => held.id === about.id) : undefined;
  if (about && !paper && !meeting && !action) throw new Error('What it is about is no longer on the file.');
  if (kind === 'minutes' && !meeting) throw new Error('Minutes are of a meeting kept on this file.');
  if (kind === 'reply' && !paper) throw new Error('A reply answers a paper on the file.');
  if (kind !== 'minutes' && meeting) throw new Error('A meeting has minutes. Draft those.');
  if (outgoingOf(project).length >= OUTGOING_AT_MOST) throw new Error(`A project keeps at most ${OUTGOING_AT_MOST} drafts. Remove one first.`);

  const topic = oneLine(input.topic, OUTGOING_SUBJECT);
  const subject =
    oneLine(input.subject, OUTGOING_SUBJECT) ||
    (meeting
      ? `Minutes of ${meetingCalled(meeting)}`
      : kind === 'reply'
        ? `Reply: ${paper!.title}`
        : subjectFrom(kind, topic) || (kind === 'rfi' ? `Request for information${paper ? `: ${paper.title}` : action ? `: ${action.title}` : ''}` : (paper?.title ?? action?.title ?? '')));
  const sources = outgoingSources(project, about, [topic, input.subject ?? ''].join(' '));
  const numbers = outgoingOf(project).map((draft) => Number(/\/(\d+)$/.exec(draft.ref)?.[1] ?? 0));
  const draft: OutgoingDraft = {
    id: token('out'),
    kind,
    ref: `${project.reference}/OUT/${Math.max(0, ...numbers) + 1}`,
    dated: at.slice(0, 10),
    to: oneLine(input.to, 120) || (meeting ? meeting.attendees.join(', ') : ''),
    subject: subject.slice(0, OUTGOING_SUBJECT),
    ...(about ? { about } : {}),
    body: meeting ? minutesBody(meeting, sources) : '',
    sources,
    written: meeting ? 'code' : 'none',
    ...(input.asked ? { asked: oneLine(input.asked, 400) } : {}),
    status: 'draft',
    createdBy: actor,
    createdAt: at,
  };
  project.outgoing = [...outgoingOf(project), draft];
  recordAuditEvent(project, { at, actor, action: 'outgoing_drafted', entityType: 'outgoing', entityId: draft.id, newValue: saidInTrail(draft) });
  return draft;
}

/* ==================================================================== */
/* Changing, approving, taking away                                      */
/* ==================================================================== */

function draftOn(project: DdProject, draftId: string): OutgoingDraft {
  const draft = outgoingOf(project).find((held) => held.id === draftId);
  if (!draft) throw new Error('No draft by that id.');
  return draft;
}

/** Puts an approved draft back to draft, and says so in the trail (`outgoing_reopened`). */
function backToDraft(project: DdProject, draft: OutgoingDraft, actor: string, at: string, why: string): void {
  if (draft.status !== 'approved') return;
  const was = draft.approvedName ?? draft.approvedBy;
  draft.status = 'draft';
  delete draft.approvedBy;
  delete draft.approvedName;
  delete draft.approvedAt;
  recordAuditEvent(project, { at, actor, action: 'outgoing_reopened', entityType: 'outgoing', entityId: draft.id, oldValue: was ? `approved by ${was}` : 'approved', newValue: 'draft', reason: why });
}

/** The body as it is kept: its line ends made one kind, no line longer than a statement, and no more of it than a body is. */
function bodyKept(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim().slice(0, OUTGOING_STATEMENT * 2))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, OUTGOING_BODY);
}

/**
 * A person's change to a draft: to whom, the subject, the body. A change to
 * a draft that was approved puts it back to draft: what was approved is not
 * what it now says.
 */
export function editOutgoing(project: DdProject, draftId: string, change: { to?: string; subject?: string; body?: string }, actor: string, at = new Date().toISOString()): OutgoingDraft {
  const draft = draftOn(project, draftId);
  const to = change.to === undefined ? draft.to : oneLine(change.to, 120);
  const subject = change.subject === undefined ? draft.subject : oneLine(change.subject, OUTGOING_SUBJECT);
  const body = change.body === undefined ? draft.body : bodyKept(change.body);
  if (to === draft.to && subject === draft.subject && body === draft.body) return draft;
  backToDraft(project, draft, actor, at, 'changed after it was approved');
  // A body a person has changed is theirs: it is no longer what a model wrote, or the notes word for word.
  Object.assign(draft, { to, subject, body, changedBy: actor, changedAt: at, ...(body === draft.body ? {} : { written: 'person' as const }) });
  project.updatedAt = at;
  return draft;
}

/** Puts a body a model wrote on a draft that has none. Never over a person's words. */
export function setOutgoingBody(project: DdProject, draftId: string, body: string, at = new Date().toISOString()): OutgoingDraft {
  const draft = draftOn(project, draftId);
  if (draft.body.trim() || !body.trim()) return draft;
  draft.body = bodyKept(body);
  draft.written = 'model';
  project.updatedAt = at;
  return draft;
}

/**
 * A draft as a person is shown it, in one text: everything of its own that
 * its file says. Who it is to, its subject and its body, the sources behind
 * its statements, and whether it is approved, by whom and when. Two copies of
 * a draft give the same text only where they say the same.
 *
 * Whoever approves a draft, takes an approval back or makes its file sends
 * this for the copy on their screen, and it is set against the draft as it
 * stands (`shownStill`). So an approval is of the words a person read, never
 * of words that arrived after they opened it. It is the words themselves and
 * not a digest of them: no two drafts share one, so none can be made to.
 */
export function outgoingSeen(draft: OutgoingDraft): string {
  return JSON.stringify([
    draft.kind,
    draft.ref,
    draft.dated,
    draft.to,
    draft.subject,
    draft.about ? `${draft.about.kind}:${draft.about.id}` : '',
    draft.body,
    draft.status,
    draft.approvedBy ?? '',
    draft.approvedName ?? '',
    draft.approvedAt ?? '',
    draft.sources.map((source) => [source.n, source.kind, source.id, source.itemId ?? '', source.title, source.page ?? 0, source.says, source.quote ?? '', source.passage ? 1 : 0, source.waiting ? 1 : 0]),
  ]);
}

/** What somebody is told when the draft they act on is not the draft they were shown. */
export const OUTGOING_CHANGED = 'This draft was changed after you opened it.';

/** Refuses an act on a draft that no longer says what the person acting was shown. `before` names the act they are to read it again for. */
function shownStill(draft: OutgoingDraft, seen: string, before: string): void {
  if (seen !== outgoingSeen(draft)) throw new Error(`${OUTGOING_CHANGED} Read it again before you ${before}.`);
}

/** Why a draft cannot be approved as it stands, in words for a person. Empty when it can. */
export function outgoingNeeds(project: DdProject, draft: OutgoingDraft): string[] {
  const needs: string[] = [];
  if (!draft.to.trim()) needs.push('Say who it goes to.');
  if (!draft.subject.trim()) needs.push('Give it a subject.');
  const statements = outgoingStatements(draft.body, draft.sources).filter((statement) => !statement.heading);
  if (!statements.length) needs.push('It has no body yet.');
  const used = new Set(statements.flatMap((statement) => statement.marks));
  for (const source of draft.sources) {
    if (used.has(source.n) && !outgoingSourceStands(project, source)) needs.push(`Source ${source.n} no longer stands on the record. Change the statement or take its mark off.`);
  }
  for (const statement of statements) {
    if (statement.unheld) needs.push(`“${statement.text.slice(0, 60)}${statement.text.length > 60 ? '…' : ''}” writes a figure its source does not. Correct it or take its mark off.`);
  }
  return needs;
}

/**
 * Approves a draft for sending, by name, and keeps the time. Whether this
 * person may is the caller's to ask first (`mayApproveOutgoing`). `seen` is
 * the draft as the approver was shown it (`outgoingSeen`): a draft that has
 * changed since is not approved, and they are told to read it again. The
 * trail keeps a line (`outgoing_approved`). The day on the draft becomes
 * this day.
 */
export function approveOutgoing(project: DdProject, draftId: string, approver: { actor: string; name?: string; seen: string }, at = new Date().toISOString()): OutgoingDraft {
  const draft = draftOn(project, draftId);
  shownStill(draft, approver.seen, 'approve');
  if (draft.status === 'approved') return draft;
  const needs = outgoingNeeds(project, draft);
  if (needs.length) throw new Error(needs[0]);
  draft.status = 'approved';
  draft.approvedBy = approver.actor;
  if (approver.name?.trim()) draft.approvedName = approver.name.trim();
  draft.approvedAt = at;
  draft.dated = at.slice(0, 10);
  recordAuditEvent(project, { at, actor: approver.actor, action: 'outgoing_approved', entityType: 'outgoing', entityId: draft.id, oldValue: 'draft', newValue: 'approved' });
  return draft;
}

/** Takes an approval back: the draft is a draft again. Only the approval the person was shown (`seen`): one given since, to other words, is not theirs to take back unread. */
export function reopenOutgoing(project: DdProject, draftId: string, by: { actor: string; seen: string }, at = new Date().toISOString()): OutgoingDraft {
  const draft = draftOn(project, draftId);
  shownStill(draft, by.seen, 'take the approval back');
  backToDraft(project, draft, by.actor, at, 'approval taken back');
  return draft;
}

/**
 * A Word file of the draft is about to be handed over. `seen` is the draft
 * the file was made from. Where the draft no longer says that, no file is to
 * leave: one that says it is approved is made from the approved words and
 * from no others. The trail says whether what left was a draft or approved
 * (`outgoing_exported`).
 */
export function noteOutgoingExported(project: DdProject, draftId: string, by: { actor: string; seen: string }, at = new Date().toISOString()): OutgoingDraft {
  const draft = draftOn(project, draftId);
  shownStill(draft, by.seen, 'export it');
  recordAuditEvent(project, { at, actor: by.actor, action: 'outgoing_exported', entityType: 'outgoing', entityId: draft.id, newValue: draft.status === 'approved' ? 'approved' : 'draft, not approved' });
  return draft;
}

/** Takes a draft off the project (`outgoing_removed`). */
export function removeOutgoing(project: DdProject, draftId: string, actor: string, at = new Date().toISOString()): void {
  const draft = draftOn(project, draftId);
  project.outgoing = outgoingOf(project).filter((held) => held.id !== draftId);
  recordAuditEvent(project, { at, actor, action: 'outgoing_removed', entityType: 'outgoing', entityId: draftId, oldValue: saidInTrail(draft) });
}

/* ==================================================================== */
/* The file that goes out                                                */
/* ==================================================================== */

/** What a draft says until somebody approves it, on every page of its file. */
export const OUTGOING_NOT_APPROVED = 'DRAFT, NOT APPROVED';

/** A draft as the Word file lays it out. */
export interface OutgoingDocument {
  fileName: string;
  /** Said on every page while the draft is not approved. */
  banner?: string;
  title: string;
  /** The frame: project, reference, date, to whom, subject, what it answers. */
  head: Array<{ label: string; value: string }>;
  /** The body: a heading, a paragraph of running text, or a numbered item that stands alone. Marks are renumbered as the sources are listed. */
  body: Array<{ kind: 'heading' | 'text' | 'item'; text: string }>;
  /** Who approved it and when, once somebody has. */
  approval?: string;
  /** The sources the body is marked with, in the order it first uses them: each with the paper's name and page. */
  sources: string[];
}

/** One source as the foot of the file lists it. */
export function outgoingSourceLine(source: OutgoingSource): string {
  const from = `${source.title}${source.page ? `, page ${source.page}` : ''}`;
  if (source.passage) return `${from}: “${source.says}”`;
  return `${from}: ${source.says}${source.quote && source.kind === 'paper' ? ` (“${source.quote}”)` : ''}`;
}

/**
 * The file a draft becomes. Until it is approved it says so on every page.
 * After, it carries who approved it and when. Only the sources the body is
 * marked with are listed, numbered in the order they are first used, and the
 * marks in the body are renumbered to match.
 */
export function outgoingDocument(project: DdProject, draft: OutgoingDraft): OutgoingDocument {
  const statements = outgoingStatements(draft.body, draft.sources);
  const order = [...new Set(statements.flatMap((statement) => statement.marks))];
  const marked = (statement: OutgoingStatement) => `${statement.text}${statement.marks.length ? ` ${statement.marks.map((n) => `[${order.indexOf(n) + 1}]`).join('')}` : ''}`;
  const body: OutgoingDocument['body'] = [];
  let paragraph = -1;
  for (const statement of statements) {
    const item = /^\d+[.)]\s/.test(statement.text);
    const last = body[body.length - 1];
    if (statement.heading) body.push({ kind: 'heading', text: statement.text });
    else if (item) body.push({ kind: 'item', text: marked(statement) });
    else if (last?.kind === 'text' && statement.paragraph === paragraph) last.text = `${last.text} ${marked(statement)}`;
    else body.push({ kind: 'text', text: marked(statement) });
    paragraph = statement.paragraph;
  }
  const approved = draft.status === 'approved';
  const about = outgoingAboutSaid(project, draft.about);
  return {
    fileName: `${draft.ref} ${OUTGOING_KIND_LABEL[draft.kind]}${approved ? '' : ' (draft)'}.docx`.replace(/[\\/:*?"<>|]+/g, '-'),
    ...(approved ? {} : { banner: OUTGOING_NOT_APPROVED }),
    title: OUTGOING_KIND_LABEL[draft.kind],
    head: [
      { label: 'Project', value: `${project.name} (${project.reference})` },
      { label: 'Reference', value: draft.ref },
      { label: 'Date', value: meetingDay(draft.dated) },
      { label: 'To', value: draft.to },
      { label: 'Subject', value: draft.subject },
      ...(about && draft.kind !== 'minutes' ? [{ label: draft.kind === 'reply' ? 'In reply to' : 'About', value: about }] : []),
    ],
    body,
    ...(approved ? { approval: `Approved for sending by ${draft.approvedName ?? draft.approvedBy ?? ''} on ${meetingDay(draft.approvedAt ?? draft.dated)}.` } : {}),
    sources: order.map((n) => outgoingSourceLine(draft.sources.find((source) => source.n === n)!)),
  };
}

/* ==================================================================== */
/* Asked for in the chat                                                 */
/* ==================================================================== */

/** The name the chat gives a reply that made a draft. */
export const OUTGOING_DRAFT = 'outgoing_draft';

const ASK = /^(?:please\s+|can you\s+|could you\s+)?(?:draft|write|prepare)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+)?(reply|response|letter|rfi|request for information|minutes)\b([\s\S]*)$/i;

/** Whether a sentence asks for a letter, a reply, a request for information or minutes to be drafted. */
export function asksForOutgoing(question: string): boolean {
  return ASK.test(question.trim()) && question.trim().length <= 400;
}

/** A sentence that asks for a draft, read: what to make, or what to say back when it cannot be told. */
export type OutgoingAskRead = { input: OutgoingInput } | { said: string; choices?: ChatChoice[] };

/** What a party is called by what it does. Any other word before "'s letter" is taken for a name, and kept as typed. */
const ROLES = new Set('contractor subcontractor architect engineer surveyor consultant authority vendor seller buyer purchaser owner bank lender advocate lawyer tenant landlord society association client developer supplier'.split(' '));

/** The paper some words name: the one whose name they hold, or the one that shares the most of their words and at least half. `near`: the papers they might mean, when it cannot be told. */
function paperNamed(project: DdProject, words: string): { row?: EvidenceRecord; near: EvidenceRecord[] } {
  const papers = reviewPapers(project);
  const folded = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const whole = papers.filter((row) => folded(row.title).length >= 4 && folded(words).includes(folded(row.title)));
  if (whole.length === 1) return { row: whole[0], near: [] };
  const said = new Set(memTellingWords(words));
  const scored = papers
    .map((row) => ({ row, shared: memTellingWords(`${row.title} ${row.documentType ?? ''}`).filter((word) => said.has(word)).length }))
    .filter((score) => score.shared > 0)
    .sort((a, b) => b.shared - a.shared);
  const best = scored[0];
  if (best && best.shared * 2 >= said.size && scored.filter((score) => score.shared === best.shared).length === 1) return { row: best.row, near: [] };
  return { near: scored.slice(0, 4).map((score) => score.row) };
}

/** The meeting some words name: by its day, then by its name, and the one kept last when they name none. */
function meetingNamed(project: DdProject, words: string): MeetingRecord | undefined {
  const held = meetingsHeld(project);
  const byDay = held.find((meeting) => meeting.heldOn && meetingDayIn(words, `${meeting.heldOn.slice(0, 4)}-01-01`) === meeting.heldOn);
  if (byDay) return byDay;
  const said = new Set(memTellingWords(words.replace(/\b(?:meeting|minutes|notes|last|latest)\b/gi, ' ')));
  if (said.size) return held.find((meeting) => names(said, meeting.title));
  return meetingKeptLast(project);
}

export function readOutgoingAsk(project: DdProject, question: string): OutgoingAskRead {
  const found = ASK.exec(question.trim());
  if (!found) return { said: 'Say what to draft: a letter, a reply, a request for information, or the minutes of a meeting.' };
  const word = found[1]!.toLowerCase();
  const kind: OutgoingKind = word === 'minutes' ? 'minutes' : word === 'letter' ? 'letter' : word === 'reply' || word === 'response' ? 'reply' : 'rfi';
  const rest = found[2]!.replace(/[.!?\s]+$/, '').trim();

  if (kind === 'minutes') {
    if (!meetingsHeld(project).length) return { said: 'No meeting is kept on this file yet. Paste a meeting’s notes here and I will keep them. Then ask for its minutes.' };
    const meeting = meetingNamed(project, rest);
    if (meeting) return { input: { kind, about: { kind: 'meeting', id: meeting.id } } };
    return {
      said: 'Which meeting? No meeting on this file matches that.',
      choices: meetingsHeld(project)
        .slice(0, 4)
        .map((held) => ({ id: `out_${held.id}`, label: capital(meetingCalled(held)), send: `Draft the minutes of ${meetingCalled(held)}` })),
    };
  }

  if (kind === 'reply') {
    const words = rest.replace(/^(?:to|for|on|about|regarding)\s+/i, '');
    const { row, near } = paperNamed(project, words);
    if (!row) {
      const offered = near.length ? near : reviewPapers(project).slice(0, 4);
      if (!offered.length) return { said: 'A reply answers a paper on the file, and no paper is on this file yet. File the letter first.' };
      return {
        said: near.length ? 'Which paper is the reply to?' : 'A reply answers a paper on the file, and none on this file matches that. Which paper is it to?',
        choices: offered.map((paper) => ({ id: `out_${paper.id}`, label: paper.title, ...(paper.documentType ? { detail: paper.documentType } : {}), send: `Draft a reply to “${paper.title}”` })),
      };
    }
    // Whose letter it is, where the words say: "the contractor's letter" is the contractor's.
    const sender = /(?:^|[\s“"(])(?:the\s+)?([A-Za-z][A-Za-z .&-]{1,40}?)(?:'s|’s)\s+(?:letter|claim|notice|email|mail|query|request|rfi|demand)\b/i.exec(words)?.[1]?.trim();
    const to = sender ? (ROLES.has(sender.toLowerCase()) ? `The ${sender.toLowerCase()}` : sender) : undefined;
    return { input: { kind, about: { kind: 'paper', id: row.id }, ...(to ? { to } : {}), topic: words } };
  }

  // A letter or a request for information: to whom, where the words say, and what about.
  const named = /^to\s+(.+?)(?=\s+(?:asking|requesting|about|regarding|on|for|that|saying)\b|[,;:]|$)/i.exec(rest);
  const topic = (named ? rest.slice(named[0].length) : rest).replace(/^[,;:\s]+/, '');
  if (!named && !topic) return { said: `Say who ${kind === 'rfi' ? 'the request' : 'the letter'} is to and what it is about, as in “draft a letter to the authority asking for the khata extract”.` };
  return { input: { kind, ...(named ? { to: capital(named[1]!.trim()) } : {}), topic } };
}

/** How a draft stands, in a line or two: what it is, how much of it rests on the record, and that nothing has gone out. */
export function outgoingSaid(project: DdProject, draft: OutgoingDraft, how: { model?: boolean; failed?: boolean } = {}): string {
  const about = outgoingAboutSaid(project, draft.about);
  const what = draft.kind === 'minutes' ? `the minutes of ${about ? about.charAt(0).toLowerCase() + about.slice(1) : 'the meeting'}` : `${KIND_SAID[draft.kind]}${draft.kind === 'reply' && about ? ` to “${about}”` : draft.to ? ` to ${draft.to.charAt(0).toLowerCase()}${draft.to.slice(1)}` : ''}`;
  const statements = outgoingStatements(draft.body, draft.sources).filter((statement) => !statement.heading);
  const own = statements.filter((statement) => statement.own).length;
  const lines = [`Drafted ${what} as ${draft.ref}. It is open in Outgoing.`];
  if (statements.length) {
    const waiting = draft.sources.filter((source) => source.waiting).length;
    lines.push(
      `${plural(statements.length - own, 'statement rests', 'statements rest')} on the record${own ? `, and ${own === 1 ? '1 is' : `${own} are`} the drafter’s own to check` : ''}.${waiting ? ` ${waiting === 1 ? '1 item is' : `${waiting} items are`} still waiting to be accepted, and the minutes say so.` : ''}`,
    );
  } else {
    const laid = draft.sources.length ? `${plural(draft.sources.length, 'source is', 'sources are')} laid out to write from.` : 'Nothing on the record was found for it.';
    lines.push(how.failed ? `The model did not answer, so nothing was written. ${laid}` : how.model === false ? `No model is set up, so nothing was written. ${laid}` : laid);
  }
  if (!draft.to.trim()) lines.push('It does not say who it goes to yet.');
  lines.push('It is a draft: nothing goes out until a lead or a signer approves it.');
  return lines.join(' ');
}

/**
 * What the chat does with a sentence that asks for a draft: makes it and
 * opens it, or asks which paper or meeting is meant. `navigate` is the
 * chat's own way of opening a page and naming what was done.
 */
export function outgoingAsked(
  project: DdProject,
  question: string,
  actor: string,
  navigate: (pane: 'outgoing', label: string, extra?: { item?: string }) => void,
): { assistantText: string; toolCalls: Array<{ name: string; summary: string }>; choices: ChatChoice[] | undefined; citedNodeIds: string[] | undefined } {
  const read = readOutgoingAsk(project, question);
  if ('said' in read) return { assistantText: read.said, toolCalls: [{ name: 'clarify', summary: 'Which paper or meeting' }], choices: read.choices, citedNodeIds: undefined };
  try {
    const draft = startOutgoing(project, { ...read.input, asked: question }, actor);
    navigate('outgoing', `Drafted ${KIND_SAID[draft.kind]}`, { item: draft.id });
    return { assistantText: outgoingSaid(project, draft), toolCalls: [{ name: OUTGOING_DRAFT, summary: `${OUTGOING_KIND_LABEL[draft.kind]} drafted` }], choices: undefined, citedNodeIds: undefined };
  } catch (err) {
    return { assistantText: err instanceof Error ? err.message : 'That could not be drafted.', toolCalls: [{ name: 'clarify', summary: 'Not drafted' }], choices: undefined, citedNodeIds: undefined };
  }
}

/** The file a paper's pages are read from, for whoever adds its words to a draft's sources. */
export function outgoingPaperFile(project: DdProject, draft: OutgoingDraft): { row: EvidenceRecord; storageKey: string } | undefined {
  if (draft.about?.kind !== 'paper') return undefined;
  const row = reviewPapers(project).find((paper) => paper.id === draft.about!.id);
  const file = row ? reviewFileOf(row) : undefined;
  return row && file ? { row, storageKey: file.storageKey } : undefined;
}
