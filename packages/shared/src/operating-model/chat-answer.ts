/**
 * A chat answer as a card of fields.
 *
 * A model that answers in the chat writes no sentence. It picks: the fields
 * that answer the question, by address; records, by id; lines of the
 * project's memory, by mark; passages a search of the papers found, by
 * mark. Code looks each up on the record and makes the card: every row a
 * label, the value as the record holds it, where the value stands, and its
 * source. The words round the card are a template's, chosen by what the
 * card holds, and said in the language of the question where this file has
 * the template in it, else in English.
 *
 * Where nothing picked is on the record, the reply says so by template and
 * offers the field or the paper to look at. It never improvises.
 *
 * The card's text is also made here (`chatAnswerText`), since a turn is
 * stored, quoted and exported as text: the template's line, then one line a
 * row. A memory line's row ends with its mark in square brackets, so the
 * tag is printed from the fact as it always was (`memTagsPrinted`), and a
 * passage's with the cite that opens its paper at the page.
 *
 * What a model may leave for the project's memory is a mark, not a
 * sentence: what it is about, and one of three kinds (`MemMarkKind`).
 *
 * Pure.
 */

import { ACTION_STATUS_LABEL, CHECK_RESULT_LABEL, DECISION_STATUS_LABEL, EVIDENCE_STATUS_LABEL, FINDING_STATUS_LABEL, RISK_STATUS_LABEL, SEVERITY_LABEL } from './catalogs';
import type { FieldCatalog } from './field-registry';
import { fieldCatalogFor } from './firm-fields';
import { ruleSourceSaid } from './rule-tables';
import { isBlank } from './check-fields';
import { fieldRecords, readSheet, resolveFields, type FieldSource, type FieldView } from './field-sheets';
import type { MemContext } from './mem-context';
import { scriptOf } from '../script';
import type { DdProject, FieldAddress, FieldState } from './types';

/* ==================================================================== */
/* What a model picks                                                    */
/* ==================================================================== */

export const CHAT_OUTCOMES = ['answered', 'partly', 'not_on_record'] as const;
export type ChatOutcome = (typeof CHAT_OUTCOMES)[number];

/** The kinds of mark a model may leave for memory. */
export const MEM_MARK_KINDS = ['open_question', 'contradiction', 'follow_up'] as const;
export type MemMarkKind = (typeof MEM_MARK_KINDS)[number];
export const MEM_MARK_LABEL: Record<MemMarkKind, string> = { open_question: 'Open question', contradiction: 'Contradiction', follow_up: 'To follow up' };

/** A mark for memory: what it is about (a field, or a record by id) and its kind. Never a sentence. */
export interface MemMark {
  kind: MemMarkKind;
  about: { field: FieldAddress } | { record: string };
}

/** A passage a search of the papers found in this turn, under the mark a model picks it by. */
export interface ChatPassage {
  mark: string;
  evidenceId: string;
  title: string;
  page: number;
  /** The page's own words. */
  quote: string;
}

/** What a model answered with. Every member is a key: an address, an id or a mark. */
export interface ChatAnswerPicks {
  outcome: ChatOutcome;
  fields: FieldAddress[];
  records: string[];
  /** The marks of memory lines. */
  memory: string[];
  passages: string[];
  /** Where to look, when the record does not answer. */
  lookAtFields: FieldAddress[];
  lookAtPapers: string[];
  mark?: MemMark;
}

export const CHAT_PICKS_AT_MOST = 12;

const addressFrom = (value: unknown): FieldAddress | undefined => {
  const given = (value && typeof value === 'object' ? value : {}) as Partial<Record<'set' | 'field' | 'record' | 'fn', unknown>>;
  if (typeof given.set !== 'string' || typeof given.field !== 'string' || !given.set || !given.field) return undefined;
  return { fn: typeof given.fn === 'string' ? given.fn : '', set: given.set, field: given.field, ...(typeof given.record === 'string' && given.record ? { record: given.record } : {}) };
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().replace(/^\[|\]$/g, '')).filter(Boolean))].slice(0, CHAT_PICKS_AT_MOST) : []);

/**
 * What of a model's answer is read: keys and nothing else. A sentence sent
 * beside them, under any name, is not looked at.
 */
