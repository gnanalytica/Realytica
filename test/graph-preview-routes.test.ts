/**
 * A preview deployment's graph routes, over real HTTP.
 *
 * `graph-preview.test.ts` proves what a preview is handed: a store it cannot
 * change and that never answers. This proves what a caller of a preview is
 * told. Every graph answer there is built from the live registers, so every
 * route that names where its answer came from says `projection`, and never
 * the store the preview reads nothing from. A note is refused with a 503 and
 * the reason, because the caller still holds the only copy.
 *
 * The app is booted the way a preview is: Vercel's name for the deployment,
 * and the live site's graph store configured. The address is one nothing
 * listens on. A preview has to answer all of this without the store, and a
 * route that reached for it would fail here instead of passing by accident.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createProject, type DdProject } from '@realytica/shared';
import { PREVIEW_KEEPS_NO_GRAPH } from '../apps/api/src/graph/preview';

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-preview-routes-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.VERCEL_ENV = 'preview';
  process.env.REALYTICA_NEO4J_URL = 'bolt://127.0.0.1:1';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  const { store } = await import('../apps/api/src/store');
  project = createProject({ name: 'Preview routes plot', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-PR1');
  store.data.projects!.push(project);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.VERCEL_ENV;
  delete process.env.REALYTICA_NEO4J_URL;
});

describe('a preview deployment’s graph routes', () => {
  it('is running detached from the store it was given', async () => {
    const { graphAdapter } = await import('../apps/api/src/graph');
    assert.equal(graphAdapter.detached, true);
    assert.equal(graphAdapter.kind, 'neo4j', 'the store behind it is the live site’s');
  });

  it('says in health that the graph is the projection', async () => {
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.graph, 'projection');
  });

  it('answers the graph from the registers and says so', async () => {
    const res = await call('GET', `/api/projects/${project.id}/graph`);
    assert.equal(res.status, 200);
    assert.equal(res.body.adapter, 'projection');
    assert.ok((res.body.nodes as Array<{ id: string }>).some((n) => n.id === project.id));
  });

  it('has no stored graph to show, and does not name a store that was not read', async () => {
    const res = await call('GET', `/api/projects/${project.id}/graph/stored`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { graph: null, reason: 'not_indexed', adapter: 'projection' });
  });

  it('walks a neighbourhood over the live registers', async () => {
    const found = await call('GET', `/api/projects/${project.id}/graph/neighbourhood?query=${encodeURIComponent('stages')}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.source, 'live');
    assert.equal(found.body.adapter, 'projection');
    assert.equal((found.body.seeds as unknown[]).length, 4, 'the four stages');

    const nothing = await call('GET', `/api/projects/${project.id}/graph/neighbourhood?query=${encodeURIComponent('no such thing on this file')}`);
    assert.equal(nothing.status, 200);
    assert.equal(nothing.body.adapter, 'projection');
    assert.deepEqual(nothing.body.seeds, []);
  });

  it('traces a node and says the same', async () => {
    const res = await call('GET', `/api/projects/${project.id}/graph/trace/${encodeURIComponent(project.id)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.adapter, 'projection');
  });

  it('says what a change reaches from the projection', async () => {
    const res = await call('GET', `/api/projects/${project.id}/graph/impact?node=${encodeURIComponent(`${project.id}::ws::legal.approvals`)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'projection');
  });

  it('refuses a note with a 503 and the reason, rather than taking one it cannot keep', async () => {
    const res = await call('POST', `/api/projects/${project.id}/graph/annotations`, { nodeId: project.id, text: 'Why this matters.' });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: PREVIEW_KEEPS_NO_GRAPH });
    // What is wrong with the request itself is still said first.
    const empty = await call('POST', `/api/projects/${project.id}/graph/annotations`, { nodeId: project.id });
    assert.equal(empty.status, 400);
  });
});
