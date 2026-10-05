/**
 * Reading several survey numbers, over real HTTP, with no network.
 *
 * `revenue-parcels.test.ts` proves what is kept and what it adds up to. This
 * proves the routes the picker calls: one number to a request, a number the
 * state's map holds under another answered from the parcel already kept, a
 * number that is not on the map said to be so, and one read taken off without
 * the others. And what a read does when another instance of the server has
 * changed the file while the map was being read: it lands on the file as it
 * stands, and does not put back what was taken off meanwhile.
 *
 * The state's map server is stood in for here. Every request that is not to
 * this test's own server or to the stand-in fails the test: nothing in it
 * may reach the network. The survey numbers and the outlines are made up.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, createProject, removeRevenueMapRead, revenueReads, type DdProject, type RevenueMapRead } from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;

/** The outlines the stand-in holds, as the state's service writes them: whole survey numbers, in its own grid. */
const ON_THE_MAP: Record<string, string> = {
  '91': 'POLYGON ((798400 1435700, 798460 1435700, 798460 1435740, 798400 1435740, 798400 1435700))',
  '92': 'POLYGON ((798480 1435700, 798530 1435700, 798530 1435740, 798480 1435740, 798480 1435700))',
};

const realFetch = globalThis.fetch;
/** What was asked of the stand-in: each parcel by number, and each read of the layers around one. */
let parcelsAsked: string[] = [];
let layersAsked = 0;
/** Run once, while the state's map is being asked: what happens to the file elsewhere during a slow read. */
let whileTheMapIsRead: (() => Promise<void>) | undefined;

function standIn(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (base && url.startsWith(base)) return realFetch(input, init);
    const meanwhile = whileTheMapIsRead;
    whileTheMapIsRead = undefined;
    if (meanwhile) await meanwhile();
    const parcel = /\/geomForSurveyNum\/\d+\/([^/]+)\/DD$/.exec(url);
    if (parcel) {
      const surveyNo = decodeURIComponent(parcel[1]!);
      parcelsAsked.push(surveyNo);
      const geom = ON_THE_MAP[surveyNo];
      // The service answers a number it does not hold with an empty body.
      return new Response(geom ? JSON.stringify([{ message: '200', geom }]) : '', { status: 200 });
    }
    if (url.includes('/arcgis/rest/services/')) {
      layersAsked += 1;
      return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`A test reached for the network: ${url}`);
  }) as typeof fetch;
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const PLACE = { state: 'KA', district: 'Bengaluru (Urban)', mandal: 'Bangalore-East', village: 'White Field (K R Pura-3)' };

async function seeded(landAreaSqm?: number): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Two parcels', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-R1');
  if (landAreaSqm) p.landAreaSqm = landAreaSqm;
  store.data.projects!.push(p);
  return p;
}

/** The list as stored. Asked through a function, so that an earlier assertion that it was absent is not taken as its type. */
const stored = (project: DdProject) => project.revenueMaps;

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

/**
 * Another instance of the server, over the same storage: it loads the file as
 * it is stored, changes it, and saves. Serverless runs several, and a read of
 * the state's map is slow enough for one of them to get there first.
 */
async function onAnotherInstance(projectId: string, change: (project: DdProject) => void): Promise<void> {
  const other = await anotherInstance(projectId);
  other.write(change);
  await other.saved();
}

/**
 * The same, in two steps: the instance loads the file now, and writes its
 * change when it is told to. Loading is the slow part, and a test about what
 * happens within a second of this instance's last look does it beforehand.
 */
async function anotherInstance(projectId: string): Promise<{ write: (change: (project: DdProject) => void) => void; saved: () => Promise<void> }> {
  const { Store } = await import('../apps/api/src/store');
  const other = new Store();
  await other.init();
  const project = other.data.projects?.find((p) => p.id === projectId);
  assert.ok(project, 'the other instance finds the project in storage');
  // A file's `updatedAt` is how a save knows it moved: a change is never in the same millisecond as the last.
  await tick();
  return {
    write: (change) => change(project),
    saved: async () => {
      await other.save();
      await tick();
    },
  };
}