export function chatPicksFrom(said: unknown): ChatAnswerPicks {
  const given = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>;
  const addresses = (value: unknown): FieldAddress[] => (Array.isArray(value) ? value.flatMap((item) => addressFrom(item) ?? []).slice(0, CHAT_PICKS_AT_MOST) : []);
  const look = (given.look_at && typeof given.look_at === 'object' ? given.look_at : {}) as Record<string, unknown>;
  const marked = (given.mark && typeof given.mark === 'object' ? given.mark : {}) as Record<string, unknown>;
  const kind = MEM_MARK_KINDS.find((known) => known === marked.kind);
  const field = addressFrom(marked.field);
  const record = typeof marked.record === 'string' ? marked.record.trim() : '';
  return {
    outcome: CHAT_OUTCOMES.find((known) => known === given.outcome) ?? 'answered',
    fields: addresses(given.fields),
    records: strings(given.records),
    memory: strings(given['facts']),
    passages: strings(given.passages),
    lookAtFields: addresses(look.fields),
    lookAtPapers: strings(look.papers),
    ...(kind && (field || record) ? { mark: { kind, about: field ? { field } : { record } } } : {}),
  };
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

export type ChatStanding = FieldState | 'worked_out' | 'on_record' | 'paper_words' | 'memory_approved' | 'memory_proposed' | 'memory_note';

export const CHAT_STANDING_LABEL: Record<ChatStanding, string> = {
  empty: 'Not filled',
  proposed: 'Waiting on a person',
  accepted: 'Accepted',
  typed: 'Entered by a person',
  disputed: 'Disputed',
  not_applicable: 'Not applicable',
  assumed: 'Assumed',
  // Nobody accepted a figure that is worked out: it follows from what stands, and says which rule rows it read.
  worked_out: 'Worked out',
  on_record: 'On the record',
  paper_words: 'The paper’s own words',
  memory_approved: 'Accepted',
  memory_proposed: 'Waiting on a person',
  memory_note: 'A note',
};

/** Where a row's figures are held: the page's name as a person knows it, and its address in the app. */
export interface ChatOpen {
  label: string;
  path: string;
}

export interface ChatAnswerRow {
  /** A figure is one a screen works out from its own records (`chat-questions.ts`): the same function's, said the same. */
  kind: 'field' | 'record' | 'fact' | 'passage' | 'figure';
  label: string;
  /** As the record holds it. For a passage, the page's own words. */
  value: string;
  standing: ChatStanding;
  source?: { label: string; evidenceId?: string; page?: number; quote?: string };
  address?: FieldAddress;
  recordId?: string;
  /** For a memory line: the mark its tag is printed from. */
  mark?: string;
  /** For a figure worked out from the rule table: each row it read, as the instrument is cited, and whether a person has verified it. */
  rules?: Array<{ said: string; verified: boolean }>;
  /** For a figure worked out on a usual value nobody entered: the fields that value stands in for, by label. Said as "on an assumed value". */
  assumes?: string[];
  /** The page that holds what the row says. */
  open?: ChatOpen;
}

export interface ChatAnswerCard {
  v: 1;
  outcome: ChatOutcome;
  rows: ChatAnswerRow[];
  /** What to look at where the record does not answer: a field to fill, a paper to read. */
  look: Array<{ label: string; address?: FieldAddress; evidenceId?: string; open?: ChatOpen }>;
  /** The template's lines said round the card, in the language of the question: what leads it, and what stands over the list to look at. */
  said?: ChatAnswerSaid;
}

export interface ChatAnswerSaid {
  lead: string;
  /** Said after the rows where something was proposed as well. */
  proposed?: string;
  lookAt?: string;
}

function sourceRow(source: FieldSource | undefined): ChatAnswerRow['source'] {
  // Who typed a value is on the sheet for whoever opens it. It is no part of an answer, and an address is never printed in one.
  if (!source || !source.label || source.kind === 'person') return undefined;
  return { label: source.label, ...(source.evidenceId ? { evidenceId: source.evidenceId } : {}), ...(source.page ? { page: source.page } : {}), ...(source.quote ? { quote: source.quote } : {}) };
}

/** A field that holds nothing and that nothing waits on. */
const blank = (view: FieldView): boolean => view.state === 'empty' && !view.waiting.length;

function fieldRow(view: FieldView, where: string): ChatAnswerRow {
  // A value that waits beside none that stands is what the field holds for now, said as waiting.
  const waiting = view.state === 'empty' ? view.waiting[0] : undefined;
  return {
    kind: 'field',
    label: `${view.def.label} (${where})`,
    value: waiting ? waiting.text : view.text,
    // A worked-out figure or a standing is nobody's acceptance: it is said to be worked out, with the rule rows it read.
    standing: waiting ? 'proposed' : (view.def.kind === 'computed' || view.def.kind === 'status') && !isBlank(view.held) ? 'worked_out' : view.state,
    ...(view.cites?.length ? { rules: view.cites.map((cite) => ({ said: `${cite.label}: ${ruleSourceSaid(cite.source)}`, verified: cite.verified })) } : {}),
    ...(view.assumes?.length && !isBlank(view.held) ? { assumes: view.assumes } : {}),
    ...(sourceRow(waiting ? waiting.source : view.source) ? { source: sourceRow(waiting ? waiting.source : view.source) } : {}),
    address: view.address,
  };
}

/** A record of the project as a row: what kind of thing it is, its own title, and where it stands. */
function recordRow(project: DdProject, id: string): ChatAnswerRow | undefined {
  const row = (label: string, value: string, extra: Partial<ChatAnswerRow> = {}): ChatAnswerRow => ({ kind: 'record', label, value, standing: 'on_record', recordId: id, ...extra });
  const paper = project.evidence.find((held) => held.id === id);
  if (paper) return row('Paper', `${paper.title} · ${EVIDENCE_STATUS_LABEL[paper.status] ?? paper.status}`, { source: { label: paper.title, evidenceId: paper.id } });
  const finding = project.findings.find((held) => held.id === id);
  if (finding) return row('Finding', `${finding.title} · ${SEVERITY_LABEL[finding.severity]} · ${FINDING_STATUS_LABEL[finding.status] ?? finding.status}`);
  const risk = project.risks.find((held) => held.id === id);
  if (risk) return row('Risk', `${risk.title} · ${SEVERITY_LABEL[risk.materiality]} · ${RISK_STATUS_LABEL[risk.status] ?? risk.status}`);
  const action = project.actions.find((held) => held.id === id);
  if (action) return row('Action', `${action.title} · ${ACTION_STATUS_LABEL[action.status] ?? action.status}${action.dueDate ? ` · due ${action.dueDate.slice(0, 10)}` : ''}`);
  const decision = project.decisions.find((held) => held.id === id);
  if (decision) return row('Decision', `${decision.title} · ${DECISION_STATUS_LABEL[decision.status] ?? decision.status}`);
  const milestone = (project.milestones ?? []).find((held) => held.id === id);
  if (milestone) return row('Milestone', `${milestone.name} · ${milestone.percent}%${milestone.plannedFinish ? ` · planned finish ${milestone.plannedFinish}` : ''}`);
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      const check = scope.checks.find((held) => held.id === id);
      if (check) return row('Check', `${check.title} · ${check.result ? (CHECK_RESULT_LABEL[check.result] ?? check.result) : 'Not recorded'}`);
    }
  }
  return undefined;
}

