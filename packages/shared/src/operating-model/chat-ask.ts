/**
 * The chat asking for what is missing, one question at a time.
 *
 * Where the chat cannot answer because a field nobody has filled holds the
 * answer, where a month's owner pack has milestones with no reading for that
 * month, or where a person on a function's page asks what is missing there,
 * the chat offers to ask, and then asks: one field or one reading a reply,
 * named as the sheet names it and where it is, with taps built from the
 * field's type, and always Skip and Stop asking.
 *
 * An answer is the person's own words, and it waits as everything the chat
 * produces waits: a value on its field, offered with the message it was said
 * in (`chat-tag.ts`), until somebody who decides there accepts it. A
 * milestone's reading waits as a change to the milestone on Progress. The
 * next reply says in one line what was suggested and asks the next question.
 *
 * The run is kept on each reply that is part of it (`ProjectChatTurn.asking`),
 * so a reload or another device carries on where it stood. A question is
 * open only while it is the last thing the chat said to that person: any
 * other reply ends the run, and asked to ask again, the chat says so and
 * carries on where it stood. Nothing here needs a model: the rules ask, read
 * the answer and write it.
 */

import { isPastDay, projectAsAt } from './as-at';
import { chatInHand } from './chat-tag';
import { functionLabel } from './chat-suggestions';
import { fieldOptions, formatFieldValue, validateFieldValue } from './check-fields';
import { proposeFieldValues, readFunctionFields } from './field-sheets';
import { optionSetById, type FieldCatalog } from './field-registry';
import { fieldCatalogFor } from './firm-fields';
import { progressReadings } from './milestone-schedule';
import { periodOfKey } from './period-keys';
import type { Milestone } from './progress';
import { indiaToday } from './quarters';
import { daySaid, dayTyped } from './said';
import { plural } from './text';
import type { ChatChoice } from '../types';
import type { ChatProposal, CheckFieldDef, CheckFieldValue, DdProject, FieldAddress, FieldOrigin, ProjectChatTurn } from './types';

/** The tool a reply of a run is said to have been made by. */
export const CHAT_ASK = 'ask_missing';

/** The function whose page holds the milestones and their readings. */
const PROGRESS_FN = 'construction.progress';

/** An answer's source: the words of the message being answered, which the server reads off that message and never off what was sent. */
const SAID = { kind: 'said' } as unknown as FieldOrigin;

/** The most questions one run asks. More than this and the rest are for another run, once these are answered. */
export const ASK_AT_MOST = 10;

/** The most taps a choice field offers. The rest of its list is typed. */
const TAPS_AT_MOST = 6;

/** One question of a run: a field of a sheet, or a milestone's reading for a day. */
export type AskTarget =
  | {
      kind: 'field';
      address: FieldAddress;
      /** The field's label, as the sheet has it. */
      label: string;
      /** Where it is: "Legal › Title — Land holding". */
      where: string;
      /** The period of a sheet kept by period that the question is of, as a person reads it. */
      period?: string;
    }
  | {
      kind: 'reading';
      milestoneId: string;
      /** The day the reading is of: the last day of the month asked about. */
      on: string;
      /** The milestone's name. */
      label: string;
      where: string;
    };

/** A run of questions, as it stood once a reply was made. */
export interface ChatAsking {
  run: string;
  targets: AskTarget[];
  /** The question open now, by its place among `targets`. */
  at: number;
  suggested: number;
  skipped: number;
  /** Set once the run is over: every question was asked, or the person stopped it. */
  ended?: 'done' | 'stopped';
}

/** What a pressed choice of a run carries. See `ChoicePin.ask`. */
export interface AskPin {
  act: 'start' | 'answer' | 'skip' | 'stop';
  /** On an answer, a skip or a stop: the run, and the question by its place. */
  run?: string;
  at?: number;
  /** On an answer: the value the tap gives. */
  value?: string | number | boolean | string[];
  /** On a start: the fields to ask for, the function whose missing fields to walk, or the month whose missing readings to ask for. */
  fields?: FieldAddress[];
  fn?: string;
  month?: string;
}

/** What a step of a run says, offers and leaves. */
export interface AskStep {
  text: string;
  choices: ChatChoice[];
  asking: ChatAsking;
  summary: string;
}

/* ==================================================================== */
/* What is asked                                                         */
/* ==================================================================== */

