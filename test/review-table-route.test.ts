/**
 * The review table over real HTTP, with a stand-in for the model.
 *
 * `review-table.test.ts` holds the rules. This holds the wiring: that a run
 * asks every question of one paper in one call and sends words, never the
 * file; that an answer is held to the page before it is kept, and is kept in
 * the table and nowhere on the paper; that the table leaves as CSV and as a
 * workbook Excel opens; and that the workspace's saved asks are kept in a
 * document of their own.
 *
 * The model is a local stand-in that answers as a gateway does: one tool
 * call. The paper, the parties and the numbers are invented.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, attachEvidenceFile, createProject, proposeFacts, type DdProject, type EvidenceRecord, type ReviewRun, type ReviewTable } from '@realytica/shared';
import { placePaperAnswer } from '../packages/agents/src/agents/review-answers';

const PAGES = [
  'SALE DEED\nThis Deed of Absolute Sale is made at Suvarnagiri between Copper Kettle Landholdings Private Limited, the vendor,\nand Nine Lanterns Realty LLP, the purchaser, for a total sale consideration of Rs. 3,18,50,000.',
  'SCHEDULE PROPERTY\nSurvey No. 73/4 of Navilugudda Village, with a right of way twelve feet wide over Survey No. 73/3\nto reach Temple Tank Road, which the purchaser shall keep open at all times.',
];

/** A question the stand-in gives no word on at all, as a model that loses count of what it was asked does. */
const LEFT_OUT = 'What stamp duty was paid?';

/** What the stand-in says to each question it knows. Anything else, it says the pages do not state. */
const SCRIPT: Record<string, { answer: string; page: number | string; words: string }> = {
  // The page written as a word, as a model behind a gateway may write it.
  'Is there a right of way?': { answer: 'Yes, twelve feet wide over Survey No. 73/3.', page: '2', words: 'a right of way twelve feet wide over Survey No. 73/3' },
  // The figure it gives is not the figure in the words it quotes.
  'What was the price?': { answer: 'Rs. 3,18,00,000.', page: 1, words: 'a total sale consideration of Rs. 3,18,50,000' },
};

let server: Server;
let model: Server;
let base: string;
let dataDir: string;
const asked: Array<{ tool: string; text: string; parts: string[] }> = [];

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'stand-in', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, any>; type: string; bytes: Buffer }> {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, bytes, body: type.includes('application/json') && bytes.length ? JSON.parse(bytes.toString('utf8')) : {} };
}

/** A project in the store with one sale deed on it, read, with the words of its two pages kept beside its file. */
async function seeded(): Promise<{ project: DdProject; deed: EvidenceRecord }> {
  const { store } = await import('../apps/api/src/store');
  const { storageAdapter } = await import('../apps/api/src/storage');
  const { pageTextKey } = await import('../apps/api/src/documents/page-text');
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, `RYT-${Math.floor(Math.random() * 9000) + 1000}`);
  const deed = addEvidence(project, { title: 'Sale deed 2021', kind: 'document', status: 'received' }, 'tester');
  const storageKey = `deed-${project.id}.pdf`;
  attachEvidenceFile(project, deed.id, { fileName: 'sale-deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey, capture: {} }, 'tester');
  deed.documentType = 'Sale deed';
  deed.readMethod = 'text';
  deed.facts = proposeFacts([], [{ key: 'survey_numbers', label: 'Survey number', value: '73/4', display: '73/4', page: 2, quote: 'Survey No. 73/4 of Navilugudda Village' }]);
  const kept = { v: 1, fileName: 'sale-deed.pdf', readAt: new Date().toISOString(), pagesInFile: 2, pagesRead: 2, pages: PAGES.map((text, i) => ({ page: i + 1, reader: 'text', text })) };
  await storageAdapter.putDocument(project.id, pageTextKey(storageKey), Buffer.from(JSON.stringify(kept)), 'application/json');
  store.data.projects!.push(project);
  return { project, deed };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-review-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  model = createServer(async (req, res) => {
    const sent = await bodyOf(req);
    const content = (sent.messages?.[0]?.content ?? []) as Array<{ type: string; text?: string }> | string;
    const parts = typeof content === 'string' ? ['text'] : content.map((part) => part.type);
    const text = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('\n');
    const tool = String(sent.tools?.[0]?.name ?? '');
    asked.push({ tool, text, parts });
    const questions = text.slice(text.lastIndexOf('Questions:')).split('\n').slice(1).filter((line) => /^\d+\.\s/.test(line)).map((line) => line.replace(/^\d+\.\s*/, ''));
    const answers = questions.flatMap((question, i) => {
      if (question === LEFT_OUT) return [];
      const said = SCRIPT[question];
      return [said ? { n: i + 1, stated: true, answer: said.answer, page: said.page, words: said.words } : { n: i + 1, stated: false, answer: null, page: null, words: null }];
    });
    streamMessage(res, { answers }, tool);
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  process.env.REALYTICA_API_KEY = 'a-key-for-nobody';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await call('GET', '/api/projects')).status, 200);
});

