/**
 * The questionnaire: the facts a due diligence asks of a building.
 *
 * A technical due diligence asks for three things. Documents — the
 * requirement sheet. Facts — this: the column grid, the slab, the chillers,
 * the lifts, asked of the seller in the client's own list of questions.
 * Judgment — the checks and findings. This module is the middle one.
 *
 * A questionnaire is imported as it was written, never rewritten into the
 * library's words, because the client reads the answers against the
 * questions they sent. Each answer says where it came from, and the four
 * sources are not equal: what the seller said, what a document states on a
 * page, what was seen on site, and what the engineer concluded. A report is
 * judged on that difference, so it is recorded with every answer.
 *
 * A model's answer is marked as the model's until a person confirms it.
 */

import type { DepartmentKey } from './departments';
import type { DocumentFact } from './document-parse';
import { standingFacts } from './fact-review';
import type { DdProject, EvidenceRecord } from './types';

/** Where an answer came from, weakest claim first. */
export type AnswerSource = 'seller' | 'document' | 'site' | 'engineer';

export const ANSWER_SOURCES: readonly AnswerSource[] = ['seller', 'document', 'site', 'engineer'];

export const ANSWER_SOURCE_LABEL: Record<AnswerSource, string> = {
  seller: 'Seller said',
  document: 'From a document',
  site: 'Seen on site',
  engineer: 'Engineer’s view',
};

export type QuestionStatus = 'unanswered' | 'suggested' | 'answered';

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  unanswered: 'Unanswered',
  suggested: 'Suggested',
  answered: 'Answered',
};

/** What stands behind an answer: filed documents or photographs, and where in them. */
export interface AnswerProof {
  evidenceId: string;
  page?: number;
  quote?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  /** Its place in the list as sent, so the answers go back in the same order. */
  order: number;
  section?: string;
  text: string;
  answer?: string;
  source?: AnswerSource;
  proof: AnswerProof[];
  /** A model wrote this answer and nobody has confirmed it yet. */
  suggested?: boolean;
  note?: string;
  /** Kept on the sheet, left out of the report: not every question is the client's business to read. */
  omitFromReport?: boolean;
  answeredBy?: string;
  answeredAt?: string;
}

