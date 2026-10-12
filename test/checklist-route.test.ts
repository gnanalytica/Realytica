/**
 * The checklist over real HTTP.
 *
 * `checklist.test.ts` holds the rules. This holds the wiring: that a list
 * arrives as pasted text and as an Excel workbook and lands on the project,
 * that the same list sent again adds nothing, that a line is changed,
 * confirmed and removed through the routes, that one press raises one
 * request a party, and that a file that is no list is refused.
 *
 * The list, the parties and the papers are invented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, checklistSheet, createProject, type DdProject } from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const sent = body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await realFetch(`${base}${route}`, { method, ...sent });
  const text = await res.text();
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('application/json') && text ? JSON.parse(text) : {} };
}

function upload(name: string, bytes: Uint8Array | string, department = 'finance'): FormData {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  form.append('department', department);
  return form;
}

/** A consultant's workbook: a sheet to a stage, the columns named on each. */
async function workbook(): Promise<Uint8Array> {
  const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
  const book = new ExcelJS.Workbook();
  const concept = book.addWorksheet('Concept');
  concept.addRows([
    ['Sl No', 'Item', 'Package', 'Owed by'],
    [1, 'Soil investigation report', 'Civil and structural', 'Geotechnical consultant'],
    [2, 'Built-up area statement', 'Architectural and interiors', 'Architect'],
  ]);
  const tender = book.addWorksheet('Tender');
  tender.addRows([
    ['Sl No', 'Item', 'Package', 'Owed by'],
    [1, 'Final drawing list with revision numbers', 'Architectural and interiors', 'Architect'],
    [2, 'Basic prices', 'MEP', ''],
  ]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, `RYT-${Math.floor(Math.random() * 9000) + 1000}`);
  store.data.projects!.push(project);
  await store.save();
  return project;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-checklist-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  // Nothing here needs anything beyond this process.
  globalThis.fetch = (async () => {
    throw new Error('this test has no network');
  }) as typeof fetch;
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE']) delete process.env[name];
  server?.closeAllConnections();
  server?.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a checklist sent to the project', () => {
  it('is loaded from pasted text, and not loaded twice', async () => {
    const project = await seeded();
    const text = 'Concept:\nCivil and structural\n1. Soil investigation report\n2. Structural drawings\n';
    const first = await call('POST', `/api/projects/${project.id}/checklist/import`, { department: 'finance', text });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.added, first.body.skipped], [2, 0]);
    assert.deepEqual(
      first.body.project.checklist.map((i: Record<string, unknown>) => [i.department, i.stage, i.package, i.title]),
      [
        ['finance', 'Concept', 'Civil and structural', 'Soil investigation report'],
        ['finance', 'Concept', 'Civil and structural', 'Structural drawings'],
      ],
    );
    const again = await call('POST', `/api/projects/${project.id}/checklist/import`, { department: 'finance', text });
    assert.deepEqual([again.status, again.body.added, again.body.skipped, again.body.project.checklist.length], [201, 0, 2, 2]);

    assert.equal((await call('POST', `/api/projects/${project.id}/checklist/import`, { department: 'finance', text: ' \n ' })).status, 400);
    assert.equal((await call('POST', `/api/projects/${project.id}/checklist/import`, { department: 'nowhere', text })).status, 400);
    assert.equal((await call('POST', '/api/projects/prj_nothing/checklist/import', { department: 'finance', text })).status, 404);
  });

  it('is loaded from an Excel workbook, a CSV and a text file, and from nothing else', async () => {
    const project = await seeded();
    const book = await workbook();
    const loaded = await call('POST', `/api/projects/${project.id}/checklist/import`, upload('Information required.xlsx', book));
    assert.equal(loaded.status, 201);
    assert.equal(loaded.body.added, 4);
    assert.deepEqual(
      loaded.body.project.checklist.map((i: Record<string, unknown>) => [i.stage, i.package, i.title, i.owedBy]),
      [
        ['Concept', 'Civil and structural', 'Soil investigation report', 'Geotechnical consultant'],
        ['Concept', 'Architectural and interiors', 'Built-up area statement', 'Architect'],
        ['Tender', 'Architectural and interiors', 'Final drawing list with revision numbers', 'Architect'],
        ['Tender', 'MEP', 'Basic prices', undefined],
      ],
    );
    assert.equal((await call('POST', `/api/projects/${project.id}/checklist/import`, upload('Information required.xlsx', book))).body.added, 0);

    const csv = await call('POST', `/api/projects/${project.id}/checklist/import`, upload('more.csv', 'Item,Stage,Owed by\n"Schedule of finishes, with samples",Schematic,Architect\n'));
    assert.deepEqual([csv.status, csv.body.added], [201, 1]);
    const added = csv.body.project.checklist.at(-1);
    assert.deepEqual([added.title, added.stage, added.owedBy], ['Schedule of finishes, with samples', 'Schematic', 'Architect']);

    const txt = await call('POST', `/api/projects/${project.id}/checklist/import`, upload('more.txt', 'Facade details\nPackage strategy\n', 'construction'));
    assert.deepEqual([txt.status, txt.body.added], [201, 2]);
    assert.equal(txt.body.project.checklist.at(-1).department, 'construction');

    const refused = await call('POST', `/api/projects/${project.id}/checklist/import`, upload('list.pdf', '%PDF-1.4'));
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /\.xlsx, \.csv, \.tsv or \.txt/);
    assert.equal((await call('POST', `/api/projects/${project.id}/checklist/import`, upload('broken.xlsx', 'not a workbook at all, only some words long enough to look for an index in'))).status, 400);
  });

  it('is changed a line at a time, a match is confirmed, and each party is asked once', async () => {
    const project = await seeded();
    const { store } = await import('../apps/api/src/store');
    const logs = addEvidence(project, { title: 'Borehole logs', kind: 'document', status: 'received' }, 'tester');
    logs.attachments.push({ id: 'att_logs', fileName: 'soil-investigation-borehole-logs.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'logs.pdf', uploadedAt: '2026-10-01T00:00:00.000Z' });
    await store.save();
    const at = `/api/projects/${project.id}/checklist`;

    const ids: string[] = [];
    for (const line of [
      { title: 'Soil investigation report', stage: 'Concept', owedBy: 'Geotechnical consultant' },
      { title: 'Structural drawings', stage: 'Concept', owedBy: 'Structural consultant' },
      { title: 'Column schedule', stage: 'Tender', owedBy: 'Structural consultant' },
      { title: 'Package strategy' },
    ]) {
      const made = await call('POST', at, { department: 'finance', ...line });
      assert.equal(made.status, 201);
      ids.push(made.body.itemId);
    }
    assert.equal((await call('POST', at, { department: 'finance', title: 'structural drawings', stage: 'concept' })).status, 400);
    assert.equal((await call('POST', at, { department: 'finance', title: '' })).status, 400);

    const moved = await call('PATCH', `${at}/${ids[3]}`, { title: 'Package strategy note', stage: 'Concept', package: 'General', owedBy: 'Cost consultant', note: null });
    assert.equal(moved.status, 200);
    const strategy = moved.body.project.checklist.find((i: { id: string }) => i.id === ids[3]);
    assert.deepEqual([strategy.title, strategy.stage, strategy.package, strategy.owedBy], ['Package strategy note', 'Concept', 'General', 'Cost consultant']);
    assert.equal((await call('PATCH', `${at}/${ids[3]}`, { stage: 7 })).status, 400);
    assert.equal((await call('PATCH', `${at}/chk_nothing`, { title: 'Anything' })).status, 400);

    // The logs look like the soil report: offered, and in hand only once confirmed.
    const offered = checklistSheet(moved.body.project as DdProject, { department: 'finance' });
    assert.deepEqual([offered.received, offered.toConfirm], [0, 1]);
    const confirmed = await call('PATCH', `${at}/${ids[0]}`, { evidenceId: logs.id });
    assert.equal(confirmed.status, 200);
    assert.equal(checklistSheet(confirmed.body.project as DdProject, { department: 'finance' }).received, 1);
    assert.equal((await call('PATCH', `${at}/${ids[1]}`, { evidenceId: 'ev_nothing' })).status, 400);

    const asked = await call('POST', `${at}/requests`, { department: 'finance', dueAt: '2026-10-30' });
    assert.equal(asked.status, 201);
    assert.equal(asked.body.unassigned, 0);
    const requests = asked.body.project.requests as Array<Record<string, any>>;
    assert.deepEqual(
      requests.map((r) => [r.recipient, r.title, r.status, r.dueAt, r.checklistItemIds.length]),
      [
        ['Structural consultant', '2 documents', 'sent', '2026-10-30', 2],
        ['Cost consultant', 'Package strategy note', 'sent', '2026-10-30', 1],
      ],
    );
    assert.deepEqual((await call('POST', `${at}/requests`, { department: 'finance' })).body.requests, []);
    assert.equal((await call('POST', `${at}/requests`, { department: 'finance', dueAt: 'soon' })).status, 400);

    // Marked by hand, taken back, and cut.
    assert.equal(checklistSheet((await call('PATCH', `${at}/${ids[1]}`, { received: true })).body.project as DdProject).received, 2);
    assert.equal(checklistSheet((await call('PATCH', `${at}/${ids[1]}`, { received: false })).body.project as DdProject).received, 1);
    const cut = await call('DELETE', `${at}/${ids[2]}`);
    assert.equal(cut.status, 200);
    assert.equal(cut.body.project.checklist.length, 3);
    assert.equal((await call('DELETE', `${at}/${ids[2]}`)).status, 400);

    // What was written is what a reload reads.
    const reread = await call('GET', `/api/projects/${project.id}`);
    assert.equal(reread.status, 200);
    assert.equal(reread.body.checklist.length, 3);
  });
});
