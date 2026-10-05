/**
 * What the project's memory has been told, over real HTTP.
 *
 * `mem-sync.test.ts` proves what is written to memory and what is read back.
 * This proves the route the firm's own people read it through: that it is
 * mounted, answers newest first with each entry's ids resolved to the titles
 * the record has, gives as many entries as were asked for, counts the nodes
 * the project's memory is, shows how many the whole database holds to the
 * workspace's admins and to nobody else, answers the entries all the same
 * when the count fails, and says the memory store did not answer when it did
 * not. That a collaborator is refused it is in `collaborator-reach.test.ts`,
 * beside the other routes that are the workspace's own.
 *
 * And the other end of one kind of entry: the routes of the comparables and
 * of the map, whose writes leave a note in the thread, name who wrote on
 * it, so memory is told the note as that person's.
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
import { addEvidence, addFinding, applyRevenueMap, createProject, memWho, type DdProject, type RevenueMapRead } from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let ids: { paper: string; finding: string };
const realFetch = globalThis.fetch;

async function call(route: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A read of the public map for one parcel, with nothing near it. */
function mapRead(parcelRef: string, surveyNo: string, readAt: string): RevenueMapRead {
  const centre = { lat: 12.71, lng: 77.69 };
  return {
    readAt,
    state: 'KA',
    parcelRef,
    surveyNo,
    village: null,
    mandal: null,
    district: null,
    sourceLabel: 'A published layer',
    rings: [
      [
        { lat: centre.lat, lng: centre.lng },
        { lat: centre.lat, lng: centre.lng + 0.0005 },
        { lat: centre.lat + 0.0005, lng: centre.lng + 0.0005 },
        { lat: centre.lat + 0.0005, lng: centre.lng },
      ],
    ],
    centre,
    areaSqm: 2400,
    registerExtent: null,
    classification: null,
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: false,
    features: [],
    factors: [],
    insights: [],
    anchor: null,
    emptyLayers: [],
    unreadLayers: [],
  };
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

  it('shows how many nodes the whole database holds to the workspace’s admins, and to nobody else', async () => {
    const { store } = await import('../apps/api/src/store');
    // With sign-in off every request is the one local person, who owns the workspace. Their standing is what is changed here.
    const me = store.data.memberships!.find((member) => member.subject === 'local-operator')!;
    assert.equal(me.role, 'owner');
    try {
      for (const role of ['staff', 'viewer'] as const) {
        me.role = role;
        const res = await call(`/api/projects/${project.id}/memory`);
        assert.equal(res.status, 200);
        assert.equal((res.body.entries as unknown[]).length, 2, `${role} reads the project’s memory`);
        assert.deepEqual(res.body.nodes, { project: 3 }, `and is shown its size, and not the size of every workspace’s graph and memory together (${role})`);
      }
      me.role = 'manager';
      assert.deepEqual((await call(`/api/projects/${project.id}/memory`)).body.nodes, { project: 3, database: 3 }, 'a manager is an admin');
    } finally {
      me.role = 'owner';
    }
  });

  it('answers the entries all the same when the count fails, and leaves the count out', async () => {
    const { memoryPort } = await import('../apps/api/src/graph/mem');
    const warned = mock.method(console, 'warn', () => {});
    const failing = mock.method(memoryPort, 'count', async () => {
      throw new Error('the count ran out of time');
    });
    try {
      const res = await call(`/api/projects/${project.id}/memory`);
      assert.equal(res.status, 200, 'a failed count does not fail the read');
      assert.deepEqual((res.body.entries as Array<{ kind: string }>).map((entry) => entry.kind), ['finding_raised', 'paper_filed']);
      assert.equal('nodes' in res.body, false, 'nothing stands in for a number that was not counted');
      const lines = warned.mock.calls.map((line) => String(line.arguments[0])).filter((line) => line.startsWith('[memory]'));
      assert.equal(lines.length, 1, 'and it is said in the log');
      assert.match(lines[0]!, /could not count the nodes of .*: the count ran out of time/);
    } finally {
      failing.mock.restore();
      warned.mock.restore();
    }
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

describe('a write made on a work pane', () => {
  it('leaves a note that names who wrote, on both of its turns, and memory is told it as theirs', async () => {
    const { store } = await import('../apps/api/src/store');
    const { memoryPort } = await import('../apps/api/src/graph/mem');
    const plot = createProject({ name: 'Work pane plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MR2');
    // Two parcels read off the public map before, so that there is a read to file and reads to take off.
    applyRevenueMap(plot, mapRead('kgis:2003010043:10', '10', '2026-10-05T08:00:00.000Z'), 'lead@example.com');
    applyRevenueMap(plot, mapRead('kgis:2003010043:11', '11', '2026-10-05T08:05:00.000Z'), 'lead@example.com');
    store.data.projects!.push(plot);
    await store.save();
    await store.graphCaughtUp();

    const at = `/api/projects/${plot.id}`;
    const outline = JSON.stringify({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[77.69, 12.71], [77.6905, 12.71], [77.6905, 12.7105], [77.69, 12.7105], [77.69, 12.71]]] },
    });
    const added = await call(`${at}/comparables`, 'POST', { title: 'A plot nearby', price: 12_000_000, areaSqm: 240 });
    const wrote = [
      added.status,
      (await call(`${at}/comparables/decide`, 'POST', { ids: [(added.body.comparable as { id: string } | undefined)?.id ?? 'none'], decision: 'reject' })).status,
      (await call(`${at}/gis-overlay/survey`, 'PUT', { fileText: outline })).status,
      (await call(`${at}/gis-overlay/survey`, 'DELETE')).status,
      (await call(`${at}/gis-overlay/revenue/file`, 'POST')).status,
      (await call(`${at}/gis-overlay/revenue/${encodeURIComponent('kgis:2003010043:11')}`, 'DELETE')).status,
      (await call(`${at}/gis-overlay/revenue`, 'DELETE')).status,
    ];
    assert.deepEqual(wrote, [201, 200, 200, 204, 201, 204, 204], 'a comparable added and set aside, an outline supplied and cleared, a map read filed, one taken off, and the rest cleared');
    await store.graphCaughtUp();

    const held = store.data.projects!.find((other) => other.id === plot.id)!;
    const notes = held.conversation.flatMap((turn, i) => {
      const reply = held.conversation[i + 1];
      return turn.role === 'user' && reply?.toolCalls?.some((tool) => tool.name === 'pane_write') ? [{ line: turn, reply }] : [];
    });
    assert.equal(notes.length, wrote.length, 'each write left its note');
    // Who the routes say did it: the person signed in, as the audit trail names them for the same writes.
    const me = held.audit.at(-1)!.actor;
    assert.match(me, /@/);
    for (const { line, reply } of notes) assert.deepEqual([line.actor, reply.actor], [me, me], `“${line.text}” is theirs, on both turns`);

    const told = (await memoryPort.entries(plot.id, 100)).filter((entry) => entry.kind === 'edit_noted');
    assert.deepEqual(told.map((entry) => entry.sourceId).sort(), notes.map(({ line }) => line.id).sort(), 'memory is told every note, at once');
    assert.ok(told.every((entry) => entry.by === memWho(plot.id, me)), 'and whose each was');
  });
});