export interface Questionnaire {
  id: string;
  title: string;
  /** The department whose work it is. One imported before departments had their own is Engineering's. */
  department?: DepartmentKey;
  /** The file it was read from, when it was. */
  fileName?: string;
  /** Where that file is kept, when it was kept: the file a questionnaire came from can be opened again. */
  fileKey?: string;
  /** What of the file was not taken in, and why: said where the questionnaire is shown. */
  leftOut?: string;
  /** The facts at the head of the sheet: property, developer, city. */
  header: Array<{ label: string; value: string }>;
  questions: QuestionnaireQuestion[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/* ==================================================================== */
/* Reading a questionnaire as it was written                             */
/* ==================================================================== */

/** One paragraph of the source, and whether the source numbered it as a list item. */
export interface OutlineLine {
  text: string;
  /** The author's own mark for "this is a question": a numbered or bulleted item. */
  listed?: boolean;
  /** A heading in the source, which names the section that follows. */
  heading?: boolean;
}

export interface ParsedQuestionnaire {
  header: Array<{ label: string; value: string }>;
  questions: Array<{ section?: string; text: string; answer?: string }>;
}

/**
 * How much one questionnaire may hold. A sheet of sixty thousand rows was
 * taken in as sixty thousand questions, and every reply that carried the
 * project grew by megabytes; one line of three megabytes was one question.
 * A real questionnaire runs to a few hundred questions of a line or two.
 */
export const QUESTIONNAIRE_LIMITS = {
  /** Questions kept; the rest are left out and counted. */
  questions: 500,
  /** Characters of one question, as the page's own form allows. */
  questionChars: 600,
  /** Characters of an answer that came with the sheet. */
  answerChars: 4000,
  /** Facts kept from the head of the sheet. */
  headerFacts: 20,
  /** Characters of text read for questions, from a text file, a CSV or a PDF's pages. */
  textChars: 400_000,
} as const;

const cutAt = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * A questionnaire cut to what one may hold, and what was left out and why,
 * in a sentence for the person who sent it. Nothing is left out silently.
 */
export function withinQuestionnaireLimits(parsed: ParsedQuestionnaire): { parsed: ParsedQuestionnaire; leftOut?: string } {
  const max = QUESTIONNAIRE_LIMITS;
  const kept = parsed.questions.slice(0, max.questions);
  const long = kept.filter((q) => q.text.length > max.questionChars).length;
  const longAnswers = kept.filter((q) => (q.answer?.length ?? 0) > max.answerChars).length;
  const said = [
    parsed.questions.length > kept.length
      ? `Only the first ${max.questions.toLocaleString('en-IN')} of its ${parsed.questions.length.toLocaleString('en-IN')} questions were taken in: one questionnaire holds no more.`
      : '',
    long ? `${long === 1 ? 'One question was' : `${long} questions were`} longer than ${max.questionChars} characters and ${long === 1 ? 'was' : 'were'} cut there.` : '',
    longAnswers ? `${longAnswers === 1 ? 'One answer was' : `${longAnswers} answers were`} cut at ${max.answerChars.toLocaleString('en-IN')} characters.` : '',
  ].filter(Boolean);
  return {
    parsed: {
      header: parsed.header.slice(0, max.headerFacts).map((h) => ({ label: cutAt(h.label, 80), value: cutAt(h.value, 400) })),
      questions: kept.map((q) => ({
        ...(q.section ? { section: cutAt(q.section, 120) } : {}),
        text: cutAt(q.text, max.questionChars),
        ...(q.answer ? { answer: cutAt(q.answer, max.answerChars) } : {}),
      })),
    },
    ...(said.length ? { leftOut: said.join(' ') } : {}),
  };
}

const HEADER_LINE = /^([A-Za-z][A-Za-z /&.'()-]{1,40}):\s*(.*)$/;
const LEADING_MARK = /^\s*(?:[-–—•*]+|\(?\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

function clean(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
}

function stripMark(text: string): string {
  return clean(text.replace(LEADING_MARK, '').replace(/^[-–—]\s*/, ''));
}

function looksLikeQuestion(text: string): boolean {
  return /\?\s*$/.test(text) || /^(what|which|who|whom|when|where|why|how|is|are|does|do|did|has|have|whether|any|can|will)\b/i.test(text);
}

/**
 * Split a questionnaire into its header, its questions and the answers
 * already written beside them.
 *
 * Where the source marks its questions — a Word list, a numbered line — that
 * mark decides, because a question need not end in a question mark ("Name of
 * the SPV") and an answer may ("Yes?"). Where it marks nothing, a line that
 * reads as a question starts one and the lines after it are its answer.
 *
 * A "Label: value" line before the first question is a header fact. Repeats
 * are dropped: a sheet that prints the property's name twice has one name.
 */
export function parseQuestionnaire(lines: readonly OutlineLine[], opts: { marksDecide?: boolean } = {}): ParsedQuestionnaire {
  const rows = lines.map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text);
  // In a Word file the list is the author's own structure and decides alone.
  // In pasted text a number is a habit, not a structure: some lines have one
  // and some do not, so the wording still counts.
  const marked = opts.marksDecide !== false && rows.some((l) => l.listed);
  const header: ParsedQuestionnaire['header'] = [];
  const questions: ParsedQuestionnaire['questions'] = [];
  let section: string | undefined;
  let current: { section?: string; text: string; answer?: string } | undefined;

  for (const row of rows) {
    const isQuestion = marked ? Boolean(row.listed) : Boolean(row.listed) || looksLikeQuestion(stripMark(row.text));
    if (row.heading && !isQuestion) {
      section = row.text;
      current = undefined;
      continue;
    }
    if (isQuestion) {
      current = { section, text: stripMark(row.text) };
      questions.push(current);
      continue;
    }
    if (!current) {
      const m = HEADER_LINE.exec(row.text);
      if (m) {
        const label = clean(m[1]!);
        const value = clean(m[2] ?? '');
        if (!header.some((h) => h.label.toLowerCase() === label.toLowerCase())) header.push({ label, value });
      }
      continue;
    }
    const answer = stripMark(row.text);
    if (answer) current.answer = current.answer ? `${current.answer} ${answer}` : answer;
  }
  return { header, questions };
}

/** Plain text, one paragraph per line: nothing is marked, so the wording decides. */
export function parseQuestionnaireText(text: string): ParsedQuestionnaire {
  return parseQuestionnaire(
    text.split(/\r?\n/).map((line) => ({ text: line, listed: /^\s*(?:\(?\d{1,3}[.)]|[•*])\s+/.test(line) || undefined })),
    { marksDecide: false },
  );
}

/**
 * A spreadsheet export: a Question column, and Answer and Section columns
 * when they are there. The first row names the columns.
 */
export function parseQuestionnaireCsv(csv: string): ParsedQuestionnaire {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { header: [], questions: [] };
  const head = rows[0]!.map((c) => c.trim().toLowerCase());
  const q = head.findIndex((c) => /question|query|item|description/.test(c));
  const a = head.findIndex((c) => /answer|response|reply|remark/.test(c));
  const s = head.findIndex((c) => /section|discipline|category|head/.test(c));
  const hasHead = q >= 0;
  const body = hasHead ? rows.slice(1) : rows;
  const qi = hasHead ? q : 0;
  const ai = hasHead ? a : rows[0]!.length > 1 ? 1 : -1;
  const questions = body
    .map((r) => ({ section: s >= 0 ? clean(r[s] ?? '') || undefined : undefined, text: stripMark(r[qi] ?? ''), answer: ai >= 0 ? clean(r[ai] ?? '') || undefined : undefined }))
    .filter((row) => row.text);
  return { header: [], questions };
}

const QUESTION_HEAD = /question|query|queries|requisition|particulars|description/i;
/** A column name that says the rows under it are questions. "Description" heads a bill of quantities as often. */
const SAYS_QUESTIONS = /question|quer(?:y|ies)|requisition/i;
/** A row that names columns: two cells or more written, one of them a short name for the questions. */
const namesColumns = (row: readonly string[]): boolean => row.filter(Boolean).length >= 2 && row.some((c) => c.length <= 30 && QUESTION_HEAD.test(c));
const ANSWER_HEAD = /answer|response|reply|remark/i;
const SECTION_HEAD = /section|discipline|category|head|topic/i;

/**
 * A sheet of an Excel workbook, as rows of cells.
 *
 * A workbook is rarely as bare as a CSV. The questions start under a row that
 * names the columns, and that row is seldom the first: a title and the
 * property's name come above it. So the row that names a Question column is
 * looked for in the first rows, and a "Label, value" pair above it is a header
 * fact. Where no row names the columns, the column that holds the most
 * writing is the questions and the next one written in is the answers.
 *
 * `named` says whether the sheet named its question column itself, which is
 * what tells a questionnaire from any other table.
 */
export function parseQuestionnaireRows(sheet: readonly (readonly string[])[]): ParsedQuestionnaire & { named: boolean } {
  const rows = sheet.map((r) => r.map((c) => clean(String(c ?? '')))).filter((r) => r.some(Boolean));
  if (!rows.length) return { header: [], questions: [], named: false };
  const headAt = rows.slice(0, 12).findIndex(namesColumns);
  const header: ParsedQuestionnaire['header'] = [];
  let qi: number;
  let ai: number;
  let si = -1;
  let body = rows;
  if (headAt >= 0) {
    const head = rows[headAt]!;
    qi = head.findIndex((c) => c.length <= 30 && QUESTION_HEAD.test(c));
    ai = head.findIndex((c, n) => n !== qi && ANSWER_HEAD.test(c));
    si = head.findIndex((c, n) => n !== qi && n !== ai && SECTION_HEAD.test(c));
    for (const r of rows.slice(0, headAt)) {
      const cells = r.filter(Boolean);
      const inOne = cells.length === 1 ? HEADER_LINE.exec(cells[0]!) : null;
      const [label, value] = inOne ? [clean(inOne[1]!), clean(inOne[2] ?? '')] : cells.length === 2 ? [cells[0]!.replace(/:\s*$/, ''), cells[1]!] : ['', ''];
      if (label && value && !header.some((h) => h.label.toLowerCase() === label.toLowerCase())) header.push({ label, value });
    }
    body = rows.slice(headAt + 1);
  } else {
    const width = Math.max(...rows.map((r) => r.length));
    const written = Array.from({ length: width }, (_, n) => rows.reduce((sum, r) => sum + (r[n]?.length ?? 0), 0));
    qi = written.indexOf(Math.max(...written));
    ai = written.findIndex((chars, n) => n > qi && chars > 0);
  }
  let section: string | undefined;
  const questions: ParsedQuestionnaire['questions'] = [];
  for (const r of body) {
    const text = stripMark(r[qi] ?? '');
    const others = r.filter((c, n) => n !== qi && c).length;
    // A row with one cell written, and not in the question column, heads the rows under it.
    if (!text) {
      const only = r.filter(Boolean);
      if (only.length === 1 && si < 0) section = only[0];
      continue;
    }
    // A row with only its question written, in capitals or ending in a colon, is a heading too.
    if (!others && si < 0 && (/:$/.test(text) || (text === text.toUpperCase() && /[A-Z]/.test(text) && !/\?$/.test(text)))) {
      section = text.replace(/:$/, '');
      continue;
    }
    questions.push({ section: si >= 0 ? r[si] || undefined : section, text, answer: ai >= 0 ? r[ai] || undefined : undefined });
  }
  return { header, questions, named: headAt >= 0 && SAYS_QUESTIONS.test(rows[headAt]![qi] ?? '') };
}

const LISTED = /^\s*(?:\(?\d{1,3}[.)]|[•*])\s+/;

/**
 * A questionnaire printed to PDF, from the words of its pages.
 *
 * A page breaks a long question over two lines, and read line by line the
 * second half would be taken for its answer. A line that follows a numbered
 * question which has not ended, and does not start one itself, is the rest of
 * that question.
 */
export function parseQuestionnairePages(pages: readonly string[]): ParsedQuestionnaire {
  const lines: OutlineLine[] = [];
  for (const raw of pages.join('\n').split(/\r?\n/)) {
    const text = clean(raw);
    if (!text) continue;
    const listed = LISTED.test(raw);
    const last = lines[lines.length - 1];
    if (!listed && last?.listed && !/[?.:;]$/.test(last.text)) {
      last.text = `${last.text} ${text}`;
      continue;
    }
    lines.push({ text, listed: listed || undefined });
  }
  return parseQuestionnaire(lines, { marksDecide: false });
}

/** What a file dropped in the chat is: a list of questions to answer, a paper about the property, or not told. */
export type DroppedAs = 'questionnaire' | 'paper' | 'unsure';

/** Whether a file's own name says it is a questionnaire: "TDD questionnaire.xlsx", "Queries on title.docx", "RFI 12.pdf". */
export function namesQuestionnaire(fileName: string): boolean {
  return /question|quer(?:y|ies)|\brfi\b|requisition|check\s*list/i.test(fileName.replace(/[_-]+/g, ' '));
}

/**
 * Whether a dropped file is a questionnaire or a paper to file.
 *
 * A paper the reader recognises (a deed, a khata, an order) is a paper,
 * whatever it numbers. Otherwise the file is a questionnaire when what is in
 * it says so: a sheet with a Question column, or a list most of whose items
 * read as questions. Where only its name says so, or a fair number of lines
 * read as questions and that is all there is to go on, it is not decided
 * here: the person is asked.
 */
export function questionnaireOrPaper(input: {
  fileName: string;
  parsed: ParsedQuestionnaire | null;
  /** The rules took it for a kind of paper they know. */
  recognised?: boolean;
  /** A sheet that names its question column. */
  namedColumn?: boolean;
}): DroppedAs {
  if (input.recognised) return 'paper';
  const questions = input.parsed?.questions ?? [];
  if (!questions.length) return 'paper';
  const asked = questions.filter((q) => looksLikeQuestion(q.text)).length;
  if (input.namedColumn && questions.length >= 2) return 'questionnaire';
  if (questions.length >= 5 && asked >= questions.length * 0.6) return 'questionnaire';
  // Its name says so and its words do not: "Reply to queries - vendor.pdf" is a letter with four numbered replies. Asked, never assumed.
  if (namesQuestionnaire(input.fileName) && questions.length >= 2) return 'unsure';
  if (asked >= 3 && asked >= questions.length * 0.3) return 'unsure';
  return 'paper';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/* ==================================================================== */
/* On the project                                                        */
/* ==================================================================== */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The department a questionnaire belongs to. */
export function questionnaireDepartment(questionnaire: Pick<Questionnaire, 'department'>): DepartmentKey {
  return questionnaire.department ?? 'construction';
}

/** One department's questionnaires, in the order they were imported. */
export function questionnairesOf(project: DdProject, department: DepartmentKey): Questionnaire[] {
  return (project.questionnaires ?? []).filter((q) => questionnaireDepartment(q) === department);
}

function list(project: DdProject): Questionnaire[] {
  if (!project.questionnaires) project.questionnaires = [];
  return project.questionnaires;
}

function audit(project: DdProject, actor: string, action: string, entityId: string, newValue?: string): void {
  const at = nowIso();
  project.audit.push({ id: newId('aud'), at, actor, action, entityType: 'questionnaire', entityId, newValue });
  project.updatedAt = at;
}

export function findQuestionnaire(project: DdProject, questionnaireId: string): Questionnaire {
  const found = (project.questionnaires ?? []).find((q) => q.id === questionnaireId);
  if (!found) throw new Error('No questionnaire by that id.');
  return found;
}

function findQuestion(questionnaire: Questionnaire, questionId: string): QuestionnaireQuestion {
  const found = questionnaire.questions.find((q) => q.id === questionId);
  if (!found) throw new Error('No question by that id.');
  return found;
}

export interface AddQuestionnaireInput {
  title: string;
  department?: DepartmentKey;
  fileName?: string;
  /** Where the file is kept, when it is. */
  fileKey?: string;
  parsed: ParsedQuestionnaire;
  /** What the reader of the file already left out, to be said with what is left out here. */
  leftOut?: string;
}

/**
 * Put a questionnaire on the project. An answer already written in the
 * source is the seller's: it came with the sheet, nobody here has checked it.
 */
export function addQuestionnaire(project: DdProject, input: AddQuestionnaireInput, actor: string): Questionnaire {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new Error('Give the questionnaire a name.');
  if (!input.parsed.questions.length) throw new Error('No questions were found in that. Paste one question per line, or a sheet with a Question column.');
  // Whichever door it came by, it holds no more than one questionnaire may.
  const { parsed, leftOut } = withinQuestionnaireLimits(input.parsed);
  const notTaken = [input.leftOut, leftOut].filter(Boolean).join(' ');
  const at = nowIso();
  const questionnaire: Questionnaire = {
    id: newId('qnr'),
    title,
    department: input.department && input.department !== 'construction' ? input.department : undefined,
    fileName: input.fileName,
    ...(input.fileKey ? { fileKey: input.fileKey } : {}),
    ...(notTaken ? { leftOut: notTaken } : {}),
    header: parsed.header.filter((h) => h.label && h.value),
    questions: parsed.questions.map((q, i) => ({
      id: newId('q'),
      order: i,
      section: q.section,
      text: q.text,
      answer: q.answer || undefined,
      source: q.answer ? 'seller' : undefined,
      proof: [],
      answeredBy: q.answer ? 'As received' : undefined,
      answeredAt: q.answer ? at : undefined,
    })),
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };
  list(project).push(questionnaire);
  audit(project, actor, 'questionnaire_added', questionnaire.id, `${title} · ${questionnaire.questions.length} question(s)`);
  return questionnaire;
}

export function removeQuestionnaire(project: DdProject, questionnaireId: string, actor: string): void {
  const found = findQuestionnaire(project, questionnaireId);
  project.questionnaires = list(project).filter((q) => q.id !== questionnaireId);
  audit(project, actor, 'questionnaire_removed', questionnaireId, found.title);
}

export interface AnswerInput {
  answer?: string | null;
  source?: AnswerSource | null;
  proof?: AnswerProof[];
  note?: string | null;
  /** Change the question's own wording or section: an import is not always clean. */
  text?: string;
  section?: string | null;
  omitFromReport?: boolean;
}

function cleanProof(project: DdProject, proof: readonly AnswerProof[]): AnswerProof[] {
  const out: AnswerProof[] = [];
  for (const p of proof) {
    if (!project.evidence.some((e) => e.id === p.evidenceId)) throw new Error(`No document or photograph ${p.evidenceId} on this project.`);
    const page = typeof p.page === 'number' && Number.isFinite(p.page) && p.page >= 1 ? Math.floor(p.page) : undefined;
    const quote = p.quote?.trim() ? p.quote.trim().slice(0, 400) : undefined;
    if (!out.some((o) => o.evidenceId === p.evidenceId && o.page === page)) out.push({ evidenceId: p.evidenceId, page, quote });
  }
  return out;
}

/**
 * Answer a question, or change its answer. A person's answer is theirs and
 * clears any suggestion. Clearing the answer clears its source and proof too:
 * proof of nothing is not proof.
 */
export function answerQuestion(project: DdProject, questionnaireId: string, questionId: string, input: AnswerInput, actor: string): QuestionnaireQuestion {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  const question = findQuestion(questionnaire, questionId);
  const at = nowIso();
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (!text) throw new Error('A question needs its wording.');
    question.text = text;
  }
  if (input.section !== undefined) question.section = input.section?.trim() || undefined;
  if (input.note !== undefined) question.note = input.note?.trim() || undefined;
  if (input.omitFromReport !== undefined) question.omitFromReport = input.omitFromReport || undefined;
  if (input.proof !== undefined) question.proof = cleanProof(project, input.proof);
  if (input.source !== undefined) question.source = input.source ?? undefined;
  if (input.answer !== undefined) {
    const answer = input.answer?.trim() ?? '';
    if (!answer) {
      delete question.answer;
      delete question.source;
      delete question.suggested;
      delete question.answeredBy;
      delete question.answeredAt;
      question.proof = [];
    } else {
      question.answer = answer;
      delete question.suggested;
      question.answeredBy = actor;
      question.answeredAt = at;
      // Proof that names a document makes it a document's answer unless told otherwise.
      if (!question.source) question.source = question.proof.length ? 'document' : 'engineer';
    }
  }
  questionnaire.updatedAt = at;
  audit(project, actor, 'question_answered', question.id, question.answer ?? '(cleared)');
  return question;
}

export interface SuggestedAnswer {
  questionId: string;
  answer: string;
  source?: AnswerSource;
  proof?: AnswerProof[];
}

/**
 * A model's answers, laid beside the questions for a person to confirm.
 *
 * Never over a person's answer: a question already answered by someone keeps
 * what they wrote. Returns how many landed.
 */
export function suggestAnswers(project: DdProject, questionnaireId: string, answers: readonly SuggestedAnswer[], actor: string): number {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  const at = nowIso();
  let landed = 0;
  for (const s of answers) {
    const question = questionnaire.questions.find((q) => q.id === s.questionId);
    const answer = s.answer?.trim();
    if (!question || !answer) continue;
    if (question.answer && !question.suggested && question.source !== 'seller') continue;
    question.answer = answer;
    question.source = s.source ?? (s.proof?.length ? 'document' : 'engineer');
    question.proof = cleanProof(project, s.proof ?? []);
    question.suggested = true;
    question.answeredBy = actor;
    question.answeredAt = at;
    landed += 1;
  }
  if (landed) {
    questionnaire.updatedAt = at;
    audit(project, actor, 'answers_suggested', questionnaire.id, `${landed} answer(s)`);
  }
  return landed;
}

/** Confirm suggested answers as they stand — some, or all when no ids are given. Returns how many. */
export function confirmSuggestions(project: DdProject, questionnaireId: string, questionIds: readonly string[] | 'all', actor: string): number {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  const at = nowIso();
  let n = 0;
  for (const question of questionnaire.questions) {
    if (!question.suggested) continue;
    if (questionIds !== 'all' && !questionIds.includes(question.id)) continue;
    delete question.suggested;
    question.answeredBy = actor;
    question.answeredAt = at;
    n += 1;
  }
  if (n) {
    questionnaire.updatedAt = at;
    audit(project, actor, 'answers_confirmed', questionnaire.id, `${n} answer(s)`);
  }
  return n;
}

export function addQuestion(project: DdProject, questionnaireId: string, input: { text: string; section?: string }, actor: string): QuestionnaireQuestion {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  const text = input.text.trim();
  if (!text) throw new Error('A question needs its wording.');
  const question: QuestionnaireQuestion = { id: newId('q'), order: questionnaire.questions.reduce((m, q) => Math.max(m, q.order), -1) + 1, section: input.section?.trim() || undefined, text, proof: [] };
  questionnaire.questions.push(question);
  questionnaire.updatedAt = nowIso();
  audit(project, actor, 'question_added', question.id, text);
  return question;
}

export function removeQuestion(project: DdProject, questionnaireId: string, questionId: string, actor: string): void {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  findQuestion(questionnaire, questionId);
  questionnaire.questions = questionnaire.questions.filter((q) => q.id !== questionId);
  questionnaire.updatedAt = nowIso();
  audit(project, actor, 'question_removed', questionId);
}

/* ==================================================================== */
/* Answers from what stands on the file                                  */
/* ==================================================================== */

/** What a question asks for, told by its words, and the values on file that answer it. */
const ASKED_FOR: Array<{ asks: RegExp; keys: string[] }> = [
  { asks: /\bsurvey\s*(?:no|nos|number|numbers)\b|\bsy\.?\s*nos?\b/i, keys: ['survey_numbers'] },
  { asks: /\b(?:extent|site area|plot area|land area|area of the (?:land|site|plot|property))\b/i, keys: ['extent_title', 'extent_khata', 'extent_survey'] },
  { asks: /\b(?:owner|owned by|in whose name|title holder)\b/i, keys: ['owner'] },
  { asks: /\b(?:vendor|seller)s?\b.*\bname|\bwho (?:is|was) the (?:vendor|seller)|\bname of the (?:vendor|seller)/i, keys: ['vendor'] },
  { asks: /\b(?:purchaser|buyer)s?\b.*\bname|\bwho (?:is|was) the (?:purchaser|buyer)|\bname of the (?:purchaser|buyer)/i, keys: ['purchaser'] },
  { asks: /\b(?:date of registration|registration date|registered on|when was .*registered)\b/i, keys: ['registration_date'] },
  { asks: /\b(?:document|deed|registration)\s*(?:no|number)\b/i, keys: ['document_number'] },
  { asks: /\bsub[-\s]?registrar\b/i, keys: ['sub_registrar'] },
  { asks: /\b(?:sale consideration|consideration|sale price|purchase price|price paid)\b/i, keys: ['consideration'] },
  { asks: /\bstamp duty\b/i, keys: ['stamp_duty'] },
  { asks: /\b(?:encumbranc\w*|mortgag\w*|charges?|liens?)\b/i, keys: ['ec_nil', 'subsisting_charges', 'ec_from', 'ec_to'] },
  { asks: /\bkhata\s*(?:no|number)\b/i, keys: ['khata_number'] },
  { asks: /\b(?:type of khata|khata type|[abe][-\s]?khata)\b/i, keys: ['khata_type'] },
  { asks: /\bpid\b|property identification/i, keys: ['pid'] },
  { asks: /\b(?:property tax|tax paid|tax receipt)\b/i, keys: ['tax_year', 'tax_paid', 'tax_paid_on'] },
  { asks: /\b(?:zoning|zone|land use)\b/i, keys: ['zoning', 'plan_in_force'] },
  { asks: /\b(?:far|fsi|floor area ratio)\b/i, keys: ['permissible_far', 'sanctioned_far'] },
  { asks: /\b(?:road width|width of the (?:abutting )?road|abutting road)\b/i, keys: ['road_width_ft'] },
  { asks: /\b(?:conversion|converted|non[-\s]?agricultural)\b/i, keys: ['conversion_status', 'converted_use', 'order_number', 'conversion_date'] },
  { asks: /\b(?:plan sanction|sanctioned plan|building plan|sanction (?:no|number|date))\b/i, keys: ['sanction_number', 'sanction_date', 'sanctioned_area'] },
  { asks: /\boccupancy certificate\b|\bOC\b/, keys: ['oc_issued', 'oc_date'] },
  { asks: /\brera\b/i, keys: ['rera_number', 'rera_valid_until'] },
];

/**
 * Answers to a questionnaire's open questions, suggested from what stands on
 * the file, each with the paper and the page it was read from.
 *
 * Only what stands (`standingFacts`): a value a person accepted, or one the
 * rules read off a paper they read surely. A model's reading nobody has
 * accepted, and a value two readers differ on, answer nothing here. Each
 * suggestion waits for a person (`suggestAnswers`), and a question somebody
 * has already answered keeps their answer. Returns how many were suggested.
 */
export function suggestFromFile(project: DdProject, questionnaireId: string, actor: string): number {
  const questionnaire = findQuestionnaire(project, questionnaireId);
  const papers = [...project.evidence].filter((e) => e.status !== 'superseded' && e.status !== 'rejected').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const onFile: Array<{ fact: DocumentFact; paper: EvidenceRecord }> = papers.flatMap((paper) => standingFacts(paper).map((fact) => ({ fact, paper })));
  const suggestions: SuggestedAnswer[] = [];
  for (const question of questionnaire.questions) {
    if (question.answer) continue;
    const keys = ASKED_FOR.filter((topic) => topic.asks.test(question.text)).flatMap((topic) => topic.keys);
    const said: string[] = [];
    const proof: AnswerProof[] = [];
    for (const key of [...new Set(keys)]) {
      // Each value the papers state for it, once: two papers that agree say one thing.
      const stated = onFile.filter((row) => row.fact.key === key).filter((row, n, all) => all.findIndex((other) => String(other.fact.value) === String(row.fact.value)) === n);
      for (const { fact, paper } of stated) {
        said.push(`${fact.label}: ${fact.display} (${paper.documentType ?? paper.title}, p. ${fact.page})`);
        proof.push({ evidenceId: paper.id, page: fact.page, quote: fact.quote });
      }
    }
    if (said.length) suggestions.push({ questionId: question.id, answer: said.join('; '), source: 'document', proof: proof.slice(0, 12) });
  }
  return suggestAnswers(project, questionnaireId, suggestions, actor);
}

/** A questionnaire as it stands, in a sentence for the chat: how many questions, how many answered, waiting and open. */
export function questionnaireSaid(questionnaire: Questionnaire): string {
  const sum = questionnaireSummary(questionnaire);
  const parts = [
    sum.answered ? `${sum.answered} ${sum.answered === 1 ? 'is' : 'are'} answered` : '',
    sum.suggested ? `${sum.suggested} ${sum.suggested === 1 ? 'has an answer' : 'have answers'} suggested from the file, waiting for you` : '',
    sum.unanswered ? `${sum.unanswered} ${sum.unanswered === 1 ? 'is' : 'are'} open` : '',
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
  return `Took in the questionnaire “${questionnaire.title}”: ${sum.total} question${sum.total === 1 ? '' : 's'}.${list ? ` ${list.charAt(0).toUpperCase()}${list.slice(1)}.` : ''}${questionnaire.leftOut ? ` ${questionnaire.leftOut}` : ''}`;
}

/* ==================================================================== */
/* Reading it back                                                       */
/* ==================================================================== */

export function questionStatus(question: QuestionnaireQuestion): QuestionStatus {
  if (!question.answer) return 'unanswered';
  return question.suggested ? 'suggested' : 'answered';
}

export interface QuestionnaireSummary {
  total: number;
  answered: number;
  suggested: number;
  unanswered: number;
  /** Answered with a document or photograph behind them. */
  proven: number;
  /** Resting on the seller's word alone. */
  sellerOnly: number;
  percent: number;
}

export function questionnaireSummary(questionnaire: Questionnaire): QuestionnaireSummary {
  const qs = questionnaire.questions;
  const answered = qs.filter((q) => questionStatus(q) === 'answered');
  return {
    total: qs.length,
    answered: answered.length,
    suggested: qs.filter((q) => questionStatus(q) === 'suggested').length,
    unanswered: qs.filter((q) => questionStatus(q) === 'unanswered').length,
    proven: answered.filter((q) => q.proof.length > 0).length,
    sellerOnly: answered.filter((q) => q.source === 'seller' && q.proof.length === 0).length,
    percent: qs.length ? Math.round((answered.length / qs.length) * 100) : 0,
  };
}

/**
 * One cell of the CSV. A cell that begins with = + - or @ is run as a formula
 * by a spreadsheet that opens the file, and an answer is words somebody typed
 * or a paper states: it is written with an apostrophe before it, which a
 * spreadsheet shows as the words themselves.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function proofLine(project: DdProject, proof: readonly AnswerProof[]): string {
  return proof
    .map((p) => {
      const row = project.evidence.find((e) => e.id === p.evidenceId);
      return `${row?.title ?? p.evidenceId}${p.page ? `, p. ${p.page}` : ''}`;
    })
    .join('; ');
}

/** The columns of the answered sheet, whatever it is taken out as. */
export const QUESTIONNAIRE_COLUMNS = ['No.', 'Section', 'Question', 'Answer', 'Source', 'Proof', 'Status'] as const;

/**
 * The answered sheet as rows, in the order the questions were sent, with what
 * stands behind each answer: where it came from, and the paper and page.
 * The same rows whether it is taken out as CSV, as Excel or as PDF.
 */
export function questionnaireRows(project: DdProject, questionnaire: Questionnaire): string[][] {
  return questionnaire.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((q, i) => [String(i + 1), q.section ?? '', q.text, q.answer ?? '', q.source ? ANSWER_SOURCE_LABEL[q.source] : '', proofLine(project, q.proof), QUESTION_STATUS_LABEL[questionStatus(q)]]);
}

/** The answered sheet, in the order the questions were sent, with what stands behind each answer. */
export function questionnaireCsv(project: DdProject, questionnaire: Questionnaire): string {
  const lines = [QUESTIONNAIRE_COLUMNS.join(','), ...questionnaireRows(project, questionnaire).map((row) => row.map(csvCell).join(','))];
  return `${lines.join('\n')}\n`;
}

/** The same sheet as text for a message or a report: question, then answer and its footing. */
export function questionnaireText(project: DdProject, questionnaire: Questionnaire): string {
  const out: string[] = [questionnaire.title, ...questionnaire.header.map((h) => `${h.label}: ${h.value}`), ''];
  let section: string | undefined;
  questionnaire.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((q, i) => {
      if (q.section && q.section !== section) {
        section = q.section;
        out.push(section.toUpperCase());
      }
      out.push(`${i + 1}. ${q.text}`);
      const footing = [q.source ? ANSWER_SOURCE_LABEL[q.source] : '', proofLine(project, q.proof)].filter(Boolean).join(' · ');
      out.push(`   ${q.answer ?? '(not answered)'}${footing && q.answer ? `  [${footing}]` : ''}${q.suggested ? '  (suggested, not confirmed)' : ''}`);
    });
  return out.join('\n');
}
