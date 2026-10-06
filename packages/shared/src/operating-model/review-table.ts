/**
 * The review table: a project's papers as rows, questions as columns.
 *
 * A column is one of two things. A listed value is a key from the rules' two
 * fixed lists, and its cell is what the paper's row already holds under that
 * key, with its page, its words and where it stands with a person. Nothing is
 * asked of a model for it. A question in words is answered for each paper
 * from that paper's kept page text: by a model where one is set up, and by a
 * search of the text where none is.
 *
 * What a model answers here is not a value of the paper. It is kept in the
 * table (`ReviewTable.answers`), said to be a model's wherever it is shown,
 * and never written to a row's values, so nothing that acts on a value can
 * read it. A row marked reviewed is a person's mark, with who and when.
 *
 * A saved ask is one question in words. A playbook is a named set of columns
 * for a kind of paper. Both are the workspace's, kept in its library.
 *
 * Kept pure, so the page, the API and the tests ask the same question of the
 * same project and get the same table.
 */

import { RULES_FACT_KEYS, STANDARD_FACT_KEYS, paperCarries, type DocumentFact, type FactMarks } from './document-parse';
import { FUNCTION_SHORT, MENU_DEPARTMENTS, functionKey, menuFunctions, withDepartment } from './departments';
import { factReview, proofSaid, stands } from './fact-review';
import { recordAuditEvent } from './operations';
import { can, reachesEveryProject, sameEmail, type WorkspaceRole } from './tenancy';
import { plural } from './text';
import type { DdProject, EvidenceAttachment, EvidenceRecord } from './types';
import { DOCUMENT_WORKSTREAM, documentWorkstream } from './vault';
import { normalizeDigits } from '../script';

/* ==================================================================== */
/* What is kept                                                          */
/* ==================================================================== */

/** Shows a listed value: what the paper's row holds under one of the rules' keys. */
export interface ReviewValueColumn {
  id: string;
  kind: 'value';
  /** A key of `STANDARD_FACT_KEYS` or `RULES_FACT_KEYS`. */
  key: string;
}

/** Asks a question in words of each paper. */
export interface ReviewQuestionColumn {
  id: string;
  kind: 'question';
  question: string;
  /** The kind of paper it is asked of ("Sale deed"), where it came with one. Absent: every paper. */
  paper?: string;
  /** Papers of another kind that a person asked it of by name. */
  also?: string[];
}

export type ReviewColumn = ReviewValueColumn | ReviewQuestionColumn;

/**
 * What stands in a question's cell: a model's answer, or what a search of the
 * page text found where no model is set up. Never a person's word, and never
 * a value of the paper.
 */
export interface ReviewAnswer {
  by: 'model' | 'search';
  at: string;
  /** The file it was answered from: the paper's latest at the time. An answer from an earlier file says nothing of the paper as it is now. */
  fileId: string;
  /** The answer, in the model's words. A search finds words and answers nothing, so it has none. */
  answer?: string;
  /** 1-based page the words are on. */
  page?: number;
  /** The words it rests on, as the page has them. */
  quote?: string;
  /** `page_text`: the words were found on that page. `unverified`: they were not. */
  proof?: 'page_text' | 'unverified';
  /** The page's words are OCR's reading of a scan, not the file's own text. */
  scanned?: true;
  /** Why there is nothing: no page text is kept for the file, the paper does not state it, or the search found none of the words. */
  none?: 'not_read' | 'not_stated' | 'not_found';
  /** The model that answered. */
  model?: string;
}

/** A row a person marked reviewed. */
export interface ReviewMark {
  by: string;
  at: string;
}

/** One go at the question columns, for the papers that were on screen. */
export interface ReviewRun {
  id: string;
  at: string;
  by: string;
  /** A model answers, or the page text is searched because no model is set up. */
  with: 'model' | 'search';
  /** The papers it answers, in order, each with the questions asked of it. At most `REVIEW_RUN_PAPERS`. */
  papers: Array<{ evidenceId: string; columnIds: string[] }>;
  /** The papers answered so far. */
  done: string[];
  stoppedAt?: string;
  stoppedBy?: string;
}

/** The review table as the project's record keeps it. Every part of it is optional on the project. */
export interface ReviewTable {
  columns: ReviewColumn[];
  /** A question's answers: by column, then by paper. */
  answers?: Record<string, Record<string, ReviewAnswer>>;
  /** The rows marked reviewed, by paper. */
  reviewed?: Record<string, ReviewMark>;
  /** The last run. */
  run?: ReviewRun;
}

/** Papers one run answers. More wait for the next. */
export const REVIEW_RUN_PAPERS = 25;
/** Columns one table holds. */
export const REVIEW_COLUMNS_MAX = 40;
/** Letters in a question. */
export const REVIEW_QUESTION_MAX = 300;

