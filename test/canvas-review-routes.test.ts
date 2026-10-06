/**
 * Deciding on the canvas, over real HTTP.
 *
 * `canvas-review.test.ts` proves the decisions. This proves the routes the
 * canvas calls name what they decide by id, and that Undo takes back exactly
 * one instruction — and refuses once anything else has changed the file,
 * rather than restoring over somebody's later work.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import {
  applyProjectChat,
  createAssessment,
  createChatProposal,
  createProject,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** The chat answers in NDJSON; the last line carries the result. `sitting` is the chat it is asked in and when that began, as the page sends them. */
async function chat(projectId: string, question: string, sitting: { sessionId?: string; sessionStartedAt?: string } = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, ...sitting }),
  });
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const result = lines.find((l) => l.type === 'result');
  assert.ok(result, `the chat returned a result: ${JSON.stringify(lines).slice(0, 400)}`);
  return result!;
}

const khata: ChatIngestFile = {
  fileName: 'Khata.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 's3://khata-routes',
  read: {
    type: 'khata',
    label: 'Khata certificate and extract',
    confidence: 0.9,
    method: 'text',
    summary: 'Khata certificate for the parcel.',
    facts: [
      { key: 'extent_khata', label: 'Extent (khata)', value: 11850, display: '11,850 sq ft', page: 1, quote: 'Extent: 11,850 sq ft' },
      { key: 'survey_numbers', label: 'Survey numbers', value: '118/2', display: '118/2', page: 1, quote: 'Sy. No. 118/2' },
    ],
    flags: [],
    rowHints: [],
    scopes: [],
    evidenceKind: 'document',
  },
};

async function seeded(withDd: boolean): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');
  if (withDd) createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  applyProjectChat(p, '', { ingest: [khata] });
  store.data.projects!.push(p);
  return p;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-canvas-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await call('GET', '/api/projects')).status, 200);
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('the canvas routes', () => {
  it('accept one value on a document, and it reaches the check it answers', async () => {
    const p = await seeded(true);
    const row = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === khata.storageKey))!;
    const res = await call('POST', `/api/projects/${p.id}/evidence/${row.id}/facts/review`, { keys: ['survey_numbers'], decision: 'accept' });
    assert.equal(res.status, 200);
    assert.equal(res.body.changed, 1);
    const project = res.body.project as DdProject;
    const parcel = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.title.startsWith('Parcel identification'))!;
    assert.equal(parcel.fields?.survey_numbers?.value, '118/2');
    assert.equal(parcel.fields?.extent_khata, undefined, 'only the value decided');
  });

  it('decide a check’s values by field, and refuse an unknown card', async () => {
    const p = await seeded(true);
    const card = p.chatProposals.find((c) => c.kind === 'record_check_fields' && c.status === 'proposed')!;
    const set = await call('POST', `/api/projects/${p.id}/proposals/${card.id}/fields`, { keys: ['extent_khata'], decision: 'reject' });
    assert.equal(set.status, 200);
    const after = (set.body.project as DdProject).chatProposals.find((c) => c.id === card.id)!;
    assert.deepEqual(after.payload.decided, { extent_khata: 'rejected' });
    assert.equal(after.status, 'proposed', 'the survey number still waits');

    const missing = await call('POST', `/api/projects/${p.id}/proposals/prp_nope/accept`, {});
    assert.equal(missing.status, 404);
  });

  it('accept and set aside what waits elsewhere, by id', async () => {
    const p = await seeded(false);
    const dd = p.chatProposals.find((c) => c.kind === 'start_dd' && c.status === 'proposed')!;
    const started = await call('POST', `/api/projects/${p.id}/proposals/${dd.id}/accept`, {});
    assert.equal(started.status, 200);
    assert.equal((started.body.project as DdProject).assessments.length, 1);

    const risk = createChatProposal('add_risk', 'Flood risk', 'Low-lying.', 'Logs a risk.', { title: 'Flood risk', description: 'Low-lying.', owner: 'tester' }, 'tester');
    p.chatProposals.push(risk);
    const aside = await call('POST', `/api/projects/${p.id}/proposals/${risk.id}/set-aside`);
    assert.equal(aside.status, 200);
    assert.equal((aside.body.project as DdProject).chatProposals.find((c) => c.id === risk.id)?.status, 'rejected');
    assert.equal((aside.body.project as DdProject).risks.length, 0);
  });
});

