/**
 * Valuing a property, over real HTTP.
 *
 * `value-workbench.test.ts` proves what the file offers and what accepting it
 * records. This proves the three routes the Value tab calls: checking the
 * property starts the valuation DD and writes no red flag report of its own;
 * accepting by id records the values and, when asked, the valuation; and a
 * set-aside offer stays out.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, createProject, valueOffers, type DdProject } from '@realytica/shared';

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

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Value routes plot', type: 'residential', location: 'Whitefield', city: 'Bengaluru', jurisdiction: 'Karnataka / BBMP' }, 'RYT-VR1');
  const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' }, 'tester');
  deed.documentType = 'Sale deed';
  deed.facts = [
    { key: 'extent_title', label: 'Extent per title', value: 1200, display: '1,200 sqm', page: 2, quote: 'admeasuring 1,200 sq m' },
    { key: 'consideration', label: 'Sale consideration', value: 55000000, display: 'Rs 5.5 Cr', page: 3, quote: 'consideration of Rs. 5,50,00,000' },
    { key: 'registration_date', label: 'Registered on', value: new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10), display: 'recently', page: 1, quote: 'registered on' },
  ];
  store.data.projects!.push(p);
  return p;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-value-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('the value routes', () => {
  it('check the property, start its valuation DD, and write no report of their own', async () => {
    const p = await seeded();
    const res = await call('POST', `/api/projects/${p.id}/value`, {});
    assert.equal(res.status, 201);
    const project = res.body.project as DdProject;
    assert.ok(res.body.startedAssessmentId, 'a valuation DD was started');
    assert.ok(project.lastScreenResult, 'the title was checked');
    assert.equal(project.reports.length, 0, 'no red flag report on every press');
    const again = await call('POST', `/api/projects/${p.id}/value`, {});
    assert.equal(again.body.startedAssessmentId, undefined, 'the DD is started once');
  });

  it('accept by id, record the valuation when asked, and refuse what the file no longer says', async () => {
    const p = await seeded();
    const ids = valueOffers(p).filter((o) => ['land_area', 'area_valued', 'rate_per_sqm'].includes(o.input)).map((o) => o.id);
    const res = await call('POST', `/api/projects/${p.id}/value/accept`, { ids: [...ids, 'rate_per_sqm|document|gone||1'], record: true });
    assert.equal(res.status, 200);
    assert.equal((res.body.applied as string[]).length, 3);
    assert.equal((res.body.refused as unknown[]).length, 1);
    const project = res.body.project as DdProject;
    const run = project.valuationRuns.find((r) => r.id === res.body.runId)!;
    assert.equal(Math.round(run.working!.runs.find((r) => r.method === 'comparable_rate')!.amount!), 55000000);
    assert.equal(project.landAreaSqm, 1200);
  });

  it('keep a set-aside value out', async () => {
    const p = await seeded();
    const offer = valueOffers(p).find((o) => o.input === 'land_area')!;
    const res = await call('POST', `/api/projects/${p.id}/value/set-aside`, { ids: [offer.id] });
    assert.equal(res.status, 200);
    assert.equal(res.body.setAside, 1);
    const project = res.body.project as DdProject;
    assert.ok(!valueOffers(project).some((o) => o.id === offer.id));
    const bad = await call('POST', `/api/projects/${p.id}/value/accept`, { ids: [] });
    assert.equal(bad.status, 400);
  });
});