/** The kinds a person can answer in a word, a tap or a figure. A table, a link, a paper and prose are filled on the sheet. */
const ASKED_KINDS = new Set<CheckFieldDef['kind']>(['text', 'number', 'money', 'area', 'percent', 'duration', 'date', 'boolean', 'enum', 'multi_enum']);

const sameAddress = (a: FieldAddress, b: FieldAddress): boolean => a.set === b.set && a.field === b.field && (a.record ?? '') === (b.record ?? '');

/**
 * Whether a paper named to supply a field is one the project has at least
 * asked for. A field a paper will give, where nobody has asked for that
 * paper yet, is not put to a person: the paper is what to get.
 */
function paperInHand(project: DdProject, types: readonly string[]): boolean {
  return project.evidence.some((row) => row.documentType !== undefined && types.includes(row.documentType) && row.status !== 'expected' && row.status !== 'missing');
}

/**
 * The fields of one function a person could be asked for, most needed
 * first: the must-fields due at the step the project is at and empty, that
 * a person can say in a word or a figure. Those a person can know come
 * before those a paper on hand states. Never a field worked out or mirrored
 * (nothing missing is), one that has to cite a paper, one a paper nobody has
 * asked for yet will give, or one another party owes. For an outside
 * collaborator, only the sheets their grant holds. `only` keeps to the fields
 * named, in the order the sheet has them.
 */
export function askableFields(
  project: DdProject,
  fn: string,
  opts: { outside?: boolean; at?: Date; catalog?: FieldCatalog; only?: readonly FieldAddress[] } = {},
): Array<Extract<AskTarget, { kind: 'field' }>> {
  const catalog = opts.catalog ?? fieldCatalogFor(project);
  if (!catalog.sheets.has(fn)) return [];
  const read = readFunctionFields(project, fn, opts.at ?? new Date(), catalog);
  const ranked: Array<{ target: Extract<AskTarget, { kind: 'field' }>; rank: number }> = [];
  for (const line of read.needs.missing) {
    const address = line.address;
    if (line.kind !== 'missing' || !address) continue;
    if (opts.only && !opts.only.some((named) => sameAddress(named, address))) continue;
    const set = catalog.sets.get(address.set);
    const def = set?.fields.find((field) => field.key === address.field);
    if (!set || !def || !ASKED_KINDS.has(def.kind) || def.proof === 'required') continue;
    // A collaborator's copy holds the sheets in their reach, and none of the checks' own: those are the firm's.
    if (opts.outside && (catalog.checks.has(set.id) || !project.fieldSheets?.[set.id])) continue;
    const byPaper = Boolean(def.fromTypes?.length);
    if (byPaper && !paperInHand(project, def.fromTypes!)) continue;
    const periods = read.sheets.find((sheet) => sheet.set.id === set.id)?.periods;
    const period = set.periodic ? (periods?.shown ?? periods?.current)?.label : undefined;
    ranked.push({
      target: { kind: 'field', address, label: def.label, where: `${functionLabel(fn)} — ${line.sheet}`, ...(period ? { period } : {}) },
      rank: byPaper ? 1 : 0,
    });
  }
  // A sort that keeps the sheet's own order among equals.
  return ranked.sort((a, b) => a.rank - b.rank).map((one) => one.target).slice(0, ASK_AT_MOST);
}

/** Of the fields a reply named to look at, those a person could be asked for, by their functions in the order named. */
export function askableOf(project: DdProject, fields: readonly FieldAddress[], opts: { outside?: boolean; at?: Date; catalog?: FieldCatalog } = {}): AskTarget[] {
  const catalog = opts.catalog ?? fieldCatalogFor(project);
  const fns = [...new Set(fields.map((address) => catalog.sets.get(address.set)?.fn ?? address.fn))];
  return fns.flatMap((fn) => askableFields(project, fn, { ...opts, catalog, only: fields })).slice(0, ASK_AT_MOST);
}

/**
 * The milestones of the record as it stood when a day ended that nothing
 * says how far along they were then. Those with readings, none of that day
 * or earlier (`unread`); and those nothing was ever reported of, still at
 * nought and not done, that were due to be done by that day or of a board
 * nothing had yet been reported on: a nought nobody typed is no reading. A
 * milestone planned to start after the day is not among them.
 */