/** A project's table, or an empty one. Changes nothing. */
export function reviewTableOf(project: Pick<DdProject, 'reviewTable'>): ReviewTable {
  return project.reviewTable ?? { columns: [] };
}

/* ==================================================================== */
/* The rows: papers on the file                                          */
/* ==================================================================== */

type Paper = Pick<EvidenceRecord, 'id' | 'documentType' | 'proposedDocumentType'>;

/**
 * The papers on the file: a row with a file on it. Not a photograph, which
 * states nothing in words, and not a paper that was rejected or replaced.
 * By kind of paper and then by title, so a kind's papers sit together.
 */
export function reviewPapers(project: Pick<DdProject, 'evidence'>): EvidenceRecord[] {
  return project.evidence
    .filter((row) => row.attachments.length > 0 && row.kind !== 'photograph' && row.status !== 'rejected' && row.status !== 'superseded' && !row.supersededById)
    .sort((a, b) => Number(!a.documentType) - Number(!b.documentType) || (a.documentType ?? '').localeCompare(b.documentType ?? '') || a.title.localeCompare(b.title));
}

/** Which papers a person chose to look at: all of them, one kind, one function's, or named one by one. */
export type ReviewRowChoice = { by: 'all' } | { by: 'kind'; kind: string } | { by: 'function'; fn: string } | { by: 'papers'; ids: readonly string[] };

/** The function a paper belongs to in the menu, when one does. */
function functionOfPaper(project: DdProject, row: EvidenceRecord): string | undefined {
  const workstream = documentWorkstream(project, row);
  return workstream ? functionKey(workstream) : undefined;
}

export function reviewRows(project: DdProject, choice: ReviewRowChoice): EvidenceRecord[] {
  const papers = reviewPapers(project);
  if (choice.by === 'kind') return papers.filter((row) => row.documentType === choice.kind);
  if (choice.by === 'function') return papers.filter((row) => functionOfPaper(project, row) === choice.fn);
  if (choice.by === 'papers') return papers.filter((row) => choice.ids.includes(row.id));
  return papers;
}

/** The kinds of paper on the file, the one with the most papers first. */
export function reviewKinds(project: Pick<DdProject, 'evidence'>): string[] {
  const count = new Map<string, number>();
  for (const row of reviewPapers(project)) if (row.documentType) count.set(row.documentType, (count.get(row.documentType) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind]) => kind);
}

/** The functions that hold a paper on the file, in the menu's order, each by the menu's words ("Legal › Title"). */
export function reviewFunctions(project: DdProject): Array<{ key: string; label: string }> {
  const holding = new Set(reviewPapers(project).map((row) => functionOfPaper(project, row)));
  return MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu))
    .filter((fn) => holding.has(fn.key))
    .map((fn) => ({ key: fn.key, label: withDepartment(fn.key, FUNCTION_SHORT[fn.key] ?? fn.label) }));
}

/** The file a paper's values and pages are read from: its latest. */
export function reviewFileOf(row: Pick<EvidenceRecord, 'attachments'>): EvidenceAttachment | undefined {
  return row.attachments[row.attachments.length - 1];
}

/* ==================================================================== */
/* The columns                                                           */
/* ==================================================================== */

/** The kinds of paper a playbook can be for: the register's own names. */
export const REVIEW_PAPER_KINDS: readonly string[] = Object.keys(DOCUMENT_WORKSTREAM);

/** A listed value's name, from whichever of the two fixed lists holds its key. */
export function reviewValueLabel(key: string): string | undefined {
  return STANDARD_FACT_KEYS[key]?.label ?? RULES_FACT_KEYS[key]?.label;
}

/**
 * The listed values a column can show, by name. Given a kind of paper, the
 * ones that kind carries come first and are marked.
 */
export function reviewValueKeys(kind?: string): Array<{ key: string; label: string; carried: boolean }> {
  const listed = [...Object.entries(STANDARD_FACT_KEYS), ...Object.entries(RULES_FACT_KEYS)].map(([key, known]) => ({
    key,
    label: known.label,
    carried: Boolean(kind && key in STANDARD_FACT_KEYS && paperCarries(kind, key)),
  }));
  return listed.sort((a, b) => Number(b.carried) - Number(a.carried) || a.label.localeCompare(b.label));
}

export function reviewColumnLabel(column: ReviewColumn): string {
  return column.kind === 'value' ? (reviewValueLabel(column.key) ?? column.key) : column.question;
}

/**
 * Whether a column is for a paper.
 *
 * A listed value is for the papers whose kind carries its key
 * (`paperCarries`), under the row's type or the type a model offered for it.
 * A question is for every paper, unless it came for one kind: then for the
 * papers of that kind, and for any other a person asked it of by name.
 */