/**
 * The card for what a model picked, every row looked up on the record as
 * the reader may see it (`project` is their copy). A pick that names
 * nothing there is left out and not guessed at. An answer that picked
 * nothing that exists is one the record does not hold.
 */
export function chatAnswerCard(project: DdProject, picks: ChatAnswerPicks, given: { remembered?: Pick<MemContext, 'lines'>; passages?: readonly ChatPassage[]; at?: Date } = {}, catalog: FieldCatalog = fieldCatalogFor(project)): ChatAnswerCard {
  const rows: ChatAnswerRow[] = [];
  const resolution = resolveFields(project, given.at ?? new Date(), catalog);
  const viewAt = (address: FieldAddress): { view: FieldView; where: string } | undefined => {
    const set = catalog.sets.get(address.set);
    if (!set) return undefined;
    const record = set.records ? (address.record && fieldRecords(project, set.id).some((held) => held.id === address.record) ? address.record : undefined) : undefined;
    if (set.records && !record) return undefined;
    const sheet = readSheet(project, set.id, record, resolution, catalog, given.at ?? new Date());
    const view = sheet?.fields.find((held) => held.def.key === address.field);
    return view && sheet ? { view, where: set.records ? `${set.title} · ${sheet.title}` : set.title } : undefined;
  };
  const seen = new Set<string>();
  const add = (key: string, row: ChatAnswerRow | undefined): void => {
    if (!row || seen.has(key) || rows.length >= CHAT_PICKS_AT_MOST) return;
    seen.add(key);
    rows.push(row);
  };
  for (const address of picks.fields) {
    const found = viewAt(address);
    // A field nobody has filled and nothing waits on answers nothing: it is something to look at.
    if (found && !blank(found.view)) add(`f:${address.set}:${address.record ?? ''}:${address.field}`, fieldRow(found.view, found.where));
  }
  for (const id of picks.records) add(`r:${id}`, recordRow(project, id));
  for (const mark of picks.memory) {
    const line = given.remembered?.lines.find((held) => held.mark === mark.toLowerCase());
    // A line is its tag, what it says, then what states it: the middle is the value, and the tag is printed from the fact.
    const parts = (line?.text.split(' · ') ?? []).filter((part, at) => !(at === 1 && part === 'stands'));
    const from = parts.find((part) => part.startsWith('source: '))?.slice('source: '.length);
    if (line) add(`m:${line.id}`, { kind: 'fact', label: 'Memory', value: parts[1] ?? line.text, ...(from ? { source: { label: from } } : {}), standing: line.tag === 'approved' ? 'memory_approved' : line.tag === 'proposed' ? 'memory_proposed' : 'memory_note', mark: line.mark });
  }
  for (const mark of picks.passages) {
    const hit = given.passages?.find((held) => held.mark === mark.toLowerCase());
    if (hit && project.evidence.some((held) => held.id === hit.evidenceId)) add(`p:${hit.evidenceId}:${hit.page}`, { kind: 'passage', label: hit.title, value: hit.quote, standing: 'paper_words', source: { label: hit.title, evidenceId: hit.evidenceId, page: hit.page } });
  }
  const look: ChatAnswerCard['look'] = [];
  for (const address of [...picks.lookAtFields, ...picks.fields]) {
    const found = viewAt(address);
    if (found && blank(found.view) && !look.some((held) => held.address && held.address.set === address.set && held.address.field === address.field)) look.push({ label: `${found.view.def.label} (${found.where})`, address: found.view.address });
  }
  for (const id of picks.lookAtPapers) {
    const paper = project.evidence.find((held) => held.id === id);
    if (paper && !look.some((held) => held.evidenceId === id)) look.push({ label: paper.title, evidenceId: paper.id });
  }
  const outcome: ChatOutcome = !rows.length ? 'not_on_record' : picks.outcome === 'not_on_record' ? 'partly' : picks.outcome === 'answered' && look.length ? 'partly' : picks.outcome;
  return { v: 1, outcome, rows, look: look.slice(0, 6) };
}

