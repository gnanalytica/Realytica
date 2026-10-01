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
import type { Server } from 'node:http';
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

/** The chat answers in NDJSON; the last line carries the result. */
async function chat(projectId: string, question: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
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
    label: 'Khata certificate',
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
