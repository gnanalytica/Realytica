/**
 * A status report asked for in the chat, over real HTTP, with a model that
 * is a script.
 *
 * `status-report.test.ts` proves the rules. This proves they are wired: that
 * "write the status …" in the chat writes a draft among the project's
 * reports and says it short with a way to open it; that no model words the
 * reply; that a model is asked once to reword the report's lines, is sent
 * the lines and nothing else, and has its wording kept only where it holds
 * to the line; that a section can be put back to plain words through the
 * route that tunes a section; and that the route that makes a report takes
 * a period.
 *
 * Booted with no graph database. The only address the app can reach is the
 * scripted model's. Every name, paper and date is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addAction, addEvidence, createProject, resolveReportBlock, reviewFacts, type DdProject, type GeneratedReport, type ProjectChatTurn } from '@realytica/shared';

const MODEL_BASE = 'http://status-report.test';
const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let stored: () => DdProject;
const realFetch = globalThis.fetch;

/** How often the model was asked, and what it was last sent. */
let asked = 0;
let sent = '';

function streamed(tool: string, input: unknown): Response {
  const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const body = [
    event('message_start', { type: 'message_start', message: { id: 'msg_status', type: 'message', role: 'assistant', model: 'vendor/basic', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, output_tokens: 1 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 80 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function say(question: string): Promise<{ assistantTurn: ProjectChatTurn; steps: string[] }> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; step?: { label: string } });
  const result = lines.find((line) => line.type === 'result');
  assert.ok(result, 'the chat answered');
  return { ...(result as unknown as { assistantTurn: ProjectChatTurn }), steps: lines.flatMap((line) => (line.type === 'step' && line.step ? [line.step.label] : [])) };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-status-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.REALYTICA_BASE_URL = MODEL_BASE;
  process.env.REALYTICA_API_KEY = 'test-key';
  process.env.REALYTICA_MODEL_JUDGMENT = 'vendor/senior';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(MODEL_BASE)) throw new Error('this test has no network');
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
    const call = JSON.parse(raw) as { tool_choice?: { name?: string }; messages: Array<{ content: unknown }> };
    asked += 1;
    assert.equal(call.tool_choice?.name, 'reword_status_lines', 'the only thing a model is asked for here is a wording of the lines');
    sent = call.messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<{ text?: string }>).map((block) => block.text ?? '') : [String(message.content)])).join('\n');
    const numbered = sent.split('\n').flatMap((line) => {
      const found = /^(\d+)\. (.+)$/.exec(line);
      return found ? [{ n: Number(found[1]), line: found[2]! }] : [];
    });
    const khata = numbered.find((row) => row.line.includes('Khata certificate'))!;
    const overdue = numbered.find((row) => row.line.startsWith('Overdue'))!;
    return streamed('reword_status_lines', {
      lines: [
        { n: khata.n, text: 'The “Khata certificate” was filed and read, and its extent of 11,850 sq ft was accepted.' },
        // The date moved by a day, and the action's name dropped: not the line it was made for.
        { n: overdue.n, text: 'The survey sketch has been overdue since 16 Sep 2026.' },
        // A line the report does not have.
        { n: numbered.length + 3, text: 'The owner should expect a delay of two weeks.' },
      ],
    });
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  const { store } = await import('../apps/api/src/store');

  project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-SR1');
  const at = (when: string, from: number) => project.audit.slice(from).forEach((event) => (event.at = when));
  let mark = project.audit.length;
  const khata = addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD);
  khata.documentType = 'Khata certificate and extract';
  khata.readMethod = 'text';
  khata.facts = [{ key: 'extent_khata', label: 'extent_khata', value: 1100.9, display: '11,850 sq ft', page: 1, quote: 'Extent: 11,850 sq ft', review: 'proposed' }];
  at('2026-09-14T09:00:00.000Z', mark);
  mark = project.audit.length;
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER);
  at('2026-09-14T10:00:00.000Z', mark);
  mark = project.audit.length;
  addAction(project, { title: 'Send the survey sketch', kind: 'clarification', owner: 'Asha', priority: 'medium', dueDate: '2026-09-15' }, LEAD);
  at('2026-09-02T09:00:00.000Z', mark);
  store.data.projects!.push(project);
  await store.save();
  stored = () => store.data.projects!.find((held) => held.id === project.id)!;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT', 'REALYTICA_DATA_DIR']) delete process.env[name];
});

