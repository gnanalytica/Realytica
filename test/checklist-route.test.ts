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
    // A document set aside is one of the project's own, by an id of an id's length.
    for (const body of [{ dismiss: 'ev_nothing' }, { dismiss: 'x'.repeat(81) }, { evidenceId: 'x'.repeat(81) }]) {
      assert.equal((await call('PATCH', `${at}/${ids[1]}`, body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    const untouched = (await call('GET', `/api/projects/${project.id}`)).body.checklist.find((i: { id: string }) => i.id === ids[1]);
    assert.equal(untouched.dismissed, undefined);
    const setAside = await call('PATCH', `${at}/${ids[1]}`, { dismiss: logs.id });
    assert.equal(setAside.status, 200);
    assert.deepEqual(setAside.body.project.checklist.find((i: { id: string }) => i.id === ids[1]).dismissed, [logs.id]);

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

/* ==================================================================== */
/* A tracked list, and a tender form                                     */
/* ==================================================================== */

const TRACKED_HEAD = ['Ref No', 'Orig. Sl.No', 'Package', 'Description of Information Required', 'Availability (at request)', 'Request Ref', 'Client Response / Remarks', 'Current Status', 'Responsibility', 'Target Date', 'Next Action / NCC Comments'];

/** A consultant's tracked list as pasted rows: a title, the columns, a section, and five items across three packages. */
function trackedText(status: Record<string, string> = {}): string {
  const rows = [
    ['INFORMATION REQUIRED TO UPDATE THE BUDGET'],
    TRACKED_HEAD,
    ['1', '', '', 'GENERAL'],
    ['1.1', 'A.1', 'General', 'Approved master plan with area statement', 'Not available', 'E mail 01', 'Attached', status['1.1'] ?? 'Received'],
    ['1.2', 'A.2', 'General', 'Project programme with key dates', 'Partially available', 'E mail 01', 'Concept available', status['1.2'] ?? 'Partial'],
    ['2', '', '', 'CIVIL & STRUCTURAL WORKS'],
    ['2.1', 'B.1', 'Civil and structural', 'Soil investigation report', 'Not available', 'E mail 01', 'Cost to be considered based on area', status['2.1'] ?? 'NCC to assume'],
    ['2.2', 'B.2', 'Civil and structural', 'Basement waterproofing specification', 'Not available', 'E mail 02', '', status['2.2'] ?? 'Pending'],
    ['3', '', '', 'MEP'],
    ['3.1', 'E.1', 'MEP', 'Lift traffic analysis', 'Not available', '', '', status['3.1'] ?? 'Pending'],
  ];
  return rows.map((row) => row.join('\t')).join('\n');
}

/** A tender form as a workbook: the lines above the table, the six columns, two sections and a signature block. */
async function tenderForm(defects = '12 months'): Promise<Uint8Array> {
  const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Client inputs').addRows([
    ['INFORMATION AND DOCUMENTS REQUIRED FROM THE CLIENT FOR PREPARATION OF THE TENDER DOCUMENT'],
    ['Project:', 'Lake Road offices', '', 'Client:', 'Lake Road Developers'],
    ['Package:', 'Civil and structural works', '', 'Response required by:', '20/10/2026'],
    [],
    ['S.No', 'Information / Document Required', 'Details to be Provided', 'Client Response', 'Document Attached', 'Remarks'],
    [3, 'MOBILIZATION ADVANCE'],
    ['3.1', 'Mobilization advance applicable', 'Yes / No', 'Yes'],
    ['3.2', 'Mobilization advance amount', '% of contract value', '10% of contract value'],
    [4, 'MATERIALS SUPPLIED BY CLIENT'],
    ['4.1', 'Materials supplied by the client', 'Cement, steel, others or none', 'Not Applicable'],
    [7, 'TYPE OF CONTRACT'],
    ['7.1', 'Type of contract', 'Item rate / lump sum', 'Item rate'],
    ['7.4', 'Defect liability period', 'Months', defects],
    ['7.5', 'Liquidated damages', 'Rate per week or day, cap %', ''],
    [],
    ['Name of client representative:', '', '', 'Date:', ''],
  ]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe('a tracked list sent to the project', () => {
  it('is looked at first, stays on the desk it is loaded on unless a package is sent elsewhere, and updates its own lines when it is sent again', async () => {
    const project = await seeded();
    const at = `/api/projects/${project.id}/checklist`;
    const preview = await call('POST', `${at}/import`, { department: 'finance', text: trackedText(), preview: true });
    assert.equal(preview.status, 200);
    assert.deepEqual([preview.body.kind, preview.body.list, preview.body.lines, preview.body.project], ['tracked', 'INFORMATION REQUIRED TO UPDATE THE BUDGET', 5, undefined]);
    // Each package with how many lines it has and where it could go. None is sent anywhere: nobody chose to.
    assert.deepEqual(preview.body.desks, [
      { package: 'General', suggested: 'finance.budget', lines: 2 },
      { package: 'Civil and structural', suggested: 'design.structure', lines: 2 },
      { package: 'MEP', suggested: 'design.electrical', lines: 1 },
    ]);
    assert.equal(preview.body.report.added.length, 5);
    assert.equal((await call('GET', `/api/projects/${project.id}`)).body.checklist ?? undefined, undefined, 'looking changes nothing');

    // Loaded with no package sent anywhere, every line stays on Finance, where it was loaded.
    const kept = await seeded();
    const stayed = await call('POST', `/api/projects/${kept.id}/checklist/import`, { department: 'finance', text: trackedText() });
    assert.deepEqual((stayed.body.project.checklist as Array<Record<string, any>>).map((line) => [line.ref, line.department, line.fn]), [['1.1', 'finance', undefined], ['1.2', 'finance', undefined], ['2.1', 'finance', undefined], ['2.2', 'finance', undefined], ['3.1', 'finance', undefined]]);

    // The firm chooses to send each package to a function as it loads the list: MEP to another than the table's.
    const loaded = await call('POST', `${at}/import`, { department: 'finance', text: trackedText(), desks: { General: 'finance.budget', 'Civil and structural': 'design.structure', MEP: 'design.fire' } });
    assert.equal(loaded.status, 201);
    assert.deepEqual([loaded.body.kind, loaded.body.added, loaded.body.said], ['tracked', 5, '5 added']);
    const lines = loaded.body.project.checklist as Array<Record<string, any>>;
    assert.deepEqual(
      lines.map((line) => [line.ref, line.department, line.fn, line.round, Boolean(line.received), Boolean(line.partial), line.assumed?.assumer]),
      [
        ['1.1', 'finance', 'finance.budget', 'E mail 01', true, false, undefined],
        ['1.2', 'finance', 'finance.budget', 'E mail 01', false, true, undefined],
        ['2.1', 'design', 'design.structure', 'E mail 01', false, false, 'NCC'],
        ['2.2', 'design', 'design.structure', 'E mail 02', false, false, undefined],
        ['3.1', 'design', 'design.fire', undefined, false, false, undefined],
      ],
    );
    assert.equal((await call('POST', `${at}/import`, { department: 'finance', text: trackedText(), desks: { MEP: 'no.such.function' } })).status, 400);

    const again = await call('POST', `${at}/import`, { department: 'finance', text: trackedText({ '2.2': 'Received', '1.2': 'Received' }), desks: { General: 'finance.budget', 'Civil and structural': 'design.structure', MEP: 'design.fire' } });
    assert.deepEqual([again.status, again.body.added, again.body.said], [201, 0, '2 now received']);
    assert.deepEqual(again.body.report.becameReceived, ['1.2 Project programme with key dates', '2.2 Basement waterproofing specification']);
    assert.equal(again.body.project.checklist.length, 5);
  });

  it('has its lines given a party and a day together, marked partly in hand, and marked to be assumed with the field they stand in for', async () => {
    const project = await seeded();
    const at = `/api/projects/${project.id}/checklist`;
    const lines = (await call('POST', `${at}/import`, { department: 'finance', text: trackedText() })).body.project.checklist as Array<Record<string, any>>;
    const id = (ref: string) => lines.find((line) => line.ref === ref)!.id as string;

    const assigned = await call('POST', `${at}/assign`, { itemIds: [id('2.2'), id('3.1')], owedBy: 'Lake Road Developers', targetDate: '2026-11-20' });
    assert.deepEqual([assigned.status, assigned.body.changed], [200, 2]);
    assert.deepEqual(
      (assigned.body.project.checklist as Array<Record<string, any>>).filter((line) => ['2.2', '3.1'].includes(line.ref)).map((line) => [line.owedBy, line.targetDate]),
      [['Lake Road Developers', '2026-11-20'], ['Lake Road Developers', '2026-11-20']],
    );
    assert.equal((await call('POST', `${at}/assign`, { itemIds: [id('2.2')] })).status, 400);
    assert.equal((await call('POST', `${at}/assign`, { itemIds: ['chk_nothing'], owedBy: 'X' })).status, 404);
    assert.equal((await call('POST', `${at}/assign`, { itemIds: [id('2.2')], targetDate: 'soon' })).status, 400);

    const partial = await call('PATCH', `${at}/${id('2.2')}`, { partial: { wanted: 'Tanking detail at the raft' }, remark: 'Specification received without details', targetDate: '2026-11-25' });
    assert.equal(partial.status, 200);
    const line = (partial.body.project.checklist as Array<Record<string, any>>).find((held) => held.ref === '2.2')!;
    assert.deepEqual([line.partial.wanted, line.remark.text, line.remark.from, line.targetDate], ['Tanking detail at the raft', 'Specification received without details', 'person', '2026-11-25']);
    assert.equal((await call('PATCH', `${at}/${id('2.2')}`, { partial: false })).body.project.checklist.find((held: Record<string, any>) => held.ref === '2.2').partial, undefined);

    // A line to be assumed, standing in for a field of the budget's contingency sheet: the field reads the value as assumed.
    const address = { fn: 'finance.budget', set: 'finance.budget.contingency', field: 'contingency_original' };
    const assumed = await call('PATCH', `${at}/${id('1.2')}`, { assumed: { assumer: 'Northbank Cost Consultants', fields: [{ address, value: '4500000' }] } });
    assert.equal(assumed.status, 200, JSON.stringify(assumed.body).slice(0, 200));
    const held = (assumed.body.project.checklist as Array<Record<string, any>>).find((item) => item.ref === '1.2')!;
    assert.deepEqual([held.assumed.assumer, held.assumed.fields, held.partial], ['Northbank Cost Consultants', [{ address, value: 4500000 }], undefined]);
    const { readSheet } = await import('@realytica/shared');
    const field = readSheet(assumed.body.project as DdProject, 'finance.budget.contingency')!.fields.find((view) => view.def.key === 'contingency_original')!;
    assert.deepEqual([field.state, field.held?.value, field.source?.kind], ['assumed', 4500000, 'default']);
    // A value the field cannot hold is refused, and the line is left as it was.
    assert.equal((await call('PATCH', `${at}/${id('1.1')}`, { assumed: { assumer: 'NCC', fields: [{ address, value: 'about forty-five lakh' }] } })).status, 400);
    assert.equal((await call('PATCH', `${at}/${id('1.1')}`, { assumed: { assumer: 'NCC', fields: [{ address: { ...address, fn: 'nowhere.atall' }, value: 1 }] } })).status, 400);
    assert.equal((await call('PATCH', `${at}/${id('1.2')}`, { assumed: false })).body.project.checklist.find((item: Record<string, any>) => item.ref === '1.2').assumed, undefined);
  });
});

describe('a load, as one step', () => {
  it('says what the sheet held, is taken back whole, and a list is removed whole', async () => {
    const project = await seeded();
    const at = `/api/projects/${project.id}/checklist`;
    const loaded = await call('POST', `${at}/import`, { department: 'finance', text: trackedText() });
    // Nine rows under the header: five lines and three sections, and the title row above it is no paper.
    assert.deepEqual(loaded.body.counted, { rows: 8, lines: 5, sections: 3, skipped: [] });
    assert.match(loaded.body.load, /^load_/);
    assert.equal(loaded.body.file, 'Pasted list');
    assert.ok((loaded.body.project.checklist as Array<Record<string, any>>).every((line) => line.load === loaded.body.load));
    // A later copy adds one line: taking that load back takes the one line.
    const more = trackedText().replace('3.1\tE.1', '3.1\tE.1').concat('\n3.2\tE.2\tMEP\tFire pump schedule\tNot available\tE mail 02\t\tPending');
    const second = await call('POST', `${at}/import`, { department: 'finance', text: more });
    assert.deepEqual([second.body.added, second.body.project.checklist.length], [1, 6]);
    const undone = await call('POST', `${at}/remove`, { load: second.body.load });
    assert.deepEqual([undone.status, undone.body.removed, undone.body.project.checklist.length], [200, 1, 5]);
    assert.equal((await call('POST', `${at}/remove`, { load: second.body.load })).status, 404);
    assert.equal((await call('POST', `${at}/remove`, {})).status, 400);
    assert.equal((await call('POST', `${at}/remove`, { load: 'a', list: 'b' })).status, 400);
    // Several lines set together, as they are ticked on the screen.
    const ids = (undone.body.project.checklist as Array<Record<string, any>>).filter((line) => ['2.2', '3.1'].includes(line.ref)).map((line) => line.id);
    const set = await call('POST', `${at}/assign`, { itemIds: ids, standing: 'in_hand' });
    assert.deepEqual((set.body.project.checklist as Array<Record<string, any>>).filter((line) => ids.includes(line.id)).map((line) => Boolean(line.received)), [true, true]);
    assert.equal((await call('POST', `${at}/assign`, { itemIds: ids, standing: 'assumed' })).status, 400);
    assert.equal((await call('POST', `${at}/assign`, { itemIds: ids, standing: 'lost' })).status, 400);
    // The whole list taken off, in one act.
    const removed = await call('POST', `${at}/remove`, { list: 'INFORMATION REQUIRED TO UPDATE THE BUDGET' });
    assert.deepEqual([removed.status, removed.body.removed, removed.body.project.checklist], [200, 5, []]);
    // A plain list says which of its lines were already there.
    await call('POST', `${at}/import`, { department: 'finance', text: 'Soil report\nColumn schedule\n' });
    const plain = await call('POST', `${at}/import`, { department: 'finance', text: 'Soil report\nBasic prices\n' });
    assert.deepEqual([plain.body.added, plain.body.counted.skipped], [1, [{ row: 0, text: 'Soil report', reason: 'already on the list' }]]);
  });

  it('a file that cannot be read is refused in a sentence, never in an error’s own words', async () => {
    const project = await seeded();
    for (const [name, bytes] of [['broken.xlsx', 'not a workbook at all, only some words long enough to look for an index in'], ['empty.xlsx', '']] as const) {
      const refused = await call('POST', `/api/projects/${project.id}/checklist/import`, upload(name, bytes));
      assert.equal(refused.status, 400, name);
      assert.ok(!/Cannot read properties|undefined|null \(|TypeError|is not a function|at Object/.test(refused.body.error), refused.body.error);
      assert.match(refused.body.error, /^[A-Z].*\.$/);
    }
  });
});

describe('a tender form sent to the project', () => {
  it('is read into Tender terms as answers to accept, its unanswered row is owed by the client, and the form is written back out', async () => {
    const project = await seeded();
    const at = `/api/projects/${project.id}`;
    const preview = await call('POST', `${at}/checklist/import`, (() => { const form = upload('Client inputs.xlsx', '', 'procurement'); return form; })());
    assert.equal(preview.status, 400, 'an empty file is no workbook');

    const send = async (more: Record<string, string> = {}, defects?: string) => {
      const form = upload('Client inputs.xlsx', await tenderForm(defects), 'procurement');
      for (const [key, value] of Object.entries(more)) form.append(key, value);
      return call('POST', `${at}/checklist/import`, form);
    };
    const looked = await send({ preview: '1' });
    assert.deepEqual([looked.status, looked.body.kind, looked.body.said, looked.body.project], [200, 'tender_form', '5 values to accept · 1 not applicable · 1 still owed', undefined]);
    const loaded = await send();
    assert.equal(loaded.status, 201, JSON.stringify(loaded.body).slice(0, 200));
    assert.deepEqual([loaded.body.kind, loaded.body.added, loaded.body.report.offered, loaded.body.report.unanswered], ['tender_form', 1, 5, 1]);
    const held = loaded.body.project as DdProject;
    const record = loaded.body.report.record as string;
    const values = held.fieldSheets!['procurement.boq.tender_terms']!.records!.find((r) => r.id === record)!.values;
    assert.deepEqual(
      ['advance_applies', 'advance_pct', 'contract_type', 'defects_months', 'response_by'].map((key) => [values[key]!.value, values[key]!.state]),
      [[true, 'proposed'], [10, 'proposed'], ['item rate', 'proposed'], [12, 'proposed'], ['2026-10-20', 'proposed']],
    );
    // The file, the sheet and the row, with a blank row of the sheet counted as the row it is.
    assert.deepEqual(values.defects_months!.origin, { kind: 'external', source: 'Client inputs.xlsx · Client inputs · row 13', asOf: new Date().toISOString().slice(0, 10), quote: '12 months' });
    assert.deepEqual(
      held.checklist!.map((line) => [line.department, line.fn, line.ref, line.title, line.owedBy, line.targetDate, line.round]),
      [['procurement', 'procurement.boq', '7.5', 'Liquidated damages', 'Lake Road Developers', '2026-10-20', 'Tender form']],
    );
    assert.deepEqual(held.tenderForms!.map((form) => [form.record, form.file, form.notApplicable.map((offer) => offer.no)]), [[record, 'Client inputs.xlsx', ['4.1']]]);

    // Accepted on the field as any offered value is; the row marked not applicable is taken by a person.
    const accepted = await call('POST', `${at}/fields/decide`, { address: { fn: 'procurement.boq', set: 'procurement.boq.tender_terms', field: 'record as offered', record }, decision: 'accept' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body).slice(0, 200));
    const form = held.tenderForms![0]!;
    assert.equal((await call('POST', `${at}/tender-forms/${form.id}/offers/${form.notApplicable[0]!.id}`, { decision: 'perhaps' })).status, 400);
    const taken = await call('POST', `${at}/tender-forms/${form.id}/offers/${form.notApplicable[0]!.id}`, { decision: 'take' });
    assert.equal(taken.status, 200);
    const after = (taken.body.project as DdProject).fieldSheets!['procurement.boq.tender_terms']!.records![0]!.values;
    assert.deepEqual([after.client_materials!.state, after.client_materials!.naReason, after.contract_type!.state], ['not_applicable', 'not_in_this_project', 'accepted']);
    assert.deepEqual((taken.body.project as DdProject).tenderForms![0]!.notApplicable, []);
    assert.equal((await call('POST', `${at}/tender-forms/${form.id}/offers/${form.notApplicable[0]!.id}`, { decision: 'take' })).status, 400);

    // Written back out, in the form's own columns, and read back as the same values.
    const out = await realFetch(`${base}${at}/tender-terms/${record}/form`);
    assert.equal(out.status, 200);
    assert.match(out.headers.get('content-type') ?? '', /spreadsheetml/);
    const bytes = new Uint8Array(await out.arrayBuffer());
    const back = await call('POST', `${at}/checklist/import`, (() => { const sent = upload('RYT-tender-form.xlsx', bytes, 'procurement'); sent.append('preview', '1'); sent.append('record', record); return sent; })());
    assert.equal(back.status, 200, JSON.stringify(back.body).slice(0, 200));
    assert.deepEqual([back.body.kind, back.body.report.offered, back.body.report.refused, back.body.report.unmatched], ['tender_form', 0, [], []]);
    assert.ok(back.body.report.held >= 5);
    assert.equal((await realFetch(`${base}${at}/tender-terms/rec_nothing/form`)).status, 400);

    // The client's later copy answers the defects period differently: offered beside the one accepted, on the same record.
    const later = await send({}, '24 months');
    assert.deepEqual([later.status, later.body.report.record, later.body.report.offered], [201, record, 1]);
    assert.equal((later.body.project as DdProject).fieldSheets!['procurement.boq.tender_terms']!.records!.length, 1);
    assert.equal((later.body.project as DdProject).checklist!.length, 1);
  });
});