export function reviewColumnFor(column: ReviewColumn, row: Paper): boolean {
  if (column.kind === 'value') {
    return paperCarries(row.documentType, column.key) || (row.proposedDocumentType !== undefined && paperCarries(row.proposedDocumentType, column.key));
  }
  return !column.paper || row.documentType === column.paper || (column.also ?? []).includes(row.id);
}

/** The columns to draw for the rows on screen: those that are for at least one of them. */
export function reviewColumnsShown(table: ReviewTable, rows: readonly Paper[]): ReviewColumn[] {
  return table.columns.filter((column) => rows.some((row) => reviewColumnFor(column, row)));
}

/* ==================================================================== */
/* The cells                                                             */
/* ==================================================================== */

/** Where a listed value stands with a person. */
export type ReviewStanding = 'approved' | 'waiting' | 'set_aside';

/** Why a cell is empty. */
export type ReviewEmptyWhy = 'not_read' | 'not_stated' | 'no_model' | 'not_asked';

export type ReviewCell =
  /** What the paper's row holds under the key. */
  | { kind: 'value'; display: string; page: number; quote: string; standing: ReviewStanding; aiRead: boolean; proof: string; note?: string; marks?: FactMarks }
  /** A model's answer. `unverified` when its words were not found on its page. */
  | { kind: 'answer'; text: string; page?: number; quote?: string; unverified: boolean; scanned: boolean }
  /** What a search of the page text found, where no model is set up. */
  | { kind: 'found'; page: number; quote: string }
  | { kind: 'empty'; why: ReviewEmptyWhy }
  /** The column is not for this kind of paper. */
  | { kind: 'off' };

export const REVIEW_STANDING_LABEL: Record<ReviewStanding, string> = { approved: 'Approved', waiting: 'Waiting', set_aside: 'Set aside' };
export const REVIEW_EMPTY_LABEL: Record<ReviewEmptyWhy, string> = { not_read: 'Not read', not_stated: 'Not stated', no_model: 'No model', not_asked: 'Not asked' };

/** Every value a paper's row holds, whatever a person has said of it. The table shows each with where it stands, and acts on none. */
function held(row: Pick<EvidenceRecord, 'facts'>): DocumentFact[] {
  return row.facts ?? [];
}

/**
 * Where one value stands. Approved only where the one rule for acting on a
 * value says a person's acceptance holds on this paper (`stands`). A value
 * with another reader's beside it and no decision was never accepted, so it
 * waits, as `settled` has it.
 */
function standingOf(fact: DocumentFact, row: Pick<EvidenceRecord, 'documentType'>): ReviewStanding {
  const review = fact.otherReading && !fact.review ? 'proposed' : factReview(fact);
  if (review === 'rejected') return 'set_aside';
  return review === 'accepted' && stands(fact, row) ? 'approved' : 'waiting';
}

const STANDING_ORDER: ReviewStanding[] = ['approved', 'waiting', 'set_aside'];

function valueCell(column: ReviewValueColumn, row: EvidenceRecord): ReviewCell {
  const under = held(row)
    .filter((fact) => fact.key === column.key)
    .map((fact) => ({ fact, standing: standingOf(fact, row) }))
    .sort((a, b) => STANDING_ORDER.indexOf(a.standing) - STANDING_ORDER.indexOf(b.standing));
  const first = under[0];
  // Read is a row some reader got words from, whether or not it made anything of them.
  const read = Boolean(row.readMethod || row.modelReadAt || held(row).length || reviewFileOf(row)?.reading?.pagesRead);
  if (!first) return { kind: 'empty', why: read ? 'not_stated' : 'not_read' };
  const { fact, standing } = first;
  const note = fact.otherReading && standing === 'waiting' ? 'Two readings differ' : standing === 'approved' && under.some((other) => other.standing === 'waiting') ? 'Another reading waits' : undefined;
  return {
    kind: 'value',
    display: fact.display,
    page: fact.page,
    quote: fact.quote,
    standing,
    aiRead: fact.source === 'model',
    proof: proofSaid(fact),
    ...(note ? { note } : {}),
    ...(fact.marks ? { marks: fact.marks } : {}),
  };
}

/** The answer kept for a question on a paper, where it is about the file the paper has now. */
function answerFor(table: ReviewTable, column: ReviewQuestionColumn, row: EvidenceRecord): ReviewAnswer | undefined {
  const kept = table.answers?.[column.id]?.[row.id];
  return kept && kept.fileId === reviewFileOf(row)?.id ? kept : undefined;
}