describe('a status report asked for in the chat', () => {
  let report: GeneratedReport;

  it('is written as a draft and said short, by code, with a way to open it', async () => {
    const answer = await say('Write the status report for September 2026 for the owner');
    report = stored().reports[0]!;
    assert.deepEqual([stored().reports.length, report.kind, report.status, report.title], [1, 'status', 'generated', 'Status report for the owner — Northfield corner plot, September 2026']);
    assert.equal(
      answer.assistantTurn.text,
      [
        `Wrote the status report for the owner, September 2026, as a draft: [${report.id}]`,
        '- Changed: 1 paper, 1 value accepted, 1 action overdue.',
        '- Waiting: 1 thing, 1 of them on Asha.',
        '- Next: nothing on the record has a date ahead of it.',
        'Every line in it names the record or paper behind it. Read it, edit it and issue it under your name.',
      ].join('\n'),
    );
    assert.ok(answer.steps.includes('Putting the report in plain words'));
  });

  it('has a model reword its lines once, from the lines alone, and keeps only the wording that holds', () => {
    assert.equal(asked, 1, 'asked once, and not to word the reply');
    assert.match(sent, /^The report is for the owner\.$/m);
    assert.ok(!sent.includes(LEAD) && !sent.includes(VALUER), 'the lines are sent without who did what');

    const changed = report.body.blocks[0]!;
    assert.deepEqual(changed.wording, [{ said: 'Filed and read: “Khata certificate” · accepted: Extent per khata 11,850 sq ft.', as: 'The “Khata certificate” was filed and read, and its extent of 11,850 sq ft was accepted.' }]);
    const table = resolveReportBlock(stored(), changed).table!;
    assert.deepEqual(table.rows.map((row) => [row.cells[1], row.worded === true]), [
      ['The “Khata certificate” was filed and read, and its extent of 11,850 sq ft was accepted.', true],
      ['Overdue: “Send the survey sketch”, due 15 Sep 2026.', false],
    ]);
    assert.deepEqual(table.rows[0]!.cells.slice(2), ['14 Sep 2026', `${LEAD}, ${VALUER}`, 'on file', '“Khata certificate”, Khata certificate and extract'], 'the day, the people and what is behind the line are the file’s own');
    assert.equal(report.body.blocks[1]!.wording, undefined, 'a wording that moved a date is not kept');
  });

  it('is put back to plain words through the route that tunes a section', async () => {
    const changed = report.body.blocks[0]!;
    const res = await realFetch(`${base}/api/projects/${project.id}/reports/${report.id}/blocks/${changed.id}/source`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: { ...changed.source, plain: true } }) });
    assert.ok(res.ok, `the route took it (${res.status})`);
    const block = stored().reports[0]!.body.blocks[0]!;
    assert.deepEqual([block.source!.plain, block.source!.from, block.source!.to], [true, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'], 'and kept the period');
    assert.equal(resolveReportBlock(stored(), block).table!.rows[0]!.cells[1], 'Filed and read: “Khata certificate” · accepted: Extent per khata 11,850 sq ft.');
  });
});

describe('the route that makes a report', () => {
  it('takes a period for a status report, and gives the week so far without one', async () => {
    const make = (body: unknown) => realFetch(`${base}/api/projects/${project.id}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const named = await make({ kind: 'status', period: { from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' }, audience: 'the lender' });
    assert.equal(named.status, 201);
    const report = (await named.json()) as GeneratedReport;
    assert.equal(report.title, 'Status report for the lender — Northfield corner plot, 14 Sep to 20 Sep 2026');
    assert.deepEqual(report.body.blocks.map((block) => [block.source?.kind, block.source?.from, block.source?.to]), [
      ['status_changed', '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
      ['status_waiting', '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
      ['status_next', '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
    ]);
    const week = (await (await make({ kind: 'status' })).json()) as GeneratedReport;
    assert.match(week.title, /^Status report — Northfield corner plot, /);
    assert.equal((await make({ kind: 'status', period: { from: 'last tuesday', to: 'now' } })).status, 400, 'a period that is not two dates is refused');
  });
});