/** The file as storage holds it now, whatever this instance has in hand. */
async function inStorage(projectId: string): Promise<DdProject> {
  const { Store } = await import('../apps/api/src/store');
  const fresh = new Store();
  await fresh.init();
  const project = fresh.data.projects?.find((p) => p.id === projectId);
  assert.ok(project, 'the project is in storage');
  return project;
}

const read = (projectId: string, surveyNo: string, more: Record<string, unknown> = {}) =>
  call('POST', `/api/projects/${projectId}/gis-overlay/revenue`, { ...PLACE, surveyNo, ...more });

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-parcels-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  // A read is budgeted like a model call, thirty a minute by default. This file makes more than a minute's worth.
  process.env.REALYTICA_RATE_LIMIT_MODEL = '500';
  // Before the app is made: what it fetches to warm itself at boot is turned away too.
  standIn();
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('the revenue-map routes, for a site on several survey numbers', () => {
  it('reads one number to a request, and keeps each parcel', async () => {
    const p = await seeded();
    parcelsAsked = [];
    layersAsked = 0;

    const first = await read(p.id, '91/1', { several: true, unlessKept: true });
    assert.equal(first.status, 200);
    const kept = first.body.read as RevenueMapRead;
    assert.equal(kept.surveyNo, '91', 'the state’s map holds the whole number');
    assert.deepEqual(kept.askedAs, ['91/1'], 'and the read remembers what it was asked for as');
    assert.ok(first.body.boundary, 'the first parcel is the boundary');
    assert.match(String(first.body.note), /not a survey/);
    assert.equal(p.revenueMap?.surveyNo, '91');
    assert.equal(p.revenueMaps, undefined, 'one read is stored as one read');
    const layersForOne = layersAsked;
    assert.ok(layersForOne > 0, 'the layers round the parcel were read');

    const sameParcel = await read(p.id, '91/2', { several: true, unlessKept: true });
    assert.equal(sameParcel.status, 200);
    assert.equal(sameParcel.body.already, true, 'a second number for the same parcel is answered from what is kept');
    assert.deepEqual((sameParcel.body.read as RevenueMapRead).askedAs, ['91/1', '91/2']);
    assert.equal(layersAsked, layersForOne, 'and the layers are not read a second time');
    assert.equal(revenueReads(p).length, 1);

    const second = await read(p.id, '92', { several: true, unlessKept: true });
    assert.equal(second.status, 200);
    assert.equal(second.body.boundary, null, 'another parcel does not move the boundary');
    assert.match(String(second.body.note), /Sy\. 92 is kept with the other parcels/);
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['91', '92']);
    assert.equal(p.revenueMap?.surveyNo, '91', 'the field the old code reads still holds the first');
    assert.equal(stored(p)?.length, 2);
    assert.match(p.surveyBoundary?.suppliedNote ?? '', /Sy\. 91$/);
    assert.deepEqual(parcelsAsked.filter((n) => n.includes('/')), [], 'the map is asked for whole numbers only');
  });

  it('says a number is not on the map without stopping what is kept', async () => {
    const p = await seeded();
    await read(p.id, '91');
    const missing = await read(p.id, '99', { several: true, unlessKept: true });
    assert.equal(missing.status, 404);
    assert.match(String(missing.body.error), /Sy\. 99 is not in the published map for White Field/);
    assert.deepEqual(missing.body.near, [], 'the numbers that start the same way, when the map lists any');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['91']);

    const refused = await read(p.id, '', { several: true });
    assert.equal(refused.status, 400);
  });

  it('reads a kept parcel afresh when it is asked for again, by its own reference', async () => {
    const p = await seeded();
    await read(p.id, '91/1', { unlessKept: true });
    const before = p.revenueMap!.readAt;
    layersAsked = 0;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await call('POST', `/api/projects/${p.id}/gis-overlay/revenue`, { parcelRef: p.revenueMap!.parcelRef });
    assert.equal(again.status, 200);
    assert.equal(again.body.already, undefined);
    assert.ok(layersAsked > 0, 'the layers were read again');
    assert.notEqual(p.revenueMap!.readAt, before);
    assert.deepEqual(p.revenueMap!.askedAs, ['91/1'], 'what it was asked for as is kept');
    assert.equal(revenueReads(p).length, 1);

    // A client from before parcels were kept asks by place and number, and still gets a fresh read.
    layersAsked = 0;
    const older = await read(p.id, '91');
    assert.equal(older.status, 200);
    assert.equal(older.body.already, undefined);
    assert.ok(layersAsked > 0);

    const stranger = await call('POST', `/api/projects/${p.id}/gis-overlay/revenue`, { parcelRef: 'kgis:2004030029:77' });
    assert.equal(stranger.status, 404, 'a parcel that is not kept cannot be read again');
    assert.equal(stranger.body.near, undefined);
    assert.equal(revenueReads(p).length, 1);
  });

  it('holds the land area on the project against one parcel only while it stands alone', async () => {
    const quoted = (r: RevenueMapRead) => r.factors.some((f) => f.code === 'parcel_extent_mismatch');

    const alone = await seeded(9000);
    await read(alone.id, '91');
    assert.equal(quoted(alone.revenueMap!), true, '9,000 sqm quoted against a 2,400 sqm parcel');
    await read(alone.id, '92', { unlessKept: true });
    assert.deepEqual(revenueReads(alone).map(quoted), [false, false], 'a second parcel explains it, and the check goes');

    const several = await seeded(9000);
    await read(several.id, '91', { several: true, unlessKept: true });
    assert.equal(quoted(several.revenueMap!), false, 'a number read as one of several is never held against the whole');
  });

  it('notes a read asked for on its own in the thread, and not each number of a run', async () => {
    const p = await seeded();
    const noted = () => p.conversation.filter((turn) => turn.role === 'user' && /^Read the revenue map for Sy\. /.test(turn.text)).map((turn) => turn.text);
    const audited = () => p.audit.filter((entry) => entry.newValue?.startsWith('revenueMap ')).length;

    await read(p.id, '91', { several: true, unlessKept: true });
    await read(p.id, '92', { several: true, unlessKept: true });
    assert.deepEqual(noted(), [], 'a dozen numbers from one press would bury what was said there');
    assert.equal(audited(), 2, 'each read is on the audit trail all the same');

    await new Promise((resolve) => setTimeout(resolve, 5));
    await call('POST', `/api/projects/${p.id}/gis-overlay/revenue`, { parcelRef: revenueReads(p)[1]!.parcelRef });
    assert.equal(noted().length, 1, 'one parcel read again by itself is one line, as it always was');
    assert.match(noted()[0]!, /^Read the revenue map for Sy\. 92, White Field/);
    assert.equal(audited(), 3);
  });

  it('takes one read off and leaves the rest, then clears them all', async () => {
    const p = await seeded();
    await read(p.id, '91');
    await read(p.id, '92');
    const [first, second] = revenueReads(p);

    const unknown = await call('DELETE', `/api/projects/${p.id}/gis-overlay/revenue/${encodeURIComponent('kgis:2004030029:77')}`);
    assert.equal(unknown.status, 404);

    const removed = await call('DELETE', `/api/projects/${p.id}/gis-overlay/revenue/${encodeURIComponent(first!.parcelRef)}`);
    assert.equal(removed.status, 204);
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['92']);
    assert.equal(p.revenueMap?.parcelRef, second!.parcelRef, 'the next read is the one the old field holds');
    assert.match(p.surveyBoundary?.suppliedNote ?? '', /Sy\. 92$/, 'and its parcel is the boundary');

    await read(p.id, '91');
    assert.equal(revenueReads(p).length, 2);
    const cleared = await call('DELETE', `/api/projects/${p.id}/gis-overlay/revenue`);
    assert.equal(cleared.status, 204);
    assert.deepEqual(revenueReads(p), []);
    assert.equal(p.revenueMaps, undefined);
    assert.equal(p.surveyBoundary, undefined);
  });
});