after(() => {
  for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE']) delete process.env[name];
  model?.closeAllConnections();
  model?.close();
  server?.closeAllConnections();
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a run', () => {
  it('asks every question of one paper in one call, holds each answer to the page, and keeps it in the table alone', async () => {
    const { project, deed } = await seeded();
    const at = `/api/projects/${project.id}/review`;
    const opened = await call('GET', at);
    assert.deepEqual([opened.status, opened.body.model, opened.body.mayChange, opened.body.reviewTable.columns], [200, true, true, []]);

    const added = await call('POST', `${at}/columns`, {
      columns: [{ kind: 'value', key: 'survey_numbers' }, { kind: 'question', question: 'Is there a right of way?' }, { kind: 'question', question: 'What was the price?' }, { kind: 'question', question: 'Who witnessed the deed?' }, { kind: 'question', question: LEFT_OUT }],
    });
    const [, way, price, witness, duty] = (added.body.reviewTable as ReviewTable).columns.map((column) => column.id);

    const started = await call('POST', `${at}/runs`, { evidenceIds: [deed.id] });
    const run = started.body.run as ReviewRun;
    assert.deepEqual([started.status, run.with, run.papers], [201, 'model', [{ evidenceId: deed.id, columnIds: [way, price, witness, duty] }]]);
    assert.equal((await call('POST', `${at}/runs/${run.id}/papers/ev_not_in_the_run`)).status, 404, 'a paper that is not in the run is not answered');

    const held = JSON.stringify(deed.facts);
    const before = asked.length;
    const landed = await call('POST', `${at}/runs/${run.id}/papers/${deed.id}`);
    assert.equal(landed.status, 200);
    assert.equal(asked.length - before, 1, 'one call for the paper, whatever the number of questions');
    const sent = asked[asked.length - 1]!;
    assert.deepEqual([sent.tool, sent.parts], ['record_paper_answers', ['text']], 'words only: no file goes');
    assert.match(sent.text, /Page 2:\nSCHEDULE PROPERTY[\s\S]*Questions:\n1\. Is there a right of way\?\n2\. What was the price\?\n3\. Who witnessed the deed\?\n4\. What stamp duty was paid\?/);

    const table = landed.body.reviewTable as ReviewTable;
    const kept = (id: string | undefined) => table.answers![id!]![deed.id]!;
    assert.deepEqual([kept(way).by, kept(way).page, kept(way).proof, kept(way).answer], ['model', 2, 'page_text', 'Yes, twelve feet wide over Survey No. 73/3.']);
    assert.deepEqual([kept(price).page, kept(price).proof], [1, 'unverified'], 'a figure its own words do not write is unverified, wherever the words are');
    assert.equal(kept(witness).none, 'not_stated');
    assert.deepEqual(table.run!.done, [deed.id]);
    assert.equal(JSON.stringify(deed.facts), held, 'nothing was written to the paper’s own row');
    assert.equal(existsSync(path.join(dataDir, 'v2', 'uploads', project.id, 'project.json')), true, 'saved as it landed');
    // The question the model said nothing on is not said to be unstated: it has no cell, and the next run asks it and nothing else.
    assert.equal(table.answers![duty!]?.[deed.id], undefined);
    const again = await call('POST', `${at}/runs`, { evidenceIds: [deed.id] });
    assert.deepEqual((again.body.run as ReviewRun).papers, [{ evidenceId: deed.id, columnIds: [duty] }]);
    await call('POST', `${at}/columns/${duty}/ask-again`, {});
    await call('DELETE', `${at}/columns/${duty}`);
    assert.equal((await call('POST', `${at}/runs`, { evidenceIds: [deed.id] })).status, 409, 'with that column gone, nothing is left to ask');

    const reviewed = await call('PUT', `${at}/rows/${deed.id}/reviewed`, { reviewed: true });
    assert.equal(typeof (reviewed.body.reviewTable as ReviewTable).reviewed![deed.id]!.by, 'string');
    assert.deepEqual(project.audit.filter((event) => event.action.startsWith('review_')).map((event) => event.action), ['review_run', 'review_run', 'review_row_reviewed']);
  });

  it('searches the pages where no model is set up, and says the search is what answered', async () => {
    const { project, deed } = await seeded();
    const at = `/api/projects/${project.id}/review`;
    const kept = { url: process.env.REALYTICA_BASE_URL, key: process.env.REALYTICA_API_KEY };
    delete process.env.REALYTICA_BASE_URL;
    delete process.env.REALYTICA_API_KEY;
    try {
      assert.equal((await call('GET', at)).body.model, false);
      const added = await call('POST', `${at}/columns`, { columns: [{ kind: 'question', question: 'Is there a right of way?' }] });
      const way = (added.body.reviewTable as ReviewTable).columns[0]!.id;
      const run = (await call('POST', `${at}/runs`, { evidenceIds: [deed.id] })).body.run as ReviewRun;
      assert.equal(run.with, 'search');
      const before = asked.length;
      const landed = await call('POST', `${at}/runs/${run.id}/papers/${deed.id}`);
      const found = (landed.body.reviewTable as ReviewTable).answers![way]![deed.id]!;
      assert.deepEqual([found.by, found.page, found.answer, asked.length - before], ['search', 2, undefined, 0]);
      assert.match(found.quote ?? '', /right of way twelve feet wide/);
    } finally {
      process.env.REALYTICA_BASE_URL = kept.url;
      process.env.REALYTICA_API_KEY = kept.key;
    }
  });
});