function readingsMissingOn(project: DdProject, day: string): Milestone[] {
  const then = projectAsAt(project, day).milestones ?? [];
  const reported = (milestone: Milestone) => progressReadings(project, milestone).length > 0 || milestone.percent > 0;
  const boardReported = (project.milestones ?? []).some((milestone) => progressReadings(project, milestone).some((reading) => reading.on <= day));
  return then.filter((milestone) => {
    if (milestone.unread) return true;
    const held = (project.milestones ?? []).find((own) => own.id === milestone.id);
    if (!held || reported(held) || held.completedOn || (held.plannedStart && held.plannedStart.slice(0, 10) > day)) return false;
    return !boardReported || Boolean(held.plannedFinish && held.plannedFinish.slice(0, 10) <= day);
  });
}

/**
 * The milestones a month's owner pack has no reading for: read as the record
 * stood when the month's last day ended, those nothing says how far along
 * they were then (`readingsMissingOn`). Only for a month that has ended; a
 * month still running has its readings still to come.
 */
export function unreadReadings(project: DdProject, month: string, now: Date = new Date()): Array<Extract<AskTarget, { kind: 'reading' }>> {
  const span = periodOfKey(month);
  if (!span || !/^\d{4}-\d{2}$/.test(span.key) || !isPastDay(span.to, now)) return [];
  const where = functionLabel(PROGRESS_FN);
  // A reading already said and waiting to be accepted is not asked for again.
  const waiting = new Set((project.chatProposals ?? []).filter((card) => card.status === 'proposed' && card.kind === 'patch_record' && card.payload?.register === 'milestone' && card.payload.on === span.to).map((card) => String(card.payload.recordId)));
  return readingsMissingOn(project, span.to)
    .filter((milestone) => !waiting.has(milestone.id))
    .slice(0, ASK_AT_MOST)
    .map((milestone) => ({ kind: 'reading' as const, milestoneId: milestone.id, on: span.to, label: milestone.name, where }));
}

/* ==================================================================== */
/* The run a chat is on                                                  */
/* ==================================================================== */

/** The last state of a run among a chat's turns, open or over. */
export function chatAskingIn(turns: readonly Pick<ProjectChatTurn, 'role' | 'asking'>[]): ChatAsking | undefined {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const turn = turns[at]!;
    if (turn.role === 'assistant' && turn.asking) return turn.asking;
  }
  return undefined;
}

const stillOpen = (asking: ChatAsking | undefined): asking is ChatAsking => Boolean(asking && !asking.ended && asking.at < asking.targets.length);

/**
 * The run a chat is on, while it has a question open: the question the last
 * reply asked. Any other reply after it ends the run where it stood, so a
 * message said after something else was talked about is never taken for an
 * answer to a question asked before. The turns are one person's sitting:
 * nobody answers somebody else's question.
 */
export function chatAskingOpen(turns: readonly Pick<ProjectChatTurn, 'role' | 'asking'>[]): ChatAsking | undefined {
  const last = turns.filter((turn) => turn.role === 'assistant').at(-1);
  return stillOpen(last?.asking) ? last.asking : undefined;
}

/** A run that a reply about something else ended, with a question still open in it when it ended. Asked to ask again, the chat says so and carries on from it. */
export function chatAskingLeft(turns: readonly Pick<ProjectChatTurn, 'role' | 'asking'>[]): ChatAsking | undefined {
  const asking = chatAskingIn(turns);
  return stillOpen(asking) && !chatAskingOpen(turns) ? asking : undefined;
}

/** "Asking: 3 of 7", as the top of the chat says it while a run is on. */
export function askingSaid(asking: Pick<ChatAsking, 'at' | 'targets'>): string {
  return `Asking: ${asking.at + 1} of ${asking.targets.length}`;
}

/* ==================================================================== */
/* The words                                                              */
/* ==================================================================== */