describe('a read that lands on a file another instance changed while the map was being read', () => {
  it('lands on the file as it stands now, and loses nothing written meanwhile', async () => {
    const p = await seeded();
    await read(p.id, '91');
    whileTheMapIsRead = () => onAnotherInstance(p.id, (elsewhere) => void addEvidence(elsewhere, { title: 'Filed elsewhere', kind: 'document', status: 'received' }, 'someone else'));

    const second = await read(p.id, '92', { unlessKept: true });
    assert.equal(second.status, 200);
    assert.equal(whileTheMapIsRead, undefined, 'the other instance wrote while the map was being read');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['91', '92']);
    assert.ok(p.evidence.some((e) => e.title === 'Filed elsewhere'), 'what was filed meanwhile is on the file this instance holds');

    const kept = await inStorage(p.id);
    assert.deepEqual(revenueReads(kept).map((r) => r.surveyNo), ['91', '92']);
    assert.ok(kept.evidence.some((e) => e.title === 'Filed elsewhere'), 'and was not written over by the copy the read started from');
  });

  it('does not put back a parcel that was taken off while it was being read again', async () => {
    const p = await seeded();
    await read(p.id, '91');
    await read(p.id, '92');
    const first = revenueReads(p)[0]!.parcelRef;
    whileTheMapIsRead = () => onAnotherInstance(p.id, (elsewhere) => void removeRevenueMapRead(elsewhere, first, 'someone else'));

    const again = await call('POST', `/api/projects/${p.id}/gis-overlay/revenue`, { parcelRef: first });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'That parcel was taken off this project while it was being read again. It has not been put back.');
    assert.equal(again.body.near, undefined, 'it is not a number missing from the map');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['92'], 'the removal stands');
    assert.deepEqual(revenueReads(await inStorage(p.id)).map((r) => r.surveyNo), ['92']);
    assert.match(p.surveyBoundary?.suppliedNote ?? '', /Sy\. 92$/, 'with the boundary the removal handed on');
  });

  it('does not answer a number from a parcel that was taken off while it was being looked up', async () => {
    const p = await seeded();
    await read(p.id, '91/1', { unlessKept: true });
    const only = p.revenueMap!.parcelRef;
    whileTheMapIsRead = () => onAnotherInstance(p.id, (elsewhere) => void removeRevenueMapRead(elsewhere, only, 'someone else'));

    // 91/2 is the parcel kept for 91/1, so it would be answered from what is kept: but that is gone.
    const other = await read(p.id, '91/2', { several: true, unlessKept: true });
    assert.equal(other.status, 409);
    assert.equal(other.body.error, 'The parcel for Sy. 91/2 was taken off this project while it was being looked up. Read it again.');
    assert.deepEqual(revenueReads(p), []);
    assert.deepEqual(revenueReads(await inStorage(p.id)), []);

    // Asked for again, it is read afresh.
    const fresh = await read(p.id, '91/2', { several: true, unlessKept: true });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.already, undefined);
    assert.deepEqual(revenueReads(p).map((r) => [r.surveyNo, r.askedAs]), [['91', ['91/2']]]);
  });

  /** What the code in production does when it clears: the one read it knows, and a boundary a read supplied. */
  const clearedByTheOldCode = (elsewhere: DdProject) => {
    elsewhere.revenueMap = undefined;
    if (elsewhere.surveyBoundary?.source === 'revenue_map') elsewhere.surveyBoundary = undefined;
    elsewhere.updatedAt = new Date().toISOString();
  };

  /*
   * The three below are about one second. Every request syncs the file first,
   * but no more than once a second for a project. So each has this instance
   * look at storage, and then, a few milliseconds later, something written
   * elsewhere. Without a look of its own the route acts on the copy this
   * instance holds, and saves it over what was written in between.
   */
  async function writtenElsewhereJustAfterALook(p: DdProject, change: (project: DdProject) => void): Promise<void> {
    const other = await anotherInstance(p.id);
    // A number already kept is answered from what is kept: nothing is read or changed, and storage is looked at.
    const looked = await read(p.id, revenueReads(p)[0]!.surveyNo, { several: true, unlessKept: true });
    assert.equal(looked.body.already, true);
    other.write(change);
    await other.saved();
  }

  it('does not write a removal over a clear made elsewhere a moment before', async () => {
    const p = await seeded();
    await read(p.id, '91');
    await read(p.id, '92');
    const second = revenueReads(p)[1]!.parcelRef;
    await writtenElsewhereJustAfterALook(p, clearedByTheOldCode);

    const removed = await call('DELETE', `/api/projects/${p.id}/gis-overlay/revenue/${encodeURIComponent(second)}`);
    assert.equal(removed.status, 404, 'there is nothing left to remove');
    assert.deepEqual(revenueReads(p), []);
    assert.deepEqual(revenueReads(await inStorage(p.id)), [], 'and Sy. 91 is not written back over the clear');
  });

  it('does not file a read that was cleared elsewhere a moment before', async () => {
    const p = await seeded();
    await read(p.id, '91');
    await writtenElsewhereJustAfterALook(p, clearedByTheOldCode);

    const filed = await call('POST', `/api/projects/${p.id}/gis-overlay/revenue/file`);
    assert.equal(filed.status, 400);
    assert.equal(filed.body.error, 'No revenue map has been read for this project.');
    const kept = await inStorage(p.id);
    assert.equal(kept.revenueMap, undefined, 'the read is not put back by being filed');
    assert.equal(kept.evidence.some((e) => e.source === 'revenue_map'), false);
  });

  it('does not clear the reads over what was written elsewhere a moment before, nor say it cleared what was gone', async () => {
    const p = await seeded();
    await read(p.id, '91');
    await writtenElsewhereJustAfterALook(p, (elsewhere) => void addEvidence(elsewhere, { title: 'Filed elsewhere', kind: 'document', status: 'received' }, 'someone else'));
    const cleared = await call('DELETE', `/api/projects/${p.id}/gis-overlay/revenue`);
    assert.equal(cleared.status, 204);
    const kept = await inStorage(p.id);
    assert.deepEqual(revenueReads(kept), []);
    assert.ok(kept.evidence.some((e) => e.title === 'Filed elsewhere'), 'what was filed meanwhile is still there');

    const gone = await seeded();
    await read(gone.id, '91', { several: true, unlessKept: true });
    await writtenElsewhereJustAfterALook(gone, clearedByTheOldCode);
    const again = await call('DELETE', `/api/projects/${gone.id}/gis-overlay/revenue`);
    assert.equal(again.status, 204);
    assert.equal(gone.conversation.some((turn) => /^Cleared the revenue-map read/.test(turn.text)), false, 'the thread is not told this instance cleared a read that was already gone');
  });
});

