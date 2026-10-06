/**
 * The review table: papers as rows, questions as columns.
 *
 * One test a rule. A listed value is read off what the paper's row holds and
 * says where it stands. A model's answer is kept in the table and is never a
 * value of the paper. An empty cell says why. A row is marked reviewed by a
 * person, with who and when. A run says its size first, answers only the
 * papers on screen, and never more than twenty-five. The table leaves as a
 * sheet. Saved asks and playbooks are the workspace's, and who may change
 * them is decided in one place.
 *
 * Everything here is invented: the land, the parties and the numbers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REVIEW_RUN_PAPERS,
  addEvidence,
  addReviewColumns,
  attachEvidenceFile,
  changedReviewLibraryItem,
  createProject,
  keepReviewAnswers,
  mayAddToReviewLibrary,
  mayChangeReviewLibraryItem,
  mayReadReviewLibrary,
  plainCell,
  projectView,
  proposeFacts,
  reviewCell,
  reviewColumnsShown,
  reviewCsv,
  reviewFileOf,
  reviewLibraryItem,
  reviewRows,
  reviewRunPlan,
  reviewRunSaid,
  reviewSheet,
  runReviewLibraryItem,
  searchPagesFor,
  setRowReviewed,
  startReviewRun,
  stopReviewRun,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type ReviewColumn,
} from '@realytica/shared';

const fact = (key: string, label: string, value: DocumentFact['value'], display: string, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label, value, display, page: 2, quote: `${label}: ${display}`, ...more });

function project(): DdProject {
  return createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
}

/** A paper on the file: a row with a file on it, read, holding what was read off it. */
function filed(p: DdProject, title: string, type: string | undefined, facts: DocumentFact[] = [], read = true): EvidenceRecord {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  attachEvidenceFile(p, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k-${row.id}.pdf`, capture: {} }, 'tester');
  if (type) row.documentType = type;
  if (read) row.readMethod = 'text';
  row.facts = proposeFacts([], facts);
  return row;
}

const column = (p: DdProject, id: string): ReviewColumn => p.reviewTable!.columns.find((c) => c.id === id)!;

describe('a listed value', () => {
  it('is what the paper’s row holds, with its page, its words and where it stands', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed', [
      fact('extent_title', 'Extent per title', 2450, '2,450 sqm'),
      fact('stamp_duty', 'Stamp duty', 1783600, 'Rs 17.84 lakh', { source: 'model', proof: 'page_text' }),
      fact('vendor', 'Vendor', 'Copper Kettle Landholdings Private Limited', 'Copper Kettle Landholdings Private Limited'),
      fact('purchaser', 'Purchaser', 'Nine Lanterns Realty LLP', 'Nine Lanterns Realty LLP'),
    ]);
    deed.facts!.find((f) => f.key === 'vendor')!.review = 'accepted';
    deed.facts!.find((f) => f.key === 'purchaser')!.review = 'rejected';
    const [extent, duty, vendor, purchaser, khata, registered] = addReviewColumns(
      p,
      ['extent_title', 'stamp_duty', 'vendor', 'purchaser', 'khata_number', 'registration_date'].map((key) => ({ kind: 'value' as const, key })),
    );
    const cell = (c: ReviewColumn | undefined, row = deed) => reviewCell(p, c!, row, { model: false });

    assert.deepEqual(cell(extent), { kind: 'value', display: '2,450 sqm', page: 2, quote: 'Extent per title: 2,450 sqm', standing: 'waiting', aiRead: false, proof: '' });
    assert.deepEqual([cell(vendor), cell(purchaser)].map((c) => c.kind === 'value' && c.standing), ['approved', 'set_aside']);
    const read = cell(duty);
    assert.ok(read.kind === 'value' && read.aiRead && read.standing === 'waiting', 'a model’s value nobody accepted waits, and is said to be a model’s');
    assert.match(read.kind === 'value' ? read.proof : '', /page’s own text/);

    // A sale deed carries no khata number: the column is not for this paper. It carries a registration date, and states none.
    assert.deepEqual([cell(khata), cell(registered)], [{ kind: 'off' }, { kind: 'empty', why: 'not_stated' }]);
    const unread = filed(p, 'Sale deed 1998', 'Sale deed', [], false);
    assert.deepEqual(cell(registered, unread), { kind: 'empty', why: 'not_read' });
  });

  it('is approved only where a person’s acceptance holds on this paper', () => {
    const p = project();
    // Two readers differ and nobody kept one: no decision on it is not an acceptance.
    const contested = filed(p, 'Khata extract', 'Khata certificate and extract', []);
    contested.facts = [fact('khata_number', 'Khata number', '1907/88/3', '1907/88/3', { otherReading: fact('khata_number', 'Khata number', '1907/88/8', '1907/88/8', { source: 'model', proof: 'second_reader' }) })];
    const [khata] = addReviewColumns(p, [{ kind: 'value', key: 'khata_number' }]);
    const cell = reviewCell(p, khata!, contested, { model: false });
    assert.ok(cell.kind === 'value' && cell.standing === 'waiting' && cell.note === 'Two readings differ');
  });
});

describe('a question in words', () => {
  it('is answered in the table and never in the paper’s own values', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed', [fact('extent_title', 'Extent per title', 2450, '2,450 sqm')]);
    const [asked] = addReviewColumns(p, [{ kind: 'question', question: 'Is there a right of way?' }]);
    const held = JSON.stringify(deed.facts);

    assert.deepEqual(reviewCell(p, asked!, deed, { model: true }), { kind: 'empty', why: 'not_asked' });
    assert.deepEqual(reviewCell(p, asked!, deed, { model: false }), { kind: 'empty', why: 'no_model' });

    const run = startReviewRun(p, [deed.id], 'asha@firm.test', { model: true });
    const fileId = reviewFileOf(deed)!.id;
    keepReviewAnswers(p, run.id, deed.id, {
      [asked!.id]: { by: 'model', at: run.at, fileId, answer: 'Yes, twelve feet wide over Survey No. 73/3.', page: 2, quote: 'a right of way twelve feet wide over Survey No. 73/3', proof: 'page_text', model: 'stand-in' },
    });
    assert.deepEqual(reviewCell(p, asked!, deed, { model: true }), {
      kind: 'answer',
      text: 'Yes, twelve feet wide over Survey No. 73/3.',
      page: 2,
      quote: 'a right of way twelve feet wide over Survey No. 73/3',
      unverified: false,
      scanned: false,
    });
    assert.equal(JSON.stringify(deed.facts), held, 'the paper’s row holds what it held');
    assert.deepEqual(p.reviewTable!.run!.done, [deed.id]);

    // Words that were not found on the page: shown, and said to be unverified.
    p.reviewTable!.answers![asked!.id]![deed.id]!.proof = 'unverified';
    const loose = reviewCell(p, asked!, deed, { model: true });
    assert.ok(loose.kind === 'answer' && loose.unverified);

    // A new file on the row: what was answered from the earlier one says nothing of the paper as it is.
    attachEvidenceFile(p, deed.id, { fileName: 'Sale deed 2021 (certified copy).pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k-copy.pdf', capture: {} }, 'tester');
    assert.deepEqual(reviewCell(p, asked!, deed, { model: true }), { kind: 'empty', why: 'not_asked' });
  });

  it('says why a cell is empty: not read, not stated, no model', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed');
    const [asked] = addReviewColumns(p, [{ kind: 'question', question: 'Who witnessed the deed?' }]);
    const run = startReviewRun(p, [deed.id], 'asha@firm.test', { model: true });
    const base = { by: 'model' as const, at: run.at, fileId: reviewFileOf(deed)!.id };
    const why = (answer: Record<string, unknown>, model = true) => {
      p.reviewTable!.answers = { [asked!.id]: { [deed.id]: { ...base, ...answer } } };
      return reviewCell(p, asked!, deed, { model });
    };
    assert.deepEqual(why({ none: 'not_read' }), { kind: 'empty', why: 'not_read' });
    assert.deepEqual(why({ none: 'not_stated' }), { kind: 'empty', why: 'not_stated' });
    // Where no model is set up, a search offers the page's own words, and answers nothing.
    assert.deepEqual(why({ by: 'search', page: 3, quote: 'witnessed by Sri M. Thimmappa', proof: 'page_text' }, false), { kind: 'found', page: 3, quote: 'witnessed by Sri M. Thimmappa' });
    assert.deepEqual(why({ by: 'search', none: 'not_found' }, false), { kind: 'empty', why: 'no_model' });
    assert.deepEqual(why({ by: 'search', page: 3, quote: 'witnessed by Sri M. Thimmappa' }, true), { kind: 'empty', why: 'not_asked' }, 'with a model set up since, it has not been asked');
  });

  it('is found by a search of the pages where no model is set up', () => {
    const pages = [
      { page: 1, text: 'SALE DEED\nThis Deed of Absolute Sale is made at Suvarnagiri between the vendor and the purchaser.' },
      { page: 2, text: 'SCHEDULE PROPERTY\nSurvey No. 73/4 of Navilugudda Village, with a right of way twelve feet wide over Survey No. 73/3\nto reach Temple Tank Road.' },
    ];
    const found = searchPagesFor(pages, 'What does the deed say about the right of way?');
    assert.equal(found?.page, 2);
    assert.match(found!.quote, /with a right of way twelve feet wide over Survey No\. 73\/3/);
    assert.ok(pages[1]!.text.replace(/\s+/g, ' ').includes(found!.quote), 'the page’s own words, never rewritten');
    assert.equal(searchPagesFor(pages, 'Is there a pending mortgage or litigation?'), undefined, 'a page that holds too few of the words is no find');
    assert.equal(searchPagesFor(pages, 'Who witnessed the deed?'), undefined, 'nor is the page that says "deed" and names no witness');
    assert.equal(searchPagesFor(pages, 'What is it?'), undefined, 'asking words alone look for nothing');
  });
});

describe('a row marked reviewed', () => {
  it('carries who and when, comes off again, and leaves the trail a line each time', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed');
    setRowReviewed(p, deed.id, true, 'asha@firm.test', '2026-10-06T09:00:00.000Z');
    assert.deepEqual(p.reviewTable!.reviewed, { [deed.id]: { by: 'asha@firm.test', at: '2026-10-06T09:00:00.000Z' } });
    setRowReviewed(p, deed.id, false, 'ravi@firm.test', '2026-10-06T10:00:00.000Z');
    assert.deepEqual(p.reviewTable!.reviewed, {});
    const trail = p.audit.filter((e) => e.action.startsWith('review_')).map((e) => [e.action, e.entityType, e.entityId, e.actor]);
    assert.deepEqual(trail, [
      ['review_row_reviewed', 'evidence', deed.id, 'asha@firm.test'],
      ['review_row_unmarked', 'evidence', deed.id, 'ravi@firm.test'],
    ]);
    assert.throws(() => setRowReviewed(p, 'ev_nope', true, 'asha@firm.test'), /No paper by that id/);
  });
});

describe('a run of the question columns', () => {
  it('says its size first, answers only the papers on screen, and never more than twenty-five', () => {
    const p = project();
    const deeds = Array.from({ length: 30 }, (_, i) => filed(p, `Sale deed ${String(i + 1).padStart(2, '0')}`, 'Sale deed'));
    const khata = filed(p, 'Khata extract', 'Khata certificate and extract');
    addReviewColumns(p, [
      { kind: 'question', question: 'Is there a right of way?' },
      { kind: 'question', question: 'Who witnessed the deed?', paper: 'Sale deed' },
      { kind: 'value', key: 'survey_numbers' },
    ]);
    const shown = deeds.slice(0, 12).map((row) => row.id);
    assert.equal(reviewRunSaid(reviewRunPlan(p, shown, { model: true })), '12 papers, 2 questions');
    // A question that came for sale deeds is not asked of a khata.
    assert.deepEqual(reviewRunPlan(p, [khata.id], { model: true }).papers.map((paper) => paper.columnIds.length), [1]);

    const all = reviewRunPlan(p, [...deeds.map((row) => row.id), khata.id], { model: true });
    assert.deepEqual([all.papers.length, all.left], [REVIEW_RUN_PAPERS, 6]);

    const run = startReviewRun(p, shown, 'asha@firm.test', { model: true, at: '2026-10-06T09:00:00.000Z' });
    assert.deepEqual(run.papers.map((paper) => paper.evidenceId).sort(), [...shown].sort());
    const line = p.audit.find((e) => e.action === 'review_run')!;
    assert.deepEqual([line.entityType, line.entityId, line.newValue, line.actor], ['review_table', run.id, '12 papers, 2 questions', 'asha@firm.test']);
    assert.throws(() => keepReviewAnswers(p, run.id, deeds[20]!.id, {}), /not in this run/, 'a paper that was not on screen is not answered');

    // Answered once, a paper is not asked again; stopped, the run says how far it got.
    const first = run.papers[0]!;
    keepReviewAnswers(p, run.id, first.evidenceId, Object.fromEntries(first.columnIds.map((id) => [id, { by: 'model' as const, at: run.at, fileId: reviewFileOf(deeds.find((row) => row.id === first.evidenceId)!)!.id, none: 'not_stated' as const }])));
    assert.equal(reviewRunPlan(p, shown, { model: true }).papers.length, 11);
    stopReviewRun(p, run.id, 'asha@firm.test');
    assert.equal(p.audit.find((e) => e.action === 'review_run_stopped')!.newValue, '1 of 12 papers');
    assert.throws(() => stopReviewRun(p, run.id, 'asha@firm.test'), /over/);
  });
});

describe('the table taken away', () => {
  it('is a sheet of value, page, file, where it stands, and who reviewed the row and when', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed', [fact('survey_numbers', 'Survey number', '73/4', '73/4')]);
    deed.facts![0]!.review = 'accepted';
    const [, asked] = addReviewColumns(p, [{ kind: 'value', key: 'survey_numbers' }, { kind: 'question', question: 'Is there a right of way?' }]);
    const run = startReviewRun(p, [deed.id], 'asha@firm.test', { model: true });
    keepReviewAnswers(p, run.id, deed.id, { [asked!.id]: { by: 'model', at: run.at, fileId: reviewFileOf(deed)!.id, answer: '=HYPERLINK("x")', page: 2, quote: 'a right of way', proof: 'unverified' } });
    setRowReviewed(p, deed.id, true, 'asha@firm.test', '2026-10-06T09:30:00.000Z');

    const sheet = reviewSheet(p, [deed.id], { model: true });
    assert.deepEqual(sheet.header, ['Paper', 'Kind', 'File', 'Survey number', 'Page', 'Where it stands', 'Is there a right of way?', 'Page', 'Where it stands', 'Reviewed by', 'Reviewed on']);
    assert.deepEqual(sheet.rows, [['Sale deed 2021', 'Sale deed', 'Sale deed 2021.pdf', '73/4', '2', 'approved', '=HYPERLINK("x")', '2', 'AI-read, unverified', 'asha@firm.test', '2026-10-06 09:30 UTC']]);

    const csv = reviewCsv(sheet);
    assert.ok(csv.startsWith('﻿"Paper","Kind","File"'), 'marked as UTF-8, every cell quoted');
    assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'), 'what a paper states is shown, never run as a formula');
    assert.deepEqual(['=1+1', '+91', '-5', '@x', '73/4'].map(plainCell), ["'=1+1", "'+91", "'-5", "'@x", '73/4']);
  });
});

describe('saved asks and playbooks', () => {
  it('are the workspace’s own people’s: any of them who may write saves, its author or a manager changes it, the rest only run it', () => {
    assert.deepEqual((['owner', 'manager', 'staff', 'viewer', 'collaborator'] as const).map(mayReadReviewLibrary), [true, true, true, true, false]);
    assert.deepEqual((['owner', 'manager', 'staff', 'viewer', 'collaborator'] as const).map(mayAddToReviewLibrary), [true, true, true, false, false]);
    const playbook = reviewLibraryItem({ kind: 'playbook', name: '  Sale deed   checklist ', paper: 'Sale deed', columns: [{ kind: 'value', key: 'survey_numbers' }, { kind: 'question', question: 'Who witnessed the deed?' }] }, 'asha@firm.test');
    assert.equal(playbook.kind === 'playbook' && playbook.name, 'Sale deed checklist');
    const may = (email: string, role: 'owner' | 'manager' | 'staff' | 'viewer') => mayChangeReviewLibraryItem({ email, role }, playbook);
    assert.deepEqual([may('Asha@firm.test', 'staff'), may('ravi@firm.test', 'staff'), may('ravi@firm.test', 'manager'), may('asha@firm.test', 'viewer')], [true, false, true, false]);

    assert.throws(() => reviewLibraryItem({ kind: 'playbook', name: 'Empty', columns: [] }, 'asha@firm.test'), /at least one column/);
    assert.throws(() => reviewLibraryItem({ kind: 'playbook', name: 'Odd', columns: [{ kind: 'value', key: 'made_up_key' }] }, 'asha@firm.test'), /listed values/);
    assert.throws(() => changedReviewLibraryItem(playbook, { kind: 'ask', question: 'Is there a right of way?' }), /different things/);
    const renamed = changedReviewLibraryItem(playbook, { kind: 'playbook', name: 'Deed checklist', paper: 'Sale deed', columns: [{ kind: 'question', question: 'Who witnessed the deed?' }] }, '2026-10-06T11:00:00.000Z');
    assert.deepEqual([renamed.id, renamed.by, renamed.changedAt], [playbook.id, 'asha@firm.test', '2026-10-06T11:00:00.000Z']);
  });

  it('run on a project add their columns for the papers of that kind, and on one paper open the table on it', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed');
    const khata = filed(p, 'Khata extract', 'Khata certificate and extract');
    const scan = filed(p, 'Scan 0007', undefined);
    const playbook = reviewLibraryItem({ kind: 'playbook', name: 'Sale deed checklist', paper: 'Sale deed', columns: [{ kind: 'value', key: 'registration_date' }, { kind: 'question', question: 'Who witnessed the deed?' }] }, 'asha@firm.test');

    assert.deepEqual(runReviewLibraryItem(p, playbook), { by: 'kind', kind: 'Sale deed' });
    assert.deepEqual(reviewRows(p, { by: 'kind', kind: 'Sale deed' }).map((row) => row.id), [deed.id]);
    assert.equal(reviewColumnsShown(p.reviewTable!, [deed]).length, 2);
    assert.equal(reviewColumnsShown(p.reviewTable!, [khata]).length, 0, 'a khata is shown none of a sale deed’s checklist');
    runReviewLibraryItem(p, playbook);
    assert.equal(p.reviewTable!.columns.length, 2, 'run twice, its columns are there once');

    // On one paper, whatever its kind: the questions are asked of that paper too.
    assert.deepEqual(runReviewLibraryItem(p, playbook, { evidenceId: scan.id }), { by: 'papers', ids: [scan.id] });
    assert.deepEqual(reviewRunPlan(p, [scan.id, khata.id], { model: true }).papers.map((paper) => paper.evidenceId), [scan.id]);

    // A saved ask is one question, for every paper.
    const ask = reviewLibraryItem({ kind: 'ask', question: 'Is there a right of way?' }, 'asha@firm.test');
    assert.equal(runReviewLibraryItem(p, ask), undefined);
    assert.equal(column(p, p.reviewTable!.columns[2]!.id).kind, 'question');
    assert.equal(reviewColumnsShown(p.reviewTable!, [khata]).length, 1);
  });
});

describe('somebody working from a grant', () => {
  it('is handed a project with no review table on it', () => {
    const p = project();
    const deed = filed(p, 'Sale deed 2021', 'Sale deed');
    addReviewColumns(p, [{ kind: 'question', question: 'Is there a right of way?' }]);
    setRowReviewed(p, deed.id, true, 'asha@firm.test');
    const grant = { id: 'grant-1', tenantId: 't1', projectId: p.id, email: 'contractor@outside.test', role: 'contributor' as const, allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'asha@firm.test' };
    assert.equal(projectView(p, { kind: 'granted', grant, email: grant.email }).project.reviewTable, undefined);
  });
});
