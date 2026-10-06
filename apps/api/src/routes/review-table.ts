/**
 * The review table, and the workspace's saved asks and playbooks.
 *
 * On a project (`/api/projects/:projectId/review`):
 *
 * GET    /                              the table, whether a model is set up, and what this person may do
 * POST   /columns                       put columns on the table
 * DELETE /columns/:columnId
 * POST   /columns/:columnId/ask-again   let go of a question's answers
 * PUT    /rows/:evidenceId/reviewed     mark a row reviewed, or take the mark off
 * POST   /runs                          start a run over the papers on screen (at most 25)
 * POST   /runs/:runId/papers/:evidenceId  answer one paper: every question asked of it, in one call
 * POST   /runs/:runId/stop
 * POST   /library/:itemId/run           put a saved ask's or a playbook's columns on the table
 * POST   /export                        the table for the papers on screen, as CSV or Excel
 *
 * In the workspace's library (`/api/libraries/review`):
 *
 * GET    /            the saved asks and playbooks
 * POST   /            save one
 * PUT    /:itemId     change one
 * DELETE /:itemId
 *
 * Both are the firm's own people's. The table reads every paper on a file and
 * a run is paid for by the firm, so somebody working from a grant on one
 * project is answered as if nothing were here (`workspaceOnly`), and the
 * library is not listed to them.
 *
 * A run is driven from the page, one paper a request. Each request answers
 * every question for one paper in a single model call and saves before it
 * answers, so a run shows each row as it lands, loses nothing when a
 * connection drops, and stops when the page stops asking. The cap on a run is
 * kept here: a paper that is not in a run that was started is not answered.
 *
 * Nothing in this file writes to a paper's own row. A model's answer is kept
 * in the table and nowhere else.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  actorOf,
  addReviewColumns,
  can,
  changedReviewLibraryItem,
  clearReviewAnswers,
  keepReviewAnswers,
  liveReviewRun,
  mayAddToReviewLibrary,
  mayChangeReviewLibraryItem,
  mayReadReviewLibrary,
  removeReviewColumn,
  REVIEW_COLUMNS_MAX,
  REVIEW_LIBRARY_MAX,
  REVIEW_RUN_PAPERS,
  reviewCsv,
  reviewFileOf,
  reviewLibraryItem,
  reviewPapers,
  reviewSheet,
  reviewTableOf,
  runReviewLibraryItem,
  searchPagesFor,
  setRowReviewed,
  startReviewRun,
  stopReviewRun,
  type DdProject,
  type ReviewAnswer,
  type ReviewLibrary,
  type ReviewLibraryItem,
  type ReviewQuestionColumn,
  type ReviewSheet,
} from '@realytica/shared';
import { answerPaperQuestions, reviewModelSetUp } from '@realytica/agents';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { loadPageTexts } from '../documents/page-text';
import { storageAdapter } from '../storage';
import { store } from '../store';
import { documentDisposition } from './document-file';

/* ==================================================================== */
/* The workspace's library document                                      */
/* ==================================================================== */

const LIBRARY_KEY = 'review-library.json';

/**
 * Where a workspace's saved asks and playbooks are kept: one document of
 * their own in storage, beside the projects' folders and inside none of them.
 * Not in the workspace document, which is read on every request and rewritten
 * whole on a save.
 */
