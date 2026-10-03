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

import type { DdProject } from './types';

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
  answeredBy?: string;
  answeredAt?: string;
}

export interface Questionnaire {
  id: string;
  title: string;
  /** The file it was read from, when it was. */
  fileName?: string;
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
  fileName?: string;
  parsed: ParsedQuestionnaire;
}

/**
 * Put a questionnaire on the project. An answer already written in the
 * source is the seller's: it came with the sheet, nobody here has checked it.
 */
export function addQuestionnaire(project: DdProject, input: AddQuestionnaireInput, actor: string): Questionnaire {
  const title = input.title.trim();
  if (!title) throw new Error('Give the questionnaire a name.');
  if (!input.parsed.questions.length) throw new Error('No questions were found in that. Paste one question per line, or a sheet with a Question column.');
  const at = nowIso();
  const questionnaire: Questionnaire = {
    id: newId('qnr'),
    title,
    fileName: input.fileName,
    header: input.parsed.header.filter((h) => h.label && h.value),
    questions: input.parsed.questions.map((q, i) => ({
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

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function proofLine(project: DdProject, proof: readonly AnswerProof[]): string {
  return proof
    .map((p) => {
      const row = project.evidence.find((e) => e.id === p.evidenceId);
      return `${row?.title ?? p.evidenceId}${p.page ? `, p. ${p.page}` : ''}`;
    })
    .join('; ');
}

/** The answered sheet, in the order the questions were sent, with what stands behind each answer. */
export function questionnaireCsv(project: DdProject, questionnaire: Questionnaire): string {
  const lines = [['No.', 'Section', 'Question', 'Answer', 'Source', 'Proof', 'Status'].join(',')];
  questionnaire.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((q, i) => {
      lines.push(
        [String(i + 1), q.section ?? '', q.text, q.answer ?? '', q.source ? ANSWER_SOURCE_LABEL[q.source] : '', proofLine(project, q.proof), QUESTION_STATUS_LABEL[questionStatus(q)]]
          .map(csvCell)
          .join(','),
      );
    });
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