describe('a read the project’s record has no room for', () => {
  it('is not kept, says how many parcels are and why, and leaves the file as it was', async () => {
    const { PROJECT_RECORD_CEILING_BYTES, recordBytes } = await import('../apps/api/src/gis/revenue-map');
    const p = await seeded();
    await read(p.id, '91');
    // A record fills with everything a project holds. Here a document's notes take it to within a hundred bytes or so of
    // what it may weigh, so that one more parcel is the one too many — and so is one more line on the audit trail.
    const notes = addEvidence(p, { title: 'A long document', kind: 'document', status: 'received' }, 'tester');
    notes.extractionNotes = 'x'.repeat(PROJECT_RECORD_CEILING_BYTES - recordBytes(p) - 150);
    const before = recordBytes(p);
    assert.ok(before < PROJECT_RECORD_CEILING_BYTES);

    const refused = await read(p.id, '92', { several: true, unlessKept: true });
    assert.equal(refused.status, 507);
    assert.equal(refused.body.full, true, 'the picker is told the numbers after this one would be turned away the same');
    assert.equal(
      refused.body.error,
      '1 parcel is kept on this project. Sy. 92 was read from the map and is not kept: with it the project’s record would weigh over 2.5 MB, and a record much heavier than that stops opening. Remove a read that is not needed to make room.',
    );
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['91']);
    assert.equal(recordBytes(p), before, 'nothing was added to the record');

    // A parcel already kept, read again, takes the place of its read and is not what fills a file.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await call('POST', `/api/projects/${p.id}/gis-overlay/revenue`, { parcelRef: p.revenueMap!.parcelRef, several: true });
    assert.equal(again.status, 200);

    // With room made, the parcel that was turned away is kept.
    notes.extractionNotes = '';
    const kept = await read(p.id, '92', { several: true, unlessKept: true });
    assert.equal(kept.status, 200);
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['91', '92']);
  });
});