/* ==================================================================== */
/* The words round the card                                              */
/* ==================================================================== */

export type ChatTemplateKey = 'answered' | 'partly' | 'not_on_record' | 'look_at' | 'proposed' | 'asked' | 'opened';

type Language = 'en' | 'hi' | 'kn';

/** Every sentence the chat says round a card. Nothing else is said. */
export const CHAT_TEMPLATES: Record<Language, Record<ChatTemplateKey, string>> = {
  en: {
    answered: 'From the record:',
    partly: 'The record holds part of this:',
    not_on_record: 'Neither the record nor the papers answer this.',
    look_at: 'To look at:',
    proposed: 'Proposed, and waiting on the page for a person to accept.',
    asked: 'Which did you mean? Nothing has been changed.',
    opened: 'Opened on the page.',
  },
  hi: {
    answered: 'रिकॉर्ड से:',
    partly: 'रिकॉर्ड में इसका एक हिस्सा है:',
    not_on_record: 'इसका उत्तर न रिकॉर्ड में है, न काग़ज़ों में।',
    look_at: 'यह देखें:',
    proposed: 'प्रस्तावित है, और स्वीकार किए जाने तक पृष्ठ पर प्रतीक्षा में है।',
    asked: 'आपका मतलब किससे था? कुछ भी बदला नहीं गया है।',
    opened: 'पृष्ठ पर खोला गया।',
  },
  kn: {
    answered: 'ದಾಖಲೆಯಿಂದ:',
    partly: 'ದಾಖಲೆಯಲ್ಲಿ ಇದರ ಒಂದು ಭಾಗ ಇದೆ:',
    not_on_record: 'ಇದಕ್ಕೆ ಉತ್ತರ ದಾಖಲೆಯಲ್ಲೂ ಇಲ್ಲ, ಕಾಗದಗಳಲ್ಲೂ ಇಲ್ಲ.',
    look_at: 'ಇದನ್ನು ನೋಡಿ:',
    proposed: 'ಪ್ರಸ್ತಾಪಿಸಲಾಗಿದೆ, ಒಪ್ಪಿಗೆಗಾಗಿ ಪುಟದಲ್ಲಿ ಕಾಯುತ್ತಿದೆ.',
    asked: 'ನೀವು ಯಾವುದನ್ನು ಉದ್ದೇಶಿಸಿದ್ದೀರಿ? ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.',
    opened: 'ಪುಟದಲ್ಲಿ ತೆರೆಯಲಾಗಿದೆ.',
  },
};