function libraryFolder(tenantId: string): string {
  return `_library_${tenantId.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

export async function loadReviewLibrary(tenantId: string): Promise<ReviewLibrary> {
  const bytes = await storageAdapter.getDocument(libraryFolder(tenantId), LIBRARY_KEY);
  if (!bytes) return { v: 1, items: [] };
  try {
    const kept = JSON.parse(bytes.toString('utf8')) as Partial<ReviewLibrary>;
    return { v: 1, items: Array.isArray(kept.items) ? kept.items.filter((item) => item && typeof item.id === 'string' && (item.kind === 'ask' || item.kind === 'playbook')) : [] };
  } catch {
    // A document that cannot be read is not an empty library: saying so keeps the next save from writing over it.
    throw new Error('The library could not be read.');
  }
}

async function saveReviewLibrary(tenantId: string, library: ReviewLibrary): Promise<void> {
  await storageAdapter.putDocument(libraryFolder(tenantId), LIBRARY_KEY, Buffer.from(JSON.stringify(library)), 'application/json');
}

function fail(res: Response, err: unknown, status = 400): void {
  res.status(status).json({ error: err instanceof Error ? err.message : 'Request failed' });
}

const playbookColumn = z.union([
  z.object({ kind: z.literal('value'), key: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('question'), question: z.string().min(1).max(600) }),
]);

const libraryInput = z.union([
  z.object({ kind: z.literal('ask'), question: z.string().min(1).max(600) }),
  z.object({ kind: z.literal('playbook'), name: z.string().min(1).max(200), paper: z.string().max(80).optional(), columns: z.array(playbookColumn).max(REVIEW_COLUMNS_MAX) }),
]);

export const reviewLibraryRouter = Router();

// The workspace's own people only: to anybody else there is no such list.
reviewLibraryRouter.use((req, res, next) => {
  if (!mayReadReviewLibrary(principalOf(req).role)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
});

/** A saved thing as one person is shown it: with whether it is theirs to change. */
function shown(req: Request, item: ReviewLibraryItem): ReviewLibraryItem & { mayChange: boolean } {
  const me = principalOf(req);
  return { ...item, mayChange: mayChangeReviewLibraryItem({ email: actorOf(me), role: me.role }, item) };
}

reviewLibraryRouter.get('/', async (req, res) => {
  const me = principalOf(req);
  try {
    const library = await loadReviewLibrary(me.tenantId);
    res.json({ items: library.items.map((item) => shown(req, item)), mayAdd: mayAddToReviewLibrary(me.role) });
  } catch (err) {
    fail(res, err, 503);
  }
});

reviewLibraryRouter.post('/', async (req, res) => {
  const me = principalOf(req);
  if (!mayAddToReviewLibrary(me.role)) {
    res.status(403).json({ error: `Your role (${me.role}) cannot save to the library.` });
    return;
  }
  const parsed = libraryInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what to save: a question, or a playbook with a name and its columns.' });
    return;
  }
  try {
    const library = await loadReviewLibrary(me.tenantId);
    if (library.items.length >= REVIEW_LIBRARY_MAX) throw new Error(`The library holds at most ${REVIEW_LIBRARY_MAX} saved asks and playbooks.`);
    const item = reviewLibraryItem(parsed.data, actorOf(me));
    library.items.push(item);
    await saveReviewLibrary(me.tenantId, library);
    res.status(201).json({ item: shown(req, item) });
  } catch (err) {
    fail(res, err);
  }
});

reviewLibraryRouter.put('/:itemId', async (req, res) => {
  const me = principalOf(req);
  const parsed = libraryInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what it is to be: a question, or a playbook with a name and its columns.' });
    return;
  }
  try {
    const library = await loadReviewLibrary(me.tenantId);
    const at = library.items.findIndex((item) => item.id === req.params.itemId);
    const item = library.items[at];
    if (!item) {
      res.status(404).json({ error: 'Nothing saved by that id.' });
      return;
    }
    if (!mayChangeReviewLibraryItem({ email: actorOf(me), role: me.role }, item)) {
      res.status(403).json({ error: 'Only the person who saved it, an owner or a manager changes it.' });
      return;
    }
    const next = changedReviewLibraryItem(item, parsed.data);
    library.items[at] = next;
    await saveReviewLibrary(me.tenantId, library);
    res.json({ item: shown(req, next) });
  } catch (err) {
    fail(res, err);
  }
});

reviewLibraryRouter.delete('/:itemId', async (req, res) => {
  const me = principalOf(req);
  try {
    const library = await loadReviewLibrary(me.tenantId);
    const item = library.items.find((kept) => kept.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'Nothing saved by that id.' });
      return;
    }
    if (!mayChangeReviewLibraryItem({ email: actorOf(me), role: me.role }, item)) {
      res.status(403).json({ error: 'Only the person who saved it, an owner or a manager removes it.' });
      return;
    }
    library.items = library.items.filter((kept) => kept.id !== item.id);
    await saveReviewLibrary(me.tenantId, library);
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
});

/* ==================================================================== */
/* A project's table                                                     */
/* ==================================================================== */

type Params = { projectId: string; columnId?: string; evidenceId?: string; runId?: string; itemId?: string };

export const reviewTableRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
reviewTableRouter.use(workspaceOnly);

// Reading the table and taking it away are any of them's. Changing it, and spending on a model, is for those who may change a record.
reviewTableRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path === '/export') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

/** The project the address names, or a 404 already sent. */
function projectOf(req: Request, res: Response): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

const ids = z.array(z.string().min(1).max(120)).max(2000);

reviewTableRouter.get('/', (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const me = principalOf(req);
  res.json({ reviewTable: reviewTableOf(project), model: reviewModelSetUp(), mayChange: can(me.role, 'write') });
});

const newColumn = z.union([
  z.object({ kind: z.literal('value'), key: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('question'), question: z.string().min(1).max(600), paper: z.string().max(80).optional() }),
]);

reviewTableRouter.post('/columns', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ columns: z.array(newColumn).min(1).max(REVIEW_COLUMNS_MAX) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Name the columns to add.' });
    return;
  }
  try {
    addReviewColumns(project, parsed.data.columns);
  } catch (err) {
    fail(res, err);
    return;
  }
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.delete('/columns/:columnId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    removeReviewColumn(project, (req.params as Params).columnId ?? '');
  } catch (err) {
    fail(res, err, 404);
    return;
  }
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.post('/columns/:columnId/ask-again', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ evidenceIds: ids.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Name the papers to ask again.' });
    return;
  }
  clearReviewAnswers(project, (req.params as Params).columnId ?? '', parsed.data.evidenceIds);
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.put('/rows/:evidenceId/reviewed', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ reviewed: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say whether the row is reviewed.' });
    return;
  }
  try {
    setRowReviewed(project, (req.params as Params).evidenceId ?? '', parsed.data.reviewed, actorOf(principalOf(req)));
  } catch (err) {
    fail(res, err, 404);
    return;
  }
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.post('/runs', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ evidenceIds: ids.min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Name the papers on screen.' });
    return;
  }
  try {
    const run = startReviewRun(project, parsed.data.evidenceIds, actorOf(principalOf(req)), { model: reviewModelSetUp() });
    await store.save();
    res.status(201).json({ reviewTable: reviewTableOf(project), run });
  } catch (err) {
    fail(res, err, 409);
  }
});

/** One paper's answers, by question column: from a model, or from a search of its pages where none is set up. */
async function answersFor(
  project: DdProject,
  how: 'model' | 'search',
  evidenceId: string,
  questions: readonly ReviewQuestionColumn[],
): Promise<{ answers: Record<string, ReviewAnswer> } | { failed: string }> {
  const row = reviewPapers(project).find((paper) => paper.id === evidenceId);
  const file = row ? reviewFileOf(row) : undefined;
  if (!row || !file) return { failed: 'That paper is no longer on the file.' };
  const base = { by: how, at: new Date().toISOString(), fileId: file.id } as const;
  const each = (answer: (question: ReviewQuestionColumn) => ReviewAnswer) => ({ answers: Object.fromEntries(questions.map((question) => [question.id, answer(question)])) });

  const kept = await loadPageTexts(project.id, file.storageKey);
  const pages = (kept?.pages ?? []).filter((page) => page.text.trim());
  // No words were kept for this file: there is nothing to answer from, and saying so is the answer.
  if (!pages.length) return each(() => ({ ...base, none: 'not_read' }));

  if (how === 'search') {
    return each((question) => {
      const found = searchPagesFor(pages, question.question);
      return found ? { ...base, page: found.page, quote: found.quote, proof: 'page_text' } : { ...base, none: 'not_found' };
    });
  }

  const read = await answerPaperQuestions({
    caseId: project.id,
    title: row.title,
    ...(row.documentType ? { kind: row.documentType } : {}),
    pages: pages.map((page) => ({ page: page.page, text: page.text, scanned: page.reader === 'ocr' })),
    ...(kept ? { pagesInFile: kept.pagesInFile } : {}),
    questions: questions.map((question) => ({ id: question.id, question: question.question })),
  });
  if (!read.ok) return { failed: read.message };
  const said = new Map(read.answers.map((answer) => [answer.id, answer]));
  return each((question) => {
    const answer = said.get(question.id);
    if (!answer?.stated || !answer.answer) return { ...base, none: 'not_stated', model: read.model };
    return {
      ...base,
      answer: answer.answer,
      ...(answer.page ? { page: answer.page } : {}),
      ...(answer.quote ? { quote: answer.quote } : {}),
      proof: answer.proof ?? 'unverified',
      ...(answer.scanned ? { scanned: true as const } : {}),
      model: read.model,
    };
  });
}

reviewTableRouter.post('/runs/:runId/papers/:evidenceId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const { runId = '', evidenceId = '' } = req.params as Params;
  const run = liveReviewRun(project, runId);
  if (!run) {
    res.status(409).json({ error: 'That run is over.' });
    return;
  }
  const asked = run.papers.find((paper) => paper.evidenceId === evidenceId);
  if (!asked) {
    res.status(404).json({ error: `That paper is not in this run. A run answers at most ${REVIEW_RUN_PAPERS} papers.` });
    return;
  }
  if (run.done.includes(evidenceId)) {
    res.json({ reviewTable: reviewTableOf(project) });
    return;
  }
  const columns = reviewTableOf(project).columns;
  const questions = asked.columnIds.flatMap((id) => columns.filter((column): column is ReviewQuestionColumn => column.id === id && column.kind === 'question'));
  const how = run.with;

  const out = await answersFor(project, how, evidenceId, questions);
  // A model can take a while, and the file may have moved under it: take it as storage has it now, then write.
  await store.syncProject(project.id, { force: true });
  if ('failed' in out) {
    res.json({ reviewTable: reviewTableOf(project), failed: out.failed });
    return;
  }
  try {
    keepReviewAnswers(project, runId, evidenceId, out.answers);
  } catch (err) {
    fail(res, err, 409);
    return;
  }
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.post('/runs/:runId/stop', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    stopReviewRun(project, (req.params as Params).runId ?? '', actorOf(principalOf(req)));
  } catch {
    // Already over: stopping it again changes nothing.
    res.json({ reviewTable: reviewTableOf(project) });
    return;
  }
  await store.save();
  res.json({ reviewTable: reviewTableOf(project) });
});

reviewTableRouter.post('/library/:itemId/run', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ evidenceId: z.string().min(1).max(120).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Name the paper to run it on, or none for the project.' });
    return;
  }
  try {
    const library = await loadReviewLibrary(principalOf(req).tenantId);
    const item = library.items.find((kept) => kept.id === (req.params as Params).itemId);
    if (!item) {
      res.status(404).json({ error: 'Nothing saved by that id.' });
      return;
    }
    const show = runReviewLibraryItem(project, item, parsed.data.evidenceId ? { evidenceId: parsed.data.evidenceId } : {});
    await store.save();
    res.json({ reviewTable: reviewTableOf(project), ...(show ? { show } : {}) });
  } catch (err) {
    fail(res, err);
  }
});

/* ==================================================================== */
/* Taking it away                                                        */
/* ==================================================================== */

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A sheet as an Excel workbook: one worksheet, its heading row and its first
 * column held in place, every cell a string. A cell is never handed over as
 * a formula, so what a paper states is shown and not run.
 *
 * `exceljs` is loaded here and nowhere else, when somebody asks for the file.
 */
export async function reviewXlsx(sheet: ReviewSheet, title: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Review', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  worksheet.addRow(sheet.header);
  for (const row of sheet.rows) worksheet.addRow(row);
  worksheet.getRow(1).font = { bold: true };
  sheet.header.forEach((heading, i) => {
    const longest = Math.max(heading.length, ...sheet.rows.map((row) => (row[i] ?? '').length));
    const column = worksheet.getColumn(i + 1);
    column.width = Math.min(60, Math.max(10, longest + 2));
    column.alignment = { vertical: 'top', wrapText: true };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

reviewTableRouter.post('/export', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ format: z.enum(['csv', 'xlsx']), evidenceIds: ids.min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which papers, and whether as CSV or Excel.' });
    return;
  }
  const sheet = reviewSheet(project, parsed.data.evidenceIds, { model: reviewModelSetUp() });
  const name = `${project.reference}-review`;
  if (parsed.data.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', documentDisposition(false, `${name}.csv`));
    res.send(reviewCsv(sheet));
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await reviewXlsx(sheet, 'Review');
  } catch (err) {
    console.warn(`[review table] the Excel file could not be made: ${(err as Error).message}`);
    res.status(500).json({ error: 'The Excel file could not be made. The CSV holds the same table.' });
    return;
  }
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', documentDisposition(false, `${name}.xlsx`));
  res.send(bytes);
});