function questionCell(table: ReviewTable, column: ReviewQuestionColumn, row: EvidenceRecord, model: boolean): ReviewCell {
  const kept = answerFor(table, column, row);
  const unasked: ReviewCell = { kind: 'empty', why: model ? 'not_asked' : 'no_model' };
  if (!kept) return unasked;
  if (kept.none === 'not_read') return { kind: 'empty', why: 'not_read' };
  if (kept.by === 'search') {
    // A search answers nothing. With a model set up since, the question has not been asked.
    if (model) return unasked;
    return kept.page && kept.quote ? { kind: 'found', page: kept.page, quote: kept.quote } : unasked;
  }
  if (kept.none || !kept.answer) return { kind: 'empty', why: 'not_stated' };
  return {
    kind: 'answer',
    text: kept.answer,
    ...(kept.page ? { page: kept.page } : {}),
    ...(kept.quote ? { quote: kept.quote } : {}),
    unverified: kept.proof !== 'page_text',
    scanned: kept.scanned === true,
  };
}

/**
 * One cell: the column's answer for the paper. `model` says whether a model
 * is set up, which is what an unanswered question's cell says of itself.
 */
export function reviewCell(project: Pick<DdProject, 'reviewTable'>, column: ReviewColumn, row: EvidenceRecord, opts: { model: boolean }): ReviewCell {
  if (!reviewColumnFor(column, row)) return { kind: 'off' };
  return column.kind === 'value' ? valueCell(column, row) : questionCell(reviewTableOf(project), column, row, opts.model);
}

/** Where a cell stands, in a word or two: for a file that is read away from the screen. */
export function reviewCellStands(cell: ReviewCell): string {
  if (cell.kind === 'value') return `${REVIEW_STANDING_LABEL[cell.standing].toLowerCase()}${cell.aiRead && cell.standing !== 'approved' ? ', AI-read' : ''}`;
  if (cell.kind === 'answer') return cell.unverified ? 'AI-read, unverified' : 'AI-read';
  if (cell.kind === 'found') return 'found by search';
  return cell.kind === 'empty' ? REVIEW_EMPTY_LABEL[cell.why].toLowerCase() : '';
}

/* ==================================================================== */
/* Changing the columns                                                  */
/* ==================================================================== */

export type NewReviewColumn = { kind: 'value'; key: string } | { kind: 'question'; question: string; paper?: string };

function tableOn(project: DdProject): ReviewTable {
  return (project.reviewTable ??= { columns: [] });
}