describe('an answer held to the page', () => {
  const sent = [
    { page: 1, text: PAGES[0]! },
    { page: 3, text: PAGES[1]!, scanned: true },
  ];
  it('is placed where its words are, among the pages that were sent, and nowhere else', () => {
    const way = { answer: 'Yes, twelve feet wide.', quote: 'a right of way twelve feet wide over Survey No. 73/3' };
    assert.deepEqual(placePaperAnswer({ ...way, page: 1 }, sent), { page: 3, proof: 'page_text', scanned: true }, 'on the page that holds the words, whichever page the model named');
    assert.deepEqual(placePaperAnswer({ ...way, page: 3 }, [sent[0]!]), { proof: 'unverified' }, 'not on a page the model was never sent');
    assert.deepEqual(placePaperAnswer({ answer: 'Yes.', page: 1, quote: 'subject to a mortgage in favour of the bank' }, sent), { page: 1, proof: 'unverified' });
    assert.deepEqual(placePaperAnswer({ answer: 'Yes.', page: 1 }, sent), { page: 1, proof: 'unverified' }, 'no words, no proof');
  });
});

describe('the table taken away', () => {
  it('is a CSV, and a workbook Excel opens', async () => {
    const { project, deed } = await seeded();
    const at = `/api/projects/${project.id}/review`;
    await call('POST', `${at}/columns`, { columns: [{ kind: 'value', key: 'survey_numbers' }] });

    const csv = await call('POST', `${at}/export`, { format: 'csv', evidenceIds: [deed.id] });
    assert.match(csv.type, /^text\/csv/);
    assert.equal(csv.bytes.toString('utf8'), '﻿"Paper","Kind","File","Survey number","Page","Where it stands","Reviewed by","Reviewed on"\r\n"Sale deed 2021","Sale deed","sale-deed.pdf","73/4","2","waiting","",""\r\n');

    const xlsx = await call('POST', `${at}/export`, { format: 'xlsx', evidenceIds: [deed.id] });
    assert.equal(xlsx.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Read back with the library the API wrote it with, found where the API keeps it.
    const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.bytes);
    const sheet = workbook.worksheets[0]!;
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1, 7), ['Paper', 'Kind', 'File', 'Survey number', 'Page', 'Where it stands']);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1, 7), ['Sale deed 2021', 'Sale deed', 'sale-deed.pdf', '73/4', '2', 'waiting']);
  });
});

describe('the workspace’s library', () => {
  it('keeps saved asks and playbooks in a document of their own, and runs one on a project', async () => {
    const { project, deed } = await seeded();
    const saved = await call('POST', '/api/libraries/review', { kind: 'playbook', name: 'Sale deed checklist', paper: 'Sale deed', columns: [{ kind: 'value', key: 'survey_numbers' }, { kind: 'question', question: 'Who witnessed the deed?' }] });
    assert.deepEqual([saved.status, saved.body.item.name, saved.body.item.mayChange], [201, 'Sale deed checklist', true]);
    assert.equal(existsSync(path.join(dataDir, 'v2', 'uploads', '_library_tnt_local', 'review-library.json')), true);

    const listed = await call('GET', '/api/libraries/review');
    assert.deepEqual([listed.body.mayAdd, listed.body.items.map((item: { name?: string }) => item.name)], [true, ['Sale deed checklist']]);
    assert.equal((await call('POST', '/api/libraries/review', { kind: 'playbook', name: 'Nothing', columns: [] })).status, 400);

    const ran = await call('POST', `/api/projects/${project.id}/review/library/${saved.body.item.id}/run`, {});
    assert.deepEqual(ran.body.show, { by: 'kind', kind: 'Sale deed' });
    assert.deepEqual((ran.body.reviewTable as ReviewTable).columns.map((column) => column.kind), ['value', 'question']);
    const onPaper = await call('POST', `/api/projects/${project.id}/review/library/${saved.body.item.id}/run`, { evidenceId: deed.id });
    assert.deepEqual(onPaper.body.show, { by: 'papers', ids: [deed.id] });

    const renamed = await call('PUT', `/api/libraries/review/${saved.body.item.id}`, { kind: 'playbook', name: 'Deed checklist', paper: 'Sale deed', columns: [{ kind: 'question', question: 'Who witnessed the deed?' }] });
    assert.equal(renamed.body.item.name, 'Deed checklist');
    assert.equal((await call('DELETE', `/api/libraries/review/${saved.body.item.id}`)).status, 204);
    assert.deepEqual((await call('GET', '/api/libraries/review')).body.items, []);
  });
});
