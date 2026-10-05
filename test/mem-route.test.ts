/**
 * What the project's memory has been told, over real HTTP.
 *
 * `mem-sync.test.ts` proves what is written to memory and what is read back.
 * This proves the route the firm's own people read it through: that it is
 * mounted, answers newest first with each entry's ids resolved to the titles
 * the record has, gives as many entries as were asked for, counts the nodes
 * the project's memory is and the store holds, and says the memory store did
 * not answer when it did not. That a collaborator is refused
 * it is in `collaborator-reach.test.ts`, beside the other routes that are the
 * workspace's own.
 *
 * Booted with no graph database, so memory is the file beside the project
 * store, and with no way out to the network: what the app fetches for itself
 * at boot is refused here.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, addFinding, createProject, type DdProject } from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let ids: { paper: string; finding: string };
const realFetch = globalThis.fetch;

async function call(route: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}${route}`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-mem-route-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  globalThis.fetch = (async () => {
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  const { store } = await import('../apps/api/src/store');
  project = createProject({ name: 'Memory route plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MR1');
  const paper = addEvidence(project, { title: 'Sale deed', kind: 'document' }, 'lead@example.com');
  project.audit.at(-1)!.at = '2026-10-05T09:00:00.000Z';
  const finding = addFinding(project, { title: 'Extent differs', description: 'Two papers disagree.', severity: 'high', discipline: 'legal' }, 'lead@example.com');
  project.audit.at(-1)!.at = '2026-10-05T10:00:00.000Z';
  ids = { paper: paper.id, finding: finding.id };
  store.data.projects!.push(project);
  await store.save();
  await store.graphCaughtUp();

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.REALYTICA_AUTH_MODE;
});

describe('the route that reads a project’s memory', () => {
  it('answers the entries newest first, each pointing at the record by id with its title', async () => {
    const res = await call(`/api/projects/${project.id}/memory`);
    assert.equal(res.status, 200);
    const entries = res.body.entries as Array<{ kind: string; by?: string; at: string; about: Array<{ id: string; title?: string }> }>;
    assert.deepEqual(
      entries.map((entry) => ({ kind: entry.kind, by: entry.by, at: entry.at, about: entry.about })),
      [
        { kind: 'finding_raised', by: 'lead@example.com', at: '2026-10-05T10:00:00.000Z', about: [{ id: ids.finding, title: 'Extent differs' }] },
        { kind: 'paper_filed', by: 'lead@example.com', at: '2026-10-05T09:00:00.000Z', about: [{ id: ids.paper, title: 'Sale deed' }] },
      ],
    );
  });

  it('counts the nodes the project’s memory is, and the store holds, so that they can be watched', async () => {
    const res = await call(`/api/projects/${project.id}/memory`);
    assert.deepEqual(res.body.nodes, { project: 3, database: 3 }, 'two entries and the node that says where memory stands, in a store that holds nothing else');
  });

  it('answers as many as were asked for', async () => {
    const res = await call(`/api/projects/${project.id}/memory?limit=1`);
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.entries as Array<{ kind: string }>).map((entry) => entry.kind), ['finding_raised']);
  });

  it('knows no project it was not given', async () => {
    assert.equal((await call('/api/projects/prj_no_such_project/memory')).status, 404);
  });

  it('says the memory store did not answer, when it did not', async () => {
    const { memoryPort } = await import('../apps/api/src/graph/mem');
    const failing = mock.method(memoryPort, 'entries', async () => {
      throw new Error('no route to the memory store');
    });
    try {
      const res = await call(`/api/projects/${project.id}/memory`);
      assert.equal(res.status, 503);
      assert.match(String(res.body.error), /memory store did not answer/);
    } finally {
      failing.mock.restore();
    }
  });
});