function token(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** A question as it is kept: one line, no longer than a question is. Throws, in words for a person, on one that cannot be kept. */
export function reviewQuestion(text: string): string {
  const question = String(text ?? '').replace(/\s+/g, ' ').trim();
  if ([...question].length < 3) throw new Error('Write the question out.');
  if ([...question].length > REVIEW_QUESTION_MAX) throw new Error(`A question is at most ${REVIEW_QUESTION_MAX} letters.`);
  return question;
}

/** Two questions that are one question: the same words, whatever their case or punctuation. */
function sameQuestion(a: string, b: string): boolean {
  const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
  return bare(a) === bare(b);
}

/**
 * Puts columns on a project's table and answers with them as they stand
 * there. A column already on the table is not added again: a listed value by
 * its key, a question by its words and the kind of paper it is for.
 *
 * `also` is one paper the columns are wanted for by name. A question that
 * came for another kind of paper is then asked of that paper too.
 */
export function addReviewColumns(project: DdProject, wanted: readonly NewReviewColumn[], opts: { also?: string; at?: string } = {}): ReviewColumn[] {
  const table = tableOn(project);
  const named = opts.also ? project.evidence.find((row) => row.id === opts.also) : undefined;
  const out: ReviewColumn[] = [];
  for (const want of wanted) {
    let column: ReviewColumn | undefined;
    if (want.kind === 'value') {
      if (!reviewValueLabel(want.key)) throw new Error('That is not one of the listed values.');
      column = table.columns.find((c) => c.kind === 'value' && c.key === want.key);
      column ??= { id: `v_${want.key}`, kind: 'value', key: want.key };
    } else {
      const question = reviewQuestion(want.question);
      if (want.paper !== undefined && !REVIEW_PAPER_KINDS.includes(want.paper)) throw new Error('That is not a kind of paper the register knows.');
      column = table.columns.find((c) => c.kind === 'question' && sameQuestion(c.question, question) && c.paper === want.paper);
      column ??= { id: token('q'), kind: 'question', question, ...(want.paper ? { paper: want.paper } : {}) };
    }
    if (!table.columns.includes(column)) {
      if (table.columns.length >= REVIEW_COLUMNS_MAX) throw new Error(`A table holds at most ${REVIEW_COLUMNS_MAX} columns.`);
      table.columns.push(column);
    }
    if (named && column.kind === 'question' && !reviewColumnFor(column, named)) column.also = [...(column.also ?? []), named.id];
    out.push(column);
  }
  project.updatedAt = opts.at ?? new Date().toISOString();
  return out;
}

/** Takes a column off the table, and the answers kept for it. */
export function removeReviewColumn(project: DdProject, columnId: string, at = new Date().toISOString()): void {
  const table = tableOn(project);
  if (!table.columns.some((column) => column.id === columnId)) throw new Error('No column by that id.');
  table.columns = table.columns.filter((column) => column.id !== columnId);
  if (table.answers) delete table.answers[columnId];
  project.updatedAt = at;
}

/** Lets go of a question's answers, so it is asked again: of the papers named, or of every paper. */
export function clearReviewAnswers(project: DdProject, columnId: string, rowIds?: readonly string[], at = new Date().toISOString()): void {
  const table = tableOn(project);
  const kept = table.answers?.[columnId];
  if (!kept) return;
  for (const id of rowIds ?? Object.keys(kept)) delete kept[id];
  project.updatedAt = at;
}

/* ==================================================================== */
/* Marking a row reviewed                                                */
/* ==================================================================== */

/**
 * Marks a paper's row reviewed, or takes the mark off. Either way the trail
 * says who and when (`review_row_reviewed`, `review_row_unmarked`).
 */
export function setRowReviewed(project: DdProject, evidenceId: string, reviewed: boolean, actor: string, at = new Date().toISOString()): void {
  const row = reviewPapers(project).find((paper) => paper.id === evidenceId);
  if (!row) throw new Error('No paper by that id on the file.');
  const table = tableOn(project);
  const was = table.reviewed?.[evidenceId];
  if (reviewed === Boolean(was)) return;
  if (reviewed) (table.reviewed ??= {})[evidenceId] = { by: actor, at };
  else delete table.reviewed![evidenceId];
  recordAuditEvent(project, {
    at,
    actor,
    action: reviewed ? 'review_row_reviewed' : 'review_row_unmarked',
    entityType: 'evidence',
    entityId: evidenceId,
    ...(was ? { oldValue: `reviewed by ${was.by}` } : {}),
    ...(reviewed ? { newValue: 'reviewed' } : {}),
  });
}

/* ==================================================================== */
/* A run of the question columns                                         */
/* ==================================================================== */

export interface ReviewRunPlan {
  /** The papers a run would answer, each with the questions still to ask of it. Never more than `REVIEW_RUN_PAPERS`. */
  papers: Array<{ evidenceId: string; columnIds: string[] }>;
  /** How many different questions that is. */
  questions: number;
  /** Papers with questions still to ask that this run leaves for the next. */
  left: number;
}

/**
 * What a run would ask, for the papers on screen and no others: each paper
 * with a question not yet asked of the file it has now. With a model set up,
 * what only a search answered counts as not asked.
 */
export function reviewRunPlan(project: DdProject, rowIds: readonly string[], opts: { model: boolean }): ReviewRunPlan {
  const table = reviewTableOf(project);
  const questions = table.columns.filter((column): column is ReviewQuestionColumn => column.kind === 'question');
  const waiting = reviewPapers(project)
    .filter((row) => rowIds.includes(row.id))
    .map((row) => ({
      evidenceId: row.id,
      columnIds: questions
        .filter((column) => {
          if (!reviewColumnFor(column, row)) return false;
          const kept = answerFor(table, column, row);
          return !kept || (opts.model && kept.by === 'search');
        })
        .map((column) => column.id),
    }))
    .filter((paper) => paper.columnIds.length > 0);
  const papers = waiting.slice(0, REVIEW_RUN_PAPERS);
  return { papers, questions: new Set(papers.flatMap((paper) => paper.columnIds)).size, left: waiting.length - papers.length };
}

/** A run's size, said before it starts: "12 papers, 3 questions". */
export function reviewRunSaid(plan: Pick<ReviewRunPlan, 'papers' | 'questions'>): string {
  return `${plural(plan.papers.length, 'paper')}, ${plural(plan.questions, 'question')}`;
}

/**
 * Starts a run over the papers on screen and leaves a line in the trail
 * (`review_run`) saying how many papers and questions it is. The run before
 * it, finished or not, is let go: one run at a time holds the table.
 */
export function startReviewRun(project: DdProject, rowIds: readonly string[], actor: string, opts: { model: boolean; at?: string }): ReviewRun {
  const plan = reviewRunPlan(project, rowIds, opts);
  if (!plan.papers.length) throw new Error('Every question here has been asked of these papers.');
  const at = opts.at ?? new Date().toISOString();
  const run: ReviewRun = { id: token('rr'), at, by: actor, with: opts.model ? 'model' : 'search', papers: plan.papers, done: [] };
  tableOn(project).run = run;
  recordAuditEvent(project, {
    at,
    actor,
    action: 'review_run',
    entityType: 'review_table',
    entityId: run.id,
    newValue: reviewRunSaid(plan),
    reason: opts.model ? 'answered by a model from the pages kept' : 'the pages kept were searched: no model is set up',
  });
  return run;
}

/** The run in hand, when it is the one named and has not been stopped. */
export function liveReviewRun(project: Pick<DdProject, 'reviewTable'>, runId: string): ReviewRun | undefined {
  const run = project.reviewTable?.run;
  return run && run.id === runId && !run.stoppedAt ? run : undefined;
}

/**
 * Keeps one paper's answers as a run lands them, and counts the paper done.
 * Only for the questions the run asked of that paper, and only while their
 * columns are still on the table. Nothing here touches the paper's own row.
 */
export function keepReviewAnswers(project: DdProject, runId: string, evidenceId: string, answers: Readonly<Record<string, ReviewAnswer>>, at = new Date().toISOString()): void {
  const table = tableOn(project);
  const run = table.run?.id === runId ? table.run : undefined;
  const asked = run?.papers.find((paper) => paper.evidenceId === evidenceId);
  if (!run || !asked) throw new Error('That paper is not in this run.');
  for (const columnId of asked.columnIds) {
    const answer = answers[columnId];
    if (!answer || !table.columns.some((column) => column.id === columnId)) continue;
    ((table.answers ??= {})[columnId] ??= {})[evidenceId] = answer;
  }
  if (!run.done.includes(evidenceId)) run.done.push(evidenceId);
  project.updatedAt = at;
}

/** Stops a run. What it answered stays, and the trail says how far it got (`review_run_stopped`). */
export function stopReviewRun(project: DdProject, runId: string, actor: string, at = new Date().toISOString()): ReviewRun {
  const run = liveReviewRun(project, runId);
  if (!run) throw new Error('That run is over.');
  run.stoppedAt = at;
  run.stoppedBy = actor;
  recordAuditEvent(project, { at, actor, action: 'review_run_stopped', entityType: 'review_table', entityId: run.id, newValue: `${run.done.length} of ${plural(run.papers.length, 'paper')}` });
  return run;
}

/* ==================================================================== */
/* Where no model is set up: a search of a paper's pages                 */
/* ==================================================================== */

/** Words that ask and words that join: no page is found by them. */
const ASIDE = new Set(
  (
    'a an and any are as at be been by can could did do does for from had has have how if in into is it its may might must no not of on or over per shall should so ' +
    'such than that the then there these this those to under was were what when where which who whom whose why will with would yes about ' +
    'say says said state states stated mention mentions mentioned give gives given show shows shown tell tells'
  ).split(' '),
);

/** A word as it is compared: lower-cased, in Latin digits, without the joiners OCR writes inside a word of an Indic script. */
function folded(word: string): string {
  return normalizeDigits(word.normalize('NFKC')).replace(/[‌‍]/g, '').toLowerCase();
}

/** The words of a question worth looking for: not the asking words, and nothing shorter than three letters unless it is a number. */
export function reviewSearchWords(question: string): string[] {
  const words = (question.match(/[\p{L}\p{M}\p{N}‌‍]+/gu) ?? []).map(folded);
  return [...new Set(words.filter((word) => !ASIDE.has(word) && ([...word].length > 2 || /\d/.test(word))))];
}

/** How many words of a page a found passage runs to, at most. */
const PASSAGE_WORDS = 28;

/**
 * The passage of a paper's pages that holds the most of a question's words,
 * with its page: what the table offers where no model is set up.
 *
 * A page is found only when it holds at least two in three of the words
 * looked for, each as a whole word, and both of them where there are only
 * two: "Who witnessed the deed?" is not found on the page that has "deed"
 * and no witness. The passage is the page's own words, never rewritten. It
 * answers nothing: it is where a person might look.
 */
export function searchPagesFor(pages: ReadonlyArray<{ page: number; text: string }>, question: string): { page: number; quote: string } | undefined {
  const wanted = reviewSearchWords(question);
  if (!wanted.length) return undefined;
  const needed = wanted.length <= 2 ? wanted.length : Math.ceil((wanted.length * 2) / 3);
  let best: { page: number; quote: string; onPage: number; inPassage: number } | undefined;
  for (const { page, text } of pages) {
    const words = [...text.matchAll(/[\p{L}\p{M}\p{N}‌‍]+/gu)].map((m) => ({ from: m.index, to: m.index + m[0].length, word: folded(m[0]) }));
    const onPage = wanted.filter((want) => words.some((w) => w.word === want)).length;
    if (onPage < needed || (best && onPage < best.onPage)) continue;
    // The stretch of the page that holds the most of them, the earliest where two hold as many.
    let at = 0;
    let most = 0;
    for (let i = 0; i < words.length; i += 1) {
      if (!wanted.includes(words[i]!.word)) continue;
      const inWindow = new Set(words.slice(i, i + PASSAGE_WORDS).map((w) => w.word).filter((w) => wanted.includes(w))).size;
      if (inWindow > most) [at, most] = [i, inWindow];
    }
    if (best && onPage === best.onPage && most <= best.inPassage) continue;
    const from = Math.max(0, at - 4);
    const stretch = words.slice(from, at + PASSAGE_WORDS);
    const quote = text.slice(stretch[0]!.from, stretch[stretch.length - 1]!.to).replace(/\s+/g, ' ').trim();
    best = { page, quote, onPage, inPassage: most };
  }
  return best ? { page: best.page, quote: best.quote } : undefined;
}

/* ==================================================================== */
/* Taking the table away: CSV and Excel                                  */
/* ==================================================================== */

/** The table as rows of plain cells, the first row its headings. */
export interface ReviewSheet {
  header: string[];
  rows: string[][];
}

/** When a row was reviewed, as a file says it: the day and the time, in UTC. */
function whenSaid(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The table for the papers named, as a sheet: each paper a row, with its
 * kind and its file. Each column is three cells: the value, the page it is
 * on, and where it stands. Then who reviewed the row and when.
 */
export function reviewSheet(project: DdProject, rowIds: readonly string[], opts: { model: boolean }): ReviewSheet {
  const table = reviewTableOf(project);
  const rows = reviewPapers(project).filter((row) => rowIds.includes(row.id));
  const columns = reviewColumnsShown(table, rows);
  const header = ['Paper', 'Kind', 'File', ...columns.flatMap((column) => [reviewColumnLabel(column), 'Page', 'Where it stands']), 'Reviewed by', 'Reviewed on'];
  const body = rows.map((row) => {
    const mark = table.reviewed?.[row.id];
    const cells = columns.flatMap((column) => {
      const cell = reviewCell(project, column, row, opts);
      const value = cell.kind === 'value' ? cell.display : cell.kind === 'answer' ? cell.text : cell.kind === 'found' ? cell.quote : '';
      const page = cell.kind === 'value' || cell.kind === 'answer' || cell.kind === 'found' ? cell.page : undefined;
      return [value, page ? String(page) : '', reviewCellStands(cell)];
    });
    return [row.title, row.documentType ?? '', reviewFileOf(row)?.fileName ?? '', ...cells, mark?.by ?? '', mark ? whenSaid(mark.at) : ''];
  });
  return { header, rows: body };
}

/**
 * A cell that a spreadsheet would run as a formula, made plain text: what a
 * paper states is whatever was typed on it, and a cell that begins with `=`
 * is run by the program that opens the file.
 */
export function plainCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** A sheet as CSV: comma-separated, every cell quoted, and marked as UTF-8 so a spreadsheet reads another script as it is. */
export function reviewCsv(sheet: ReviewSheet): string {
  const line = (cells: readonly string[]) => cells.map((cell) => `"${plainCell(cell).replace(/"/g, '""')}"`).join(',');
  return `﻿${[sheet.header, ...sheet.rows].map(line).join('\r\n')}\r\n`;
}

/* ==================================================================== */
/* The workspace's library: saved asks and playbooks                     */
/* ==================================================================== */

export type ReviewPlaybookColumn = { kind: 'value'; key: string } | { kind: 'question'; question: string };

/** One question in words, saved to be asked again. */
export interface ReviewAsk {
  id: string;
  kind: 'ask';
  question: string;
  by: string;
  at: string;
  changedAt?: string;
}

/** A named set of columns for a kind of paper: a firm's checklist. */
export interface ReviewPlaybook {
  id: string;
  kind: 'playbook';
  name: string;
  /** The kind of paper it is for ("Sale deed"). Absent: any paper. */
  paper?: string;
  columns: ReviewPlaybookColumn[];
  by: string;
  at: string;
  changedAt?: string;
}

export type ReviewLibraryItem = ReviewAsk | ReviewPlaybook;

/** A workspace's saved asks and playbooks, as its library document keeps them. */
export interface ReviewLibrary {
  v: 1;
  items: ReviewLibraryItem[];
}

/** Saved things one workspace keeps. */
export const REVIEW_LIBRARY_MAX = 200;

export type ReviewLibraryInput = { kind: 'ask'; question: string } | { kind: 'playbook'; name: string; paper?: string; columns: readonly ReviewPlaybookColumn[] };

/** What a person typed for a saved thing, as it is kept. Throws, in words for a person, on what cannot be. */
function cleaned(input: ReviewLibraryInput): ReviewLibraryInput {
  if (input.kind === 'ask') return { kind: 'ask', question: reviewQuestion(input.question) };
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Give the playbook a name.');
  if ([...name].length > 80) throw new Error('A name is at most 80 letters.');
  if (input.paper !== undefined && !REVIEW_PAPER_KINDS.includes(input.paper)) throw new Error('That is not a kind of paper the register knows.');
  const columns: ReviewPlaybookColumn[] = [];
  for (const column of input.columns ?? []) {
    if (column.kind === 'value') {
      if (!reviewValueLabel(column.key)) throw new Error('That is not one of the listed values.');
      if (!columns.some((c) => c.kind === 'value' && c.key === column.key)) columns.push({ kind: 'value', key: column.key });
    } else {
      const question = reviewQuestion(column.question);
      if (!columns.some((c) => c.kind === 'question' && sameQuestion(c.question, question))) columns.push({ kind: 'question', question });
    }
  }
  if (!columns.length) throw new Error('A playbook needs at least one column.');
  if (columns.length > REVIEW_COLUMNS_MAX) throw new Error(`A playbook holds at most ${REVIEW_COLUMNS_MAX} columns.`);
  return { kind: 'playbook', name, ...(input.paper ? { paper: input.paper } : {}), columns };
}

/** A new saved thing, by the person who saved it. */
export function reviewLibraryItem(input: ReviewLibraryInput, by: string, at = new Date().toISOString()): ReviewLibraryItem {
  return { id: token(input.kind === 'ask' ? 'ask' : 'pb'), ...cleaned(input), by, at } as ReviewLibraryItem;
}

/** A saved thing with what a person changed on it. It stays the thing it was: an ask does not become a playbook. */
export function changedReviewLibraryItem(item: ReviewLibraryItem, input: ReviewLibraryInput, at = new Date().toISOString()): ReviewLibraryItem {
  if (input.kind !== item.kind) throw new Error('A saved ask and a playbook are different things.');
  return { id: item.id, ...cleaned(input), by: item.by, at: item.at, changedAt: at } as ReviewLibraryItem;
}

/** Who may see the library and run what is in it: the workspace's own people. Somebody working from a grant on one project is not one. */
export function mayReadReviewLibrary(role: WorkspaceRole): boolean {
  return reachesEveryProject(role);
}

/** Who may save to the library, and put columns on a table or run them: the workspace's own people who may change a record. */
export function mayAddToReviewLibrary(role: WorkspaceRole): boolean {
  return reachesEveryProject(role) && can(role, 'write');
}

/** Who may change or remove a saved thing: the person who saved it, and whoever runs the workspace. Everybody else only runs it. */
export function mayChangeReviewLibraryItem(who: { email: string; role: WorkspaceRole }, item: Pick<ReviewLibraryItem, 'by'>): boolean {
  if (!mayAddToReviewLibrary(who.role)) return false;
  return can(who.role, 'admin') || sameEmail(who.email, item.by);
}

/** The columns a saved thing puts on a table. A playbook's questions are for its kind of paper. */
export function reviewColumnsOf(item: ReviewLibraryItem): NewReviewColumn[] {
  if (item.kind === 'ask') return [{ kind: 'question', question: item.question }];
  return item.columns.map((column) => (column.kind === 'value' ? column : { ...column, ...(item.paper ? { paper: item.paper } : {}) }));
}

/** A table's columns as a playbook's. */
export function playbookColumnsOf(columns: readonly ReviewColumn[]): ReviewPlaybookColumn[] {
  return columns.map((column) => (column.kind === 'value' ? { kind: 'value', key: column.key } : { kind: 'question', question: column.question }));
}

/**
 * Runs a saved thing on a project: its columns go on the table. Run on one
 * paper, they are for that paper whatever its kind. Answers with the papers
 * to show: that paper, or the playbook's kind, or nothing where the choice on
 * screen can stay.
 */
export function runReviewLibraryItem(project: DdProject, item: ReviewLibraryItem, opts: { evidenceId?: string; at?: string } = {}): ReviewRowChoice | undefined {
  if (opts.evidenceId && !reviewPapers(project).some((row) => row.id === opts.evidenceId)) throw new Error('No paper by that id on the file.');
  addReviewColumns(project, reviewColumnsOf(item), { also: opts.evidenceId, at: opts.at });
  if (opts.evidenceId) return { by: 'papers', ids: [opts.evidenceId] };
  return item.kind === 'playbook' && item.paper ? { by: 'kind', kind: item.paper } : undefined;
}