describe('“approve all”, from the page', () => {
  it('answers the last reply of the chat it is typed in', async () => {
    const p = await seeded(false);
    // The khata was dropped in one chat.
    for (const turn of p.conversation) turn.sessionId = 'ses_routes_first';

    const other = await chat(p.id, 'approve all', { sessionId: 'ses_routes_other' });
    assert.equal((other.project as DdProject).assessments.length, 0, 'typed in another chat, it takes nothing the first one raised');
    assert.match((other.assistantTurn as { text: string }).text, /^Nothing from the last reply is left to accept\. /);

    const own = await chat(p.id, 'approve all', { sessionId: 'ses_routes_first' });
    assert.equal((own.project as DdProject).assessments.length, 1, 'typed in the chat that raised it, it takes it');
  });

  it('answers what the server wrote for this person in the chat on screen', async () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const after = new Date(Date.now() + 60_000).toISOString();
    /** A project whose one reply names no sitting, as the note after a paper filed on the register does not, signed by `actor`. */
    const withNote = async (actor: (me: string) => string): Promise<DdProject> => {
      const p = await seeded(false);
      // Who the route takes this caller for, read off a turn it signs.
      const me = ((await chat(p.id, 'hello', { sessionId: 'ses_routes_probe' })).userTurn as { actor: string }).actor;
      for (const turn of p.conversation.filter((t) => !t.sessionId)) turn.actor = actor(me);
      return p;
    };

    // A sitting that began after it was written does not have it on screen.
    const late = await withNote((me) => me);
    assert.equal(((await chat(late.id, 'approve all', { sessionId: 'ses_routes_later', sessionStartedAt: after })).project as DdProject).assessments.length, 0);

    // One that was open when it was written does, and it is the reply "approve all" answers.
    const mine = await withNote((me) => me);
    const taken = await chat(mine.id, 'approve all', { sessionId: 'ses_routes_open', sessionStartedAt: before });
    assert.equal((taken.project as DdProject).assessments.length, 1);
    // The start came with the request and went no further.
    assert.ok(!JSON.stringify((taken.project as DdProject).conversation).includes(before));

    // Written for a colleague, it is not a reply to this person, whenever their chat began.
    const theirs = await withNote(() => 'colleague@example.com');
    assert.equal(((await chat(theirs.id, 'approve all', { sessionId: 'ses_routes_open', sessionStartedAt: before })).project as DdProject).assessments.length, 0);
  });

  it('says so when asked to read the filed documents and none is left, and that is not the reply “approve all” answers', async () => {
    // The khata is on file and has been read: there is nothing for "read the filed documents" to do.
    const p = await seeded(false);
    const read = await chat(p.id, 'Read the filed documents');
    const said = read.assistantTurn as { text: string; toolCalls?: Array<{ name: string }>; proposalIds?: string[] };
    assert.equal(said.text, 'Nothing on file is left to read.');
    assert.deepEqual(said.toolCalls?.map((call) => call.name), ['nothing_to_read']);
    assert.deepEqual(said.proposalIds ?? [], []);

    // The reply about the khata is still the last reply, and what it raised is what is taken.
    const done = await chat(p.id, 'approve all');
    assert.equal((done.project as DdProject).assessments.length, 1);
  });
});

describe('where a model is configured', () => {
  /*
   * The suite runs with no model, so it never sees what a deployment with one
   * does to a reply: one that names no tool it keeps is handed to the model,
   * which answers the question afresh and replaces the words. A reply that
   * says nothing was accepted, and offers the instructions that would be, has
   * to reach the person as it was written.
   */
  let model: Server;
  let asked = 0;
  const env = { REALYTICA_BASE_URL: process.env.REALYTICA_BASE_URL, REALYTICA_API_KEY: process.env.REALYTICA_API_KEY };

  before(async () => {
    // Something at the address a model would be at. It answers nothing, and counts being asked.
    model = createServer((req, res) => {
      asked += 1;
      req.resume();
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'No model here.' } }));
    });
    await new Promise<void>((resolve) => model.listen(0, () => resolve()));
    process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
    process.env.REALYTICA_API_KEY = 'a-key-for-nobody';
  });

  after(() => {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // The connection the client kept open would otherwise hold the suite until it timed out.
    model?.closeAllConnections();
    model?.close();
  });

  it('an instruction that took nothing is answered as written, and the model is not asked', async () => {
    const p = await seeded(false);
    const out = await chat(p.id, 'approve the survey sketch');
    const said = out.assistantTurn as { text: string; choices?: Array<{ send: string }> };
    assert.match(said.text, /^Nothing was accepted\. /);
    assert.ok((said.choices ?? []).length > 0, 'with the instructions that would take it');
    assert.equal(asked, 0);

    // The model is there to be asked: a sentence that is only talk goes to it.
    await chat(p.id, 'tell me about the neighbourhood');
    assert.ok(asked > 0);
  });
});

describe('undo', () => {
  it('is offered for an instruction, not for a question', async () => {
    const p = await seeded(false);
    const asked = await chat(p.id, 'what is the budget?');
    assert.equal(asked.undo, undefined, 'a question changed nothing to take back');

    const done = await chat(p.id, 'approve all');
    const undo = done.undo as { token: string; label: string } | undefined;
    assert.ok(undo?.token, 'an instruction that changed the file can be taken back');
    assert.equal((done.project as DdProject).assessments.length, 1);

    const back = await call('POST', `/api/projects/${p.id}/undo/${undo!.token}`);
    assert.equal(back.status, 200);
    const restored = back.body.project as DdProject;
    assert.equal(restored.assessments.length, 0, 'the DD is gone again');
    assert.ok(restored.chatProposals.some((c) => c.kind === 'start_dd' && c.status === 'proposed'), 'and waits again');
    assert.match(restored.conversation.at(-1)!.text, /^Undone: /);
    assert.ok(restored.conversation.some((t) => t.text === 'approve all'), 'what was said stays said');

    const twice = await call('POST', `/api/projects/${p.id}/undo/${undo!.token}`);
    assert.equal(twice.status, 404, 'one instruction, taken back once');
  });

  it('is refused once anything else has changed the file', async () => {
    const p = await seeded(false);
    const done = await chat(p.id, 'approve all');
    const undo = done.undo as { token: string };
    const project = done.project as DdProject;
    const row = project.evidence.find((e) => (e.facts ?? []).some((f) => f.review === 'proposed'));
    const waiting = project.chatProposals.find((c) => c.status === 'proposed');
    if (row) await call('POST', `/api/projects/${p.id}/evidence/${row.id}/facts/review`, { keys: 'all', decision: 'reject' });
    else if (waiting) await call('POST', `/api/projects/${p.id}/proposals/${waiting.id}/set-aside`);
    else assert.fail('something should still be waiting after the DD started');

    const refused = await call('POST', `/api/projects/${p.id}/undo/${undo.token}`);
    assert.equal(refused.status, 409);
  });
});