/** The language a question is answered in: its own where the templates exist in it, else English. */
export function chatLanguageOf(question: string): Language {
  const script = scriptOf(question);
  return script === 'devanagari' ? 'hi' : script === 'kannada' ? 'kn' : 'en';
}

const sourceSaid = (row: ChatAnswerRow): string => (row.source ? `${row.source.label}${row.source.page ? `, page ${row.source.page}` : ''}` : (row.open?.label ?? ''));

/**
 * A card as text: the template's line for what the card holds, a line a
 * row, and what to look at. Only the template's lines are in the language of
 * the question: a label, a value, a name and a figure are the record's and
 * are written as the record writes them.
 */
export function chatAnswerText(card: ChatAnswerCard, given: { question?: string; proposals?: number; choices?: number; navigations?: number } = {}): string {
  const said = card.said ?? chatAnswerSaid(card, given);
  const lines: string[] = [said.lead];
  for (const row of card.rows) {
    if (row.kind === 'fact') lines.push(`- ${row.value} [${row.mark}]${row.source ? ` (${row.source.label})` : ''}`);
    else if (row.kind === 'passage') lines.push(`- ${row.label}, page ${row.source?.page}: “${row.value}” [ev:${row.source?.evidenceId}:p${row.source?.page}]`);
    else lines.push(`- ${row.label}: ${row.value} (${[CHAT_STANDING_LABEL[row.standing], sourceSaid(row), ...(row.rules ?? []).map((rule) => `${rule.said}${rule.verified ? '' : ', not verified'}`), row.assumes?.length ? `on an assumed value: nobody entered ${row.assumes.join(', ')}` : ''].filter(Boolean).join('; ')})`);
  }
  if (said.proposed) lines.push(said.proposed);
  if (said.lookAt) {
    lines.push(said.lookAt);
    for (const item of card.look) lines.push(`- ${item.label}`);
  }
  return lines.join('\n');
}

/** The template's lines for a card: chosen by what the card holds and what else the turn did, never written. */
export function chatAnswerSaid(card: Pick<ChatAnswerCard, 'outcome' | 'rows' | 'look'>, given: { question?: string; proposals?: number; choices?: number; navigations?: number } = {}): ChatAnswerSaid {
  const say = CHAT_TEMPLATES[chatLanguageOf(given.question ?? '')];
  const lead = card.rows.length ? say[card.outcome === 'not_on_record' ? 'answered' : card.outcome] : given.choices ? say.asked : given.proposals ? say.proposed : given.navigations && !card.look.length ? say.opened : say.not_on_record;
  return { lead, ...(card.rows.length && given.proposals ? { proposed: say.proposed } : {}), ...(card.look.length ? { lookAt: say.look_at } : {}) };
}

/* ==================================================================== */
/* The mark left for memory                                              */
/* ==================================================================== */

/**
 * A mark as memory keeps it: one line made from the mark's kind and the
 * name of what it is about, and the id it is filed under. Undefined where
 * what it is about is not on the record. The line is a template's and the
 * record's words; no model wrote it.
 */
export function memMarkSaid(project: DdProject, mark: MemMark | undefined, catalog: FieldCatalog = fieldCatalogFor(project)): { note: string; about?: string } | undefined {
  if (!mark) return undefined;
  if ('record' in mark.about) {
    const row = recordRow(project, mark.about.record);
    return row ? { note: `${MEM_MARK_LABEL[mark.kind]}: ${row.label.toLowerCase()} “${row.value.split(' · ')[0]}”.`, about: mark.about.record } : undefined;
  }
  const address = mark.about.field;
  const set = catalog.sets.get(address.set);
  const def = set?.fields.find((held) => held.key === address.field);
  if (!set || !def) return undefined;
  return { note: `${MEM_MARK_LABEL[mark.kind]}: the field ${def.label} (${set.title}).` };
}