/** "On a function's page: what's missing here", "fill in the blanks", "ask me". */
const ASK_ME = /^(?:(?:please|ok|okay|yes)[,\s]+)?(?:(?:what(?:'s|’s|\s+is)\s+(?:still\s+)?(?:missing|blank|empty)\s+(?:here|on\s+this\s+page))|(?:fill\s+(?:in\s+)?(?:the\s+blanks|the\s+gaps|these\s+in|them\s+in|what(?:'s|’s|\s+is)\s+missing))|(?:ask\s+me(?:\s+for\s+(?:them|these|the\s+readings|what(?:'s|’s|\s+is)\s+missing|the\s+missing\s+(?:fields|values|ones)))?))(?:\s+please)?[\s.!?]*$/i;

/** Whether a sentence asks the chat to ask for what is missing. */
export function asksToBeAsked(question: string): boolean {
  return ASK_ME.test(question.trim());
}

const SKIP = /^(?:skip(?:\s+(?:it|this(?:\s+one)?))?|next|pass|i\s+don'?t\s+know|don'?t\s+know|not\s+sure|no\s+idea)[\s.!]*$/i;
const STOP = /^(?:stop(?:\s+asking)?|that'?s\s+(?:enough|all)|enough|cancel|no\s+more(?:\s+questions)?)[\s.!]*$/i;

/** What a typed message does to the question open, where it is a skip or a stop. */
export function askCommandTyped(question: string): 'skip' | 'stop' | undefined {
  const q = question.trim();
  if (SKIP.test(q)) return 'skip';
  if (STOP.test(q)) return 'stop';
  return undefined;
}

/** A sentence that asks or tells the chat something, which an answer of a word is not. */
const TALKS = /\?\s*$|^(?:what|where|why|how|who|when|which|whose|is|are|was|were|do|does|did|can|could|would|should|will|shall|open|show|go|take|add|close|mark|set|grade|approve|accept|undo|help|tell|list|start|run|write|draft|read|file|please)\b/i;

/**
 * Words that answer nothing: a thanks, a yes or a no with nothing named, a
 * greeting, a laugh, a pause. A message of these alone is talk, whatever
 * field is asked for.
 */
const SAYS_NOTHING = new Set(['thanks', 'thank', 'you', 'thx', 'ty', 'ok', 'okay', 'k', 'kk', 'cool', 'great', 'nice', 'fine', 'good', 'sure', 'yes', 'yeah', 'yep', 'no', 'nope', 'hi', 'hello', 'hey', 'morning', 'evening', 'afternoon', 'got', 'it', 'noted', 'done', 'alright', 'right', 'hmm', 'hm', 'lol', 'haha', 'wait', 'later', 'sorry', 'oh', 'ah', 'so', 'and', 'the', 'very', 'much', 'all', 'perfect', 'awesome', 'wow', 'bye', 'there', 'everyone', 'team', 'guys', 'again', 'please']);

/** The most words a typed answer to a one-line field may be. A longer message is somebody saying something, not giving a value. */
const TEXT_ANSWER_WORDS_MOST = 12;

/**
 * Whether a typed message clearly gives a one-line field's value: it is not
 * a question, an instruction or a request; it names something past words
 * that answer nothing ("thanks", "ok", "cool", "hello"); and it is short, as
 * a value is. Anything else is a message like any other.
 */
function givesText(typed: string): boolean {
  const text = typed.trim();
  const words = text.toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length || words.length > TEXT_ANSWER_WORDS_MOST || TALKS.test(text) || asksToBeAsked(text) || askCommandTyped(text)) return false;
  return !words.every((word) => SAYS_NOTHING.has(word));
}

/** A field's definition by its address. */
function defOf(catalog: FieldCatalog, address: FieldAddress): CheckFieldDef | undefined {
  return catalog.sets.get(address.set)?.fields.find((field) => field.key === address.field);
}

/** A percent a person typed: "75", "75%", "75 per cent". */
function percentTyped(text: string): number | undefined {
  const hit = /^(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per\s+cent)?$/i.exec(text);
  const n = hit ? Number(hit[1]) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}

/**
 * A typed message read as the answer to the question open, or undefined
 * where it is not one: it does not read as a value of the field's kind, or
 * it asks or tells the chat something. For a field of words, where no tap is
 * offered, it has to give a value plainly (`givesText`). A message that is
 * no answer is a message like any other, and its reply ends the run.
 */
export function askAnswerTyped(project: DdProject, target: AskTarget, typed: string, catalog: FieldCatalog = fieldCatalogFor(project), now: Date = new Date()): { value: unknown } | undefined {
  const text = typed.trim().replace(/[.!]+$/, '').trim();
  if (!text || text.length > 200) return undefined;
  if (target.kind === 'reading') {
    const n = percentTyped(text);
    return n === undefined ? undefined : { value: n };
  }
  const def = defOf(catalog, target.address);
  if (!def) return undefined;
  const lists = (id: string) => optionSetById(id, catalog);
  const ok = (value: unknown) => !('error' in validateFieldValue(def, value, { proposer: 'parser', optionSet: lists, state: project.jurisdiction }));
  switch (def.kind) {
    case 'boolean': {
      const yes = /^(?:yes|y|true)$/i.test(text);
      return yes || /^(?:no|n|false)$/i.test(text) ? { value: yes } : undefined;
    }
    case 'percent': {
      const n = percentTyped(text);
      return n !== undefined && ok(n) ? { value: n } : undefined;
    }
    case 'date': {
      const day = /^today$/i.test(text) ? indiaToday(now) : dayTyped(text);
      return day ? { value: day } : undefined;
    }
    case 'enum':
    case 'multi_enum': {
      const options = fieldOptions(def, lists).filter((option) => !option.retired);
      const pick = (word: string) => options.find((option) => option.key.toLowerCase() === word.toLowerCase() || option.label.toLowerCase() === word.toLowerCase());
      if (def.kind === 'enum') {
        const hit = pick(text);
        return hit ? { value: hit.key } : undefined;
      }
      const words = text.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean);
      const hits = words.map(pick);
      return words.length && hits.every(Boolean) ? { value: [...new Set(hits.map((hit) => hit!.key))] } : undefined;
    }
    case 'number':
    case 'money':
    case 'area':
    case 'duration':
      // A figure starts as a figure does: digits, or the rupee before them.
      return /^(?:₹|rs\.?|inr)?\s*-?\d/i.test(text) && ok(text) ? { value: text } : undefined;
    default:
      return givesText(typed) && ok(text) ? { value: text } : undefined;
  }
}

/** What a field takes, said under the question where its answer is typed. */
function typingSaid(def: CheckFieldDef | undefined): string {
  switch (def?.kind) {
    case 'money':
      return 'Type the amount, as 45 lakh or 4.2 Cr.';
    case 'area':
      return 'Type it with its unit, as 2,450 sqft or 1 acre 20 guntas.';
    case 'number':
    case 'duration':
      return `Type the figure${def.unit ? ` in ${def.unit}` : ''}.`;
    case 'date':
      return 'Or type the day, as 31 Oct 2026.';
    case 'text':
      return 'Type it.';
    case 'enum':
      return 'Or type one of the list.';
    case 'multi_enum':
      return 'Or type them, with commas between.';
    default:
      return '';
  }
}

/** The question, as the reply asks it: "Legal › Title — Land holding: Tenure?" */
function questionSaid(target: AskTarget): string {
  if (target.kind === 'reading') return `${target.where} — ${target.label}: how far along at ${daySaid(target.on)}?`;
  return `${target.where}: ${target.label}${target.period ? ` for ${target.period}` : ''}?`;
}

/** The taps a question offers, by the field's type, then Skip and Stop asking. */
export function askChoices(project: DdProject, asking: ChatAsking, catalog: FieldCatalog = fieldCatalogFor(project), now: Date = new Date()): ChatChoice[] {
  const target = asking.targets[asking.at];
  if (!target) return [];
  const pin = (act: AskPin['act'], value?: AskPin['value']) => ({ ask: { act, run: asking.run, at: asking.at, ...(value !== undefined ? { value } : {}) } });
  const percents = [25, 50, 75, 100].map((n) => ({ label: `${n}%`, value: n as AskPin['value'] }));
  let taps: Array<{ label: string; value: NonNullable<AskPin['value']> }> = [];
  if (target.kind === 'reading') taps = percents as typeof taps;
  else {
    const def = defOf(catalog, target.address);
    const lists = (id: string) => optionSetById(id, catalog);
    if (def?.kind === 'enum' || def?.kind === 'multi_enum') {
      taps = fieldOptions(def, lists)
        .filter((option) => !option.retired)
        .slice(0, TAPS_AT_MOST)
        .map((option) => ({ label: option.label, value: def.kind === 'multi_enum' ? [option.key] : option.key }));
    } else if (def?.kind === 'boolean') taps = [{ label: 'Yes', value: true }, { label: 'No', value: false }];
    else if (def?.kind === 'percent') taps = percents as typeof taps;
    else if (def?.kind === 'date') taps = [{ label: 'Today', value: indiaToday(now) }];
  }
  const id = (n: number | string) => `ask-${asking.run}-${asking.at}-${n}`;
  return [
    ...taps.map((tap, n) => ({ id: id(n), label: tap.label, send: tap.label, sitting: pin('answer', tap.value) })),
    { id: id('skip'), label: 'Skip', send: 'Skip', sitting: pin('skip') },
    { id: id('stop'), label: 'Stop asking', send: 'Stop asking', sitting: pin('stop') },
  ];
}

/* ==================================================================== */
/* A step of a run                                                       */
/* ==================================================================== */

const runId = (): string => `ask_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Whether a question is still to ask: nothing has filled it, or offered a value for it, since the run began. */
function stillMissing(project: DdProject, target: AskTarget, catalog: FieldCatalog, now: Date): boolean {
  if (target.kind === 'reading') {
    const waiting = (project.chatProposals ?? []).some((card) => card.status === 'proposed' && card.kind === 'patch_record' && card.payload?.register === 'milestone' && card.payload.recordId === target.milestoneId && card.payload.on === target.on);
    return !waiting && readingsMissingOn(project, target.on).some((milestone) => milestone.id === target.milestoneId);
  }
  const fn = catalog.sets.get(target.address.set)?.fn ?? target.address.fn;
  return readFunctionFields(project, fn, now, catalog).needs.missing.some((line) => line.kind === 'missing' && line.address && sameAddress(line.address, target.address));
}

/** What a run says once it is over: how many were suggested, and where they wait. */
function overSaid(asking: ChatAsking): string {
  const where = asking.suggested ? ` ${asking.suggested === 1 ? 'It waits' : 'Each waits'} where it lands until it is accepted there.` : '';
  return `${asking.suggested ? `Suggested ${asking.suggested} of ${asking.targets.length}.` : 'Nothing was suggested.'}${where}`;
}

/** The run moved on to the next question still to ask, said after what came before. */
function nextStep(project: DdProject, asking: ChatAsking, lead: string[], catalog: FieldCatalog, now: Date): AskStep {
  let at = asking.at;
  while (at < asking.targets.length && !stillMissing(project, asking.targets[at]!, catalog, now)) at += 1;
  if (at >= asking.targets.length) {
    const done: ChatAsking = { ...asking, at: asking.targets.length, ended: 'done' };
    return { text: [...lead, `That was the last question. ${overSaid(done)}`].join('\n\n'), choices: [], asking: done, summary: 'Asked for what is missing' };
  }
  const next: ChatAsking = { ...asking, at };
  const target = next.targets[at]!;
  const typing = target.kind === 'field' ? typingSaid(defOf(catalog, target.address)) : 'Or type the percent.';
  return {
    text: [...lead, [questionSaid(target), typing].filter(Boolean).join('\n')].join('\n\n'),
    choices: askChoices(project, next, catalog, now),
    asking: next,
    summary: `Asking ${at + 1} of ${next.targets.length}`,
  };
}

/** The question open asked again, after a line that says why. */
export function askResumed(project: DdProject, asking: ChatAsking, lead: string, opts: { catalog?: FieldCatalog; now?: Date } = {}): AskStep {
  return nextStep(project, asking, [lead], opts.catalog ?? fieldCatalogFor(project), opts.now ?? new Date());
}

/**
 * A run begun over these questions, with the first one asked. Undefined where
 * none is still to ask. `resumed`: a reply about something else ended the
 * run before, and the first line says so; `left` where these are what that
 * run had still to ask, `other` where they are what the last reply offered.
 */
export function askStarted(project: DdProject, targets: readonly AskTarget[], opts: { lead?: string; resumed?: 'left' | 'other'; catalog?: FieldCatalog; now?: Date } = {}): AskStep | undefined {
  const catalog = opts.catalog ?? fieldCatalogFor(project);
  const now = opts.now ?? new Date();
  const kept = targets.filter((target) => stillMissing(project, target, catalog, now)).slice(0, ASK_AT_MOST);
  if (!kept.length) return undefined;
  const asking: ChatAsking = { run: runId(), targets: kept, at: 0, suggested: 0, skipped: 0 };
  const ended = opts.resumed ? `The questions before stopped when something else was said${opts.resumed === 'left' ? ', so I am carrying on where they stood' : ''}. ` : '';
  const lead = opts.lead ?? `${ended}${kept.length === 1 ? 'One thing is' : `${kept.length} things are`} missing. I will ask for ${kept.length === 1 ? 'it' : 'them one at a time'}; each answer waits as a suggestion until it is accepted.`;
  return nextStep(project, asking, [lead], catalog, now);
}

/** The question open, skipped: it is not asked again in this run. */
export function askSkipped(project: DdProject, asking: ChatAsking, opts: { catalog?: FieldCatalog; now?: Date } = {}): AskStep {
  const target = asking.targets[asking.at]!;
  return nextStep(project, { ...asking, at: asking.at + 1, skipped: asking.skipped + 1 }, [`Skipped ${target.label}.`], opts.catalog ?? fieldCatalogFor(project), opts.now ?? new Date());
}

/** The run stopped where it stood. */
export function askStopped(asking: ChatAsking): AskStep {
  const stopped: ChatAsking = { ...asking, ended: 'stopped' };
  return { text: `Stopped asking. ${overSaid(stopped)}`, choices: [], asking: stopped, summary: 'Stopped asking' };
}

/**
 * The question open, answered with a value: written as the person's own
 * words, waiting on the field or as a reading of the milestone, and the next
 * question asked after one line that says what was suggested. A value the
 * field will not take is said, with why, and the same question is asked
 * again.
 */
export function askAnswered(
  project: DdProject,
  asking: ChatAsking,
  value: unknown,
  opts: { actor: string; raise: (card: ChatProposal) => void; makeReading: (milestone: { id: string; title: string }, percent: number, on: string) => ChatProposal; catalog?: FieldCatalog; now?: Date },
): AskStep {
  const catalog = opts.catalog ?? fieldCatalogFor(project);
  const now = opts.now ?? new Date();
  const target = asking.targets[asking.at]!;
  const again = (why: string): AskStep => {
    const step = nextStep(project, asking, [why], catalog, now);
    return { ...step, summary: 'Asked again' };
  };
  if (target.kind === 'reading') {
    const percent = typeof value === 'number' ? value : percentTyped(String(value ?? ''));
    const milestone = project.milestones?.find((held) => held.id === target.milestoneId);
    if (percent === undefined || !milestone) return again('That is not a percent between 0 and 100.');
    opts.raise(opts.makeReading({ id: milestone.id, title: milestone.name }, Math.round(percent), target.on));
    return nextStep(project, { ...asking, at: asking.at + 1, suggested: asking.suggested + 1 }, [`Suggested ${Math.round(percent)}% on Progress — ${milestone.name}.`], catalog, now);
  }
  const def = defOf(catalog, target.address);
  const lists = (id: string) => optionSetById(id, catalog);
  const parsed = def ? validateFieldValue(def, value, { proposer: 'parser', optionSet: lists, state: project.jurisdiction }) : { error: 'That field is no longer on the sheet.' };
  if ('error' in parsed) return again(`${parsed.error} Nothing was suggested.`);
  const [outcome] = proposeFieldValues(project, [{ address: target.address, value, origin: SAID }], 'parser', catalog, { said: chatInHand() });
  if (!outcome || outcome.outcome === 'refused') return again(`${outcome?.error ?? 'That could not be suggested.'} Nothing was suggested.`);
  if (outcome.outcome === 'held') return nextStep(project, { ...asking, at: asking.at + 1 }, [`${target.label} already holds that.`], catalog, now);
  if (outcome.outcome === 'declined') return nextStep(project, { ...asking, at: asking.at + 1 }, [`That value for ${target.label} was set aside before, so it is not suggested again.`], catalog, now);
  const shown = formatFieldValue(def!, { value: parsed.value, at: '', by: '', ...(parsed.entered ? { entered: parsed.entered } : {}) } as CheckFieldValue, lists);
  return nextStep(project, { ...asking, at: asking.at + 1, suggested: asking.suggested + 1 }, [`Suggested ${shown} on ${target.label}.`], catalog, now);
}

/** The words a choice that starts a run says, and what it carries. */
export function askOffer(label: string, start: Omit<AskPin, 'act'>, detail?: string): ChatChoice {
  return { id: `ask-start-${Math.random().toString(36).slice(2, 8)}`, label, send: label, ...(detail ? { detail } : {}), sitting: { ask: { act: 'start', ...start } } };
}

/** "3 fields", "2 readings": what a run would ask for, under the choice that starts it. */
export function askOfferDetail(targets: readonly AskTarget[]): string {
  const readings = targets.filter((target) => target.kind === 'reading').length;
  const fields = targets.length - readings;
  return [fields ? plural(fields, 'field') : '', readings ? plural(readings, 'reading') : ''].filter(Boolean).join(' and ') + ', one question at a time';
}
